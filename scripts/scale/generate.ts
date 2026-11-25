// `pnpm scale:generate`: builds a synthetic data set of a chosen size straight into a migrated SQL
// database (DATABASE_URL, else SQLITE_PATH, as the server reads them), in batched inserts. The
// data is the same for the same seed. Nothing in it comes from production.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hashCredential, lastFour, newApiTokenValue } from "../../server/src/credentials/format.js";
import { openDatabase, type SqlDatabase } from "../../server/src/sql/database.js";
import { migrate } from "../../server/src/sql/migrator.js";
import { versionOf } from "../../server/src/sql/survey-store.js";
import { jsonText } from "../../server/src/sql/values.js";
import { GENERATE_USAGE, parseSizes, type ScaleSizes } from "./sizes.js";

export type { ScaleSizes } from "./sizes.js";

/** A small deterministic generator (mulberry32). */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lower-case GUID (version 4 layout) from the generator. */
function guid(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = "89ab"[Math.floor(random() * 4)]!;
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

const BASE_TIME = Date.parse("2025-01-01T00:00:00.000Z");
/** Rows per insert statement: under the drivers' parameter limits at the widest table. */
const BATCH = 1000;

const CHOICES = ["alpha", "beta", "gamma", "delta"];

/** A survey definition of a few questions; `revision` makes each history snapshot differ. */
const definitionOf = (title: string, revision: number): Record<string, unknown> => ({
  title: `${title} r${revision}`,
  pages: [
    {
      name: "page1",
      elements: [
        { type: "text", name: "name", title: "Name" },
        { type: "rating", name: "score", title: "Score", rateCount: 5 },
        { type: "radiogroup", name: "choice", title: "Choice", choices: CHOICES },
        { type: "checkbox", name: "tags", title: "Tags", choices: CHOICES },
        { type: "comment", name: "remarks", title: "Remarks" },
        { type: "boolean", name: "agree", title: "Agree" },
      ],
    },
  ],
});

async function insertBatched<T>(rows: readonly T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH) {
    await insert(rows.slice(start, start + BATCH));
  }
}

/**
 * Fills a migrated database: `users` local accounts, `surveys` surveys over the users (the first is
 * the largest, owned by the first user, with `largest` responses), `responses` responses over the
 * other surveys, and `historyPerSurvey` history entries per survey.
 */
