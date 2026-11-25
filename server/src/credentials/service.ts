import { randomUUID } from "node:crypto";
import type { components } from "@surveyjs-studio/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import { AppError } from "../errors.js";
import type {
  ApiTokenRecord,
  CredentialStore,
  ProjectStore,
  UserDirectory,
} from "../providers/types.js";
import { notFound } from "../surveys/access.js";
import { hashCredential, lastFour, newApiTokenValue } from "./format.js";

type ApiToken = components["schemas"]["ApiToken"];
type ApiTokenList = components["schemas"]["ApiTokenList"];
type ApiTokenCreate = components["schemas"]["ApiTokenCreate"];
type ApiTokenCreated = components["schemas"]["ApiTokenCreated"];

export interface CredentialsServiceOptions {
  readonly credentials: CredentialStore;
  readonly users: UserDirectory;
  readonly projects: ProjectStore;
  /** `features.legacyKeyRevoke` (`LEGACY_KEY_REVOKE`): whether a user can revoke their legacy key. */
  readonly legacyKeyRevoke: boolean;
  /** The clock for creation and revocation times; default `Date.now`. */
  readonly now?: Clock;
}

export interface CredentialsService {
  /** Without `projectId`: the caller's legacy key and Personal tokens; with it, the project's tokens. */
  list(user: RequestUser, projectId: string | undefined): Promise<ApiTokenList>;
  create(user: RequestUser, body: ApiTokenCreate): Promise<ApiTokenCreated>;
  revoke(user: RequestUser, tokenId: string): Promise<void>;
  revokeLegacyKey(user: RequestUser): Promise<void>;
  /** Rotates the API token the request carries; the new value is shown once. */
  replaceCurrent(user: RequestUser): Promise<{ value: string }>;
}

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const forbidden = (): AppError =>
  new AppError({
    code: "forbidden",
    status: 403,
    title: "Forbidden",
    detail: "Only project admins can manage the project's API tokens.",
  });

const unauthenticated = (): AppError =>
  new AppError({ code: "unauthenticated", status: 401, title: "Sign-in required" });

