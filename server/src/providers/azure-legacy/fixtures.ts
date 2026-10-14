import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemorySeed } from "../memory.js";
import { membershipFromLegacy, surveyFromLegacy, userFromLegacy } from "./mapping.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacyResultEntity,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

/**
 * Reader for the golden fixtures in `server/fixtures/legacy` (format: that folder's README.md).
 * It turns fixture JSON into the typed legacy rows of rows.ts and keeps the raw data for the
 * replica loader.
 */

export const DEFAULT_FIXTURE_DIR = fileURLToPath(
  new URL("../../../fixtures/legacy/", import.meta.url),
);

/** One Azure Table entity as stored in a fixture file: Table REST JSON with `@odata.type` annotations. */
export type RawTableEntity = Record<string, string | number | boolean | null>;

export interface LegacyBlob {
  account: string;
  container: string;
  /** May contain `/` (nested folders). */
  name: string;
  content: Buffer;
}

export interface LegacyFile {
  account: string;
  share: string;
  name: string;
  content: Buffer;
}

export interface LegacyTable {
  account: string;
  name: string;
  entities: RawTableEntity[];
}

export interface LegacyFixtures {
  surveys: LegacySurveyRow[];
  users: LegacyUserRow[];
  organizations: LegacyOrganizationRow[];
  organizationUsers: LegacyOrganizationUserRow[];
  /** Raw SQL rows by table name, every column, values as in the JSON file. */
  rawSqlRows: Record<string, Record<string, unknown>[]>;
  /** Result entities by post table name (`post{postId without dashes}`). */
  resultsByTable: Record<string, LegacyResultEntity[]>;
  /** Raw annotated entities of every table file. */
  tables: LegacyTable[];
  blobs: LegacyBlob[];
  files: LegacyFile[];
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Relative file paths under `dir`, always with `/` separators, sorted. */
async function walkFiles(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(join(dir, entry.name), `${prefix}${entry.name}/`)));
    } else {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`Fixture ${path} must hold a JSON array`);
  return parsed as T[];
}

