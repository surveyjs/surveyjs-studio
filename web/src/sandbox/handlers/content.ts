// Mirrors server/src/content/ (handlers.ts, service.ts, etag.ts) and the memory provider's
// definition and theme store (server/src/providers/memory.ts, domain/content-version.ts): a document
// and its version, `ETag: "<version>"`, `If-Match` on save, one history entry per definition save.
// The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxJson } from "../seed-types";
import type { SandboxData } from "../store";
import {
  BODY_LIMITS,
  mutate,
  parsePagingQuery,
  readJson,
  requireSession,
  requiredObject,
  view,
} from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { decodeHistoryCursor, encodeHistoryCursor, type HistoryPosition } from "./paging";
import { addHistoryEntry, HISTORY_SNAPSHOTS, historyOrder } from "./history";
import { guarded, notFound, ProblemError } from "./problems";
import { modifiableSurvey, visibleSurvey } from "./survey-access";

/** Asks proxies that compress responses to leave the ETag as sent (a rewritten tag never matches on save). */
const NO_TRANSFORM = "no-transform";

/** SHA-256 of the UTF-8 text, base64url without padding (43 characters): `contentVersion`. */
async function sha256Base64Url(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The version of a stored document: the hash of its JSON, or of "" when the survey has none yet. */
export const versionOf = (content: SandboxJson | undefined): Promise<string> =>
  sha256Base64Url(content === undefined ? "" : JSON.stringify(content));

/** The strong tag `"<version>"`. */
export const formatEtag = (version: string): string => `"${version}"`;

/** One entity tag at the start of `text`: its weakness, its value and the text after it. */
function readTag(text: string): { weak: boolean; value: string; rest: string } | null {
  const weak = text.startsWith("W/");
  const body = weak ? text.slice(2) : text;
  if (!body.startsWith('"')) return null;
  const end = body.indexOf('"', 1);
  if (end < 0) return null;
  return { weak, value: body.slice(1, end), rest: body.slice(end + 1) };
}

/**
 * Whether an `If-Match` header allows a write to a document at `version` (RFC 9110 section
 * 13.1.1): `*` matches any version, otherwise one entity tag of the comma-separated list must be
 * the strong tag of the version. Weak tags never match; a header that is no valid list matches
 * nothing (server/src/content/etag.ts).
 */
export function ifMatchAllows(header: string, version: string): boolean {
  let rest = header.trim();
  if (rest === "*") return true;
  let allowed = false;
  for (;;) {
    const tag = readTag(rest);
    if (!tag) return false;
    if (!tag.weak && tag.value === version) allowed = true;
    rest = tag.rest.trimStart();
    if (rest === "") return allowed;
    if (!rest.startsWith(",")) return false;
    rest = rest.slice(1).trimStart();
  }
}

const editConflict = () =>
  new ProblemError({
    code: "edit-conflict",
    status: 412,
    title: "The survey was changed by someone else",
    detail: "Reload the survey to see the latest version.",
  });

const ifMatchRequired = () =>
  new ProblemError({
    code: "if-match-required",
    status: 428,
    title: "If-Match required",
    detail: "Send the ETag from your last read in If-Match.",
  });

type Store = "definitions" | "themes";

const same = (a: SandboxJson | undefined, b: SandboxJson | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** A document, with its ETag and `no-transform`. */
async function documentResponse(content: SandboxJson | undefined): Promise<Response> {
  return HttpResponse.json(content ?? {}, {
    headers: { ETag: formatEtag(await versionOf(content)), "Cache-Control": NO_TRANSFORM },
  });
}

export function contentHandlers(ctx: HandlerContext) {
  const getDocument = (store: Store) => (surveyId: string, cookies: Record<string, string>) =>
    guarded(async () => {
      const content = view(ctx, cookies, (data, user) => {
        const { survey } = visibleSurvey(data, user, surveyId);
        return data[store][survey.id];
      });
      return documentResponse(content);
    });

  const saveDocument =
    (store: Store) => (surveyId: string, request: Request, cookies: Record<string, string>) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const body = requiredObject(
          await readJson(request, ["application/json"], BODY_LIMITS.maxDocumentBytes),
        );
        const header = request.headers.get("if-match");
        const read = view(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, surveyId);
          return { id: survey.id, current: data[store][survey.id] };
        });
        if (header === null || header.trim() === "") throw ifMatchRequired();
        if (!ifMatchAllows(header, await versionOf(read.current))) throw editConflict();
        const version = await versionOf(body);
        // The write re-checks the document: a save from another tab since the read is a conflict.
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, surveyId);
          if (!same(data[store][survey.id], read.current)) throw editConflict();
          const savedAt = ctx.now().toISOString();
          data[store][survey.id] = structuredClone(body);
          survey.updatedAt = savedAt;
          if (store === "definitions") {
            addHistoryEntry(
              data,
              survey.id,
              { id: ctx.newId(), at: savedAt, userId: user.id.toLowerCase() },
              body,
            );
          }
        });
        return new HttpResponse(null, { status: 204, headers: { ETag: formatEtag(version) } });
      });

  return [
    http.get("/surveys/{surveyId}/definition", ({ params, cookies }) =>
      getDocument("definitions")(params.surveyId, cookies),
    ),
    http.put("/surveys/{surveyId}/definition", ({ params, request, cookies }) =>
      saveDocument("definitions")(params.surveyId, request, cookies),
    ),
    http.get("/surveys/{surveyId}/theme", ({ params, cookies }) =>
      getDocument("themes")(params.surveyId, cookies),
    ),
    http.put("/surveys/{surveyId}/theme", ({ params, request, cookies }) =>
      saveDocument("themes")(params.surveyId, request, cookies),
    ),

    http.get("/surveys/{surveyId}/history", ({ params, request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const { limit, cursor } = parsePagingQuery(new URL(request.url));
        return view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          return historyPage(data, survey.id, limit, cursor);
        });
      }),
    ),

    // server/src/content/service.ts getHistoryEntry: 404 for an invisible survey and for an
    // unknown entry; an entry past the newest HISTORY_SNAPSHOTS has no JSON here (501).
    http.get("/surveys/{surveyId}/history/{entryId}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const snapshot = view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const entryId = params.entryId.toLowerCase();
          const entry = data.history[survey.id]?.find((e) => e.id.toLowerCase() === entryId);
          if (!entry) throw notFound();
          return entry.snapshot;
        });
        if (snapshot === undefined) throw olderEntry();
        return HttpResponse.json(snapshot);
      }),
    ),
  ];
}