/** A 422 for a blank name; names are stored as sent, as project names are (R14). */
function checkName(name: string): void {
  if (name.trim() === "") {
    throw new AppError({
      code: "validation-failed",
      status: 422,
      title: "Validation failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
  }
}

/**
 * The API token operations (ADR 0037). A Personal token is its creator's to list, create and
 * revoke; a project token its project's admins' (an instance admin acts as an admin of every
 * project, S17). A token out of the caller's reach answers like an unknown one (404); only a plain
 * member listing or creating a project's tokens gets 403. Every operation but `replaceCurrent` is
 * session-only (the contract's security), so no bearer credential manages tokens.
 */
export function createCredentialsService(options: CredentialsServiceOptions): CredentialsService {
  const { credentials, users, projects, legacyKeyRevoke, now = Date.now } = options;
  const isoNow = (): string => new Date(now()).toISOString();

  /**
   * The caller's role in the project: `admin` (an instance admin in any existing project), `user`,
   * or null when the project is unknown or not the caller's.
   */
  async function roleIn(user: RequestUser, projectId: string): Promise<"admin" | "user" | null> {
    const membership = await projects.getUserProject(user.id, projectId);
    if (user.instanceRole === "admin") {
      return membership || (await projects.getProject(projectId)) ? "admin" : null;
    }
    return membership?.role ?? null;
  }

  /** The project's id as stored, for an admin; 403 for a plain member, 404 otherwise. */
  async function adminOf(user: RequestUser, projectId: string): Promise<string> {
    const role = await roleIn(user, projectId);
    if (role === null) throw notFound();
    if (role !== "admin") throw forbidden();
    return projectId.toLowerCase();
  }

  /** The creator's display name, from the directory; the id when the user is unknown. */
  async function namesOf(records: readonly ApiTokenRecord[]): Promise<Map<string, string>> {
    const ids = [...new Set(records.map((record) => record.creatorId.toLowerCase()))];
    const names = await Promise.all(
      ids.map(async (id) => [id, (await users.getUser(id))?.displayName ?? id] as const),
    );
    return new Map(names);
  }

  const tokenJson = (record: ApiTokenRecord, names: Map<string, string>): ApiToken => {
    const creator = record.creatorId.toLowerCase();
    return {
      id: record.id,
      name: record.name,
      projectId: record.projectId,
      lastFour: record.lastFour,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      createdBy: { id: creator, displayName: names.get(creator) ?? creator },
    };
  };

  /** Whether the caller may revoke the token: its creator (Personal) or a project admin. */
  async function reaches(user: RequestUser, token: ApiTokenRecord): Promise<boolean> {
    if (token.projectId === null) return sameId(token.creatorId, user.id);
    return (await roleIn(user, token.projectId)) === "admin";
  }

  return {
    async list(user, projectId) {
      if (projectId !== undefined) {
        const records = await credentials.listApiTokens({
          projectId: await adminOf(user, projectId),
        });
        const names = await namesOf(records);
        return { legacyKey: null, tokens: records.map((r) => tokenJson(r, names)) };
      }
      const [key, records] = await Promise.all([
        credentials.legacyKeyOf(user.id),
        credentials.listApiTokens({ creatorId: user.id }),
      ]);
      const names = await namesOf(records);
      return {
        // A revoked key is no longer the user's credential: it is not listed.
        legacyKey:
          key === null || key.revoked
            ? null
            : { lastFour: key.lastFour, revocable: legacyKeyRevoke },
        tokens: records.map((r) => tokenJson(r, names)),
      };
    },

    async create(user, { name, projectId }) {
      checkName(name);
      const scope = projectId === null ? null : await adminOf(user, projectId);
      const value = newApiTokenValue();
      const record = {
        id: randomUUID(),
        creatorId: user.id.toLowerCase(),
        projectId: scope,
        name,
        lastFour: lastFour(value),
        createdAt: isoNow(),
      };
      await credentials.createApiToken(record, hashCredential(value, "api-token"));
      const stored: ApiTokenRecord = { ...record, lastUsedAt: null, revokedAt: null };
      return { token: tokenJson(stored, await namesOf([stored])), value };
    },

    async revoke(user, tokenId) {
      const token = await credentials.getApiToken(tokenId);
      if (!token || token.revokedAt !== null || !(await reaches(user, token))) throw notFound();
      // False when a concurrent request revoked it first: gone all the same.
      if (!(await credentials.revokeApiToken(token.id, isoNow()))) throw notFound();
    },

    async revokeLegacyKey(user) {
      if (!legacyKeyRevoke) {
        throw new AppError({
          code: "legacy-key-revoke-unavailable",
          status: 409,
          title: "Legacy key revoke unavailable",
          detail: "Legacy access keys cannot be revoked on this instance yet.",
        });
      }
      const key = await credentials.legacyKeyOf(user.id);
      if (key === null || key.revoked) throw notFound();
      if (!(await credentials.revokeLegacyKey(user.id, isoNow()))) throw notFound();
    },

    async replaceCurrent(user) {
      const credential = user.credential;
      if (credential?.kind === "legacy-key") {
        if (credentials.replaceLegacyKey === undefined) {
          throw new AppError({
            code: "legacy-key-replace-unavailable",
            status: 409,
            title: "Legacy key replace unavailable",
            detail: "A legacy access key cannot be replaced here.",
          });
        }
        // 32 lower-case hex digits, the shape the old service issued.
        const value = randomUUID().replaceAll("-", "");
        // Revoked or replaced since the request was authenticated: the key no longer signs in.
        if (
          !(await credentials.replaceLegacyKey(
            user.id,
            credential.hash,
            hashCredential(value, "legacy-key"),
            lastFour(value),
            isoNow(),
          ))
        )
          throw unauthenticated();
        return { value };
      }
      // Bearer only (the contract's security): a session never gets here.
      if (credential?.kind !== "api-token") throw unauthenticated();
      const value = newApiTokenValue();
      const replaced = await credentials.replaceApiTokenHash(
        credential.id,
        hashCredential(value, "api-token"),
        lastFour(value),
      );
      // Revoked since the request was authenticated (or gone): the credential no longer signs in.
      if (!replaced) throw unauthenticated();
      return { value };
    },
  };
}