const str = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Fixture column "${column}" must be a string`);
  return value;
};
const optStr = (row: Record<string, unknown>, column: string): string | null => {
  const value = row[column];
  return typeof value === "string" ? value : null;
};
const optNum = (row: Record<string, unknown>, column: string): number | null => {
  const value = row[column];
  return typeof value === "number" ? value : null;
};
const date = (row: Record<string, unknown>, column: string): Date => {
  const value = new Date(str(row, column));
  if (Number.isNaN(value.getTime())) throw new Error(`Fixture column "${column}" is not a date`);
  return value;
};

function surveyRow(row: Record<string, unknown>): LegacySurveyRow {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    userid: str(row, "userid"),
    creatorid: str(row, "creatorid"),
    postid: str(row, "postid"),
    resultid: str(row, "resultid"),
    createdat: date(row, "createdat"),
    timestamp: date(row, "timestamp"),
    ispublished: optNum(row, "ispublished"),
    isarchived: optNum(row, "isarchived"),
    allowaccessresult: optNum(row, "allowaccessresult"),
    storeipaddress: optStr(row, "storeipaddress"),
    usecookies: optNum(row, "usecookies"),
  };
}

/** An `Edm.DateTime` property: the file must carry the annotation, the value becomes a Date. */
function annotatedDate(entity: RawTableEntity, property: string): Date {
  if (entity[`${property}@odata.type`] !== "Edm.DateTime") {
    throw new Error(`Table entity property "${property}" must be annotated Edm.DateTime`);
  }
  return new Date(String(entity[property]));
}

function resultEntity(entity: RawTableEntity): LegacyResultEntity {
  const result: LegacyResultEntity = {
    id: String(entity.id),
    happendat: annotatedDate(entity, "happendat"),
    result: String(entity.result),
  };
  if (typeof entity.clientid === "string") result.clientid = entity.clientid;
  if (typeof entity.ipaddress === "string") result.ipaddress = entity.ipaddress;
  if (typeof entity.ispartialcompleted === "boolean") {
    result.ispartialcompleted = entity.ispartialcompleted;
  }
  return result;
}

async function readTables(dir: string): Promise<LegacyTable[]> {
  const tables: LegacyTable[] = [];
  for (const account of await listDir(join(dir, "tables"))) {
    for (const file of await listDir(join(dir, "tables", account))) {
      if (!file.endsWith(".json")) continue;
      tables.push({
        account,
        name: file.slice(0, -".json".length),
        entities: await readJsonArray<RawTableEntity>(join(dir, "tables", account, file)),
      });
    }
  }
  return tables;
}

async function readBlobs(dir: string): Promise<LegacyBlob[]> {
  const blobs: LegacyBlob[] = [];
  for (const account of await listDir(join(dir, "blobs"))) {
    for (const container of await listDir(join(dir, "blobs", account))) {
      const root = join(dir, "blobs", account, container);
      for (const name of await walkFiles(root)) {
        blobs.push({ account, container, name, content: await readFile(join(root, name)) });
      }
    }
  }
  return blobs;
}

async function readFiles(dir: string): Promise<LegacyFile[]> {
  const files: LegacyFile[] = [];
  for (const account of await listDir(join(dir, "files"))) {
    for (const share of await listDir(join(dir, "files", account))) {
      const root = join(dir, "files", account, share);
      for (const name of await walkFiles(root)) {
        files.push({ account, share, name, content: await readFile(join(root, name)) });
      }
    }
  }
  return files;
}

export async function readLegacyFixtures(
  dir: string = DEFAULT_FIXTURE_DIR,
): Promise<LegacyFixtures> {
  const rawSqlRows: Record<string, Record<string, unknown>[]> = {};
  for (const table of ["Users", "Surveys", "Organizations", "OrganizationUsers"]) {
    const path = join(dir, "sql", `${table}.json`);
    rawSqlRows[table] = (await listDir(join(dir, "sql"))).includes(`${table}.json`)
      ? await readJsonArray<Record<string, unknown>>(path)
      : [];
  }
  const tables = await readTables(dir);
  const resultsByTable: Record<string, LegacyResultEntity[]> = {};
  for (const table of tables) {
    if (table.account === "results" && /^post(?!delete)/.test(table.name)) {
      resultsByTable[table.name] = table.entities.map(resultEntity);
    }
  }
  return {
    surveys: (rawSqlRows.Surveys ?? []).map(surveyRow),
    users: (rawSqlRows.Users ?? []).map((row): LegacyUserRow => ({
      id: str(row, "id"),
      email: str(row, "email"),
      displayname: optStr(row, "displayname"),
      blocked: optNum(row, "blocked"),
    })),
    organizations: (rawSqlRows.Organizations ?? []).map((row): LegacyOrganizationRow => ({
      id: str(row, "id"),
      name: str(row, "name"),
    })),
    organizationUsers: (rawSqlRows.OrganizationUsers ?? []).map(
      (row): LegacyOrganizationUserRow => ({
        id: str(row, "id"),
        organizationid: str(row, "organizationid"),
        userid: str(row, "userid"),
        role: str(row, "role"),
      }),
    ),
    rawSqlRows,
    resultsByTable,
    tables,
    blobs: await readBlobs(dir),
    files: await readFiles(dir),
  };
}

/**
 * Fixtures -> domain through the legacy mapping. A survey whose `userid` is an
 * `Organizations.id` is a project survey, any other is personal.
 */
export async function legacyFixtureSeed(dir?: string): Promise<MemorySeed> {
  const fixtures = await readLegacyFixtures(dir);
  const orgs = new Map(fixtures.organizations.map((org) => [org.id.toLowerCase(), org]));
  return {
    users: fixtures.users.map(userFromLegacy),
    surveys: fixtures.surveys.map((row) =>
      surveyFromLegacy(row, orgs.has((row.userid ?? "").toLowerCase()) ? "project" : "personal"),
    ),
    memberships: fixtures.organizationUsers.map((member) => {
      const org = orgs.get(member.organizationid.toLowerCase());
      if (!org)
        throw new Error(`Membership refers to unknown organization ${member.organizationid}`);
      return { userId: member.userid.toLowerCase(), membership: membershipFromLegacy(org, member) };
    }),
  };
}