const olderEntry = () =>
  new ProblemError({
    code: "not-implemented",
    status: 501,
    title: "Not implemented",
    detail: `The demo keeps the JSON of the ${HISTORY_SNAPSHOTS} newest saves of a survey.`,
  });

/** After the position in `historyOrder` (times compared as instants): `isAfterHistory`. */
function isAfterHistory(entry: { at: string; id: string }, position: HistoryPosition): boolean {
  const at = Date.parse(entry.at);
  const after = Date.parse(position.at);
  return at < after || (at === after && entry.id < position.id.toLowerCase());
}

function historyPage(
  data: SandboxData,
  surveyId: string,
  limit: number,
  cursor: string | undefined,
): Response {
  const after = cursor === undefined ? undefined : decodeHistoryCursor(cursor);
  const matching = [...(data.history[surveyId] ?? [])]
    .sort(historyOrder)
    .filter((entry) => after === undefined || isAfterHistory(entry, after));
  const items = matching.slice(0, limit);
  const last = items.at(-1);
  return HttpResponse.json({
    items: items.map(({ id, at, userId }) => {
      // null when nobody has that id any more.
      const author =
        userId === null
          ? null
          : (data.users.find((user) => user.id.toLowerCase() === userId.toLowerCase()) ?? null);
      return { id, at, user: author && { id: author.id, displayName: author.displayName } };
    }),
    nextCursor:
      matching.length > items.length && last
        ? encodeHistoryCursor({ at: last.at, id: last.id })
        : null,
  });
}