export async function generate(
  database: SqlDatabase,
  sizes: ScaleSizes,
  progress: (line: string) => void = () => undefined,
): Promise<{ readonly largestSurveyId: string; readonly ownerId: string }> {
  const random = randomFrom(sizes.seed);
  const { db, dialect } = database;
  const at = (offsetMs: number) => new Date(BASE_TIME + offsetMs).toISOString();

  const userIds = Array.from({ length: sizes.users }, () => guid(random));
  await insertBatched(
    userIds.map((id, i) => ({
      id,
      email: `user-${i + 1}-${id.slice(0, 8)}@scale.example`,
      display_name: `Scale user ${i + 1}`,
      instance_role: "user" as const,
      status: "active" as const,
      password_hash: null,
      must_change_password: false,
      site_blocked: false,
      licence_expires_at: null,
      session_epoch: 0,
      created_at: at(0),
      last_sign_in_at: null,
    })),
    (rows) => db.insertInto("users").values(rows).execute(),
  );
  progress(`users: ${sizes.users}`);

  const surveyIds = Array.from({ length: sizes.surveys }, () => guid(random));
  const surveyRows = surveyIds.map((id, i) => {
    const definition = definitionOf(`Survey ${i + 1}`, sizes.historyPerSurvey);
    const owner = userIds[i % userIds.length]!;
    return {
      id,
      name: `Survey ${i + 1}`,
      owner_user_id: owner,
      owner_project_id: null,
      creator_id: owner,
      post_id: guid(random),
      result_id: guid(random),
      published: true,
      archived: false,
      public_results: false,
      store_respondent_ip: false,
      use_cookies: false,
      legacy_publish_id: null,
      created_at: at(i * 1000),
      updated_at: at(i * 1000 + sizes.historyPerSurvey),
      definition: jsonText(dialect, definition),
      definition_version: versionOf(definition),
      theme: null,
      theme_version: versionOf(undefined),
    };
  });
  await insertBatched(surveyRows, (rows) => db.insertInto("surveys").values(rows).execute());
  progress(`surveys: ${sizes.surveys}`);

  let historyRows = 0;
  const history = surveyIds.flatMap((surveyId, i) =>
    Array.from({ length: sizes.historyPerSurvey }, (_, revision) => ({
      survey_id: surveyId,
      id: guid(random),
      at: at(i * 1000 + revision + 1),
      user_id: userIds[i % userIds.length]!,
      snapshot: jsonText(dialect, definitionOf(`Survey ${i + 1}`, revision + 1)),
    })),
  );
  await insertBatched(history, async (rows) => {
    await db.insertInto("survey_history").values(rows).execute();
    historyRows += rows.length;
  });
  progress(`history entries: ${historyRows}`);

  // The first survey takes `largest`; the rest share `responses` evenly (the first ones the remainder).
  const others = surveyIds.length - 1;
  const perSurvey = (index: number): number =>
    index === 0
      ? sizes.largest
      : others === 0
        ? 0
        : Math.floor(sizes.responses / others) + (index - 1 < sizes.responses % others ? 1 : 0);
  let written = 0;
  for (const [index, surveyId] of surveyIds.entries()) {
    const total = perSurvey(index);
    for (let start = 0; start < total; start += BATCH) {
      const rows = Array.from({ length: Math.min(BATCH, total - start) }, (_, k) => {
        const n = start + k;
        const answers = {
          name: `Respondent ${n}`,
          score: 1 + Math.floor(random() * 5),
          choice: CHOICES[Math.floor(random() * CHOICES.length)]!,
          tags: CHOICES.filter(() => random() < 0.4),
          remarks: `Remark ${n} ${"lorem ipsum ".repeat(1 + Math.floor(random() * 8))}`.trim(),
          agree: random() < 0.5,
        };
        return {
          survey_id: surveyId,
          id: guid(random),
          submitted_at: at(index * 1000 + n * 1000),
          data: jsonText(dialect, answers),
          client_id: null,
          respondent_ip: null,
          partial: false,
        };
      });
      await db.insertInto("survey_responses").values(rows).execute();
      written += rows.length;
      if (written % 50_000 < rows.length) progress(`responses: ${written}`);
    }
  }
  progress(`responses: ${written}`);
  return { largestSurveyId: surveyIds[0]!, ownerId: userIds[0]! };
}

/** The target the server reads: DATABASE_URL (PostgreSQL), else SQLITE_PATH. */
function targetFromEnv() {
  const url = process.env.DATABASE_URL;
  return url
    ? ({ dialect: "postgres", url } as const)
    : ({ dialect: "sqlite", path: process.env.SQLITE_PATH ?? "/data/surveyjs-studio.db" } as const);
}

async function main(): Promise<number> {
  const parsed = parseSizes(process.argv.slice(2).filter((arg) => arg !== "--"));
  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(GENERATE_USAGE);
    return 2;
  }
  const database = openDatabase(targetFromEnv());
  try {
    await migrate(database);
    const started = Date.now();
    const { largestSurveyId, ownerId } = await generate(database, parsed.sizes, (line) =>
      console.log(line),
    );
    // The owner's API token, so that scale:check can sign in. The data is synthetic.
    const token = newApiTokenValue();
    await database.db
      .insertInto("api_tokens")
      .values({
        id: randomUUID(),
        creator_id: ownerId,
        project_id: null,
        name: "scale",
        token_hash: hashCredential(token, "api-token"),
        last_four: lastFour(token),
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked_at: null,
      })
      .execute();
    console.log(`generated in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    console.log(`--survey ${largestSurveyId} --token ${token}`);
    return 0;
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
