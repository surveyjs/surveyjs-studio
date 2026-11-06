/**
 * Empty databases for tests: a SQLite file in a temporary folder, or a new database on the
 * PostgreSQL server that `DATABASE_URL` names (`pnpm postgres:up`, docker/postgres.env).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { openDatabase, type DatabaseTarget, type SqlDialectName } from "./database.js";

export interface ScratchDatabase {
  readonly target: DatabaseTarget;
  /** Deletes the database. Close every connection to it first. */
  drop(): Promise<void>;
}

export function scratchSqlite(): ScratchDatabase {
  const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-sqlite-"));
  return {
    target: { dialect: "sqlite", path: join(dir, "test.db") },
    drop: () => {
      rmSync(dir, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

/** The server's URL; a test project that needs it reads docker/postgres.env. */
function postgresUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("PostgreSQL tests need DATABASE_URL (see docker/postgres.env)");
  return url;
}

export async function scratchPostgres(): Promise<ScratchDatabase> {
  const name = `test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: postgresUrl() });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(postgresUrl());
  url.pathname = `/${name}`;
  return {
    target: { dialect: "postgres", url: url.toString() },
    async drop() {
      const client = new pg.Client({ connectionString: postgresUrl() });
      await client.connect();
      try {
        await client.query(`drop database if exists ${name} with (force)`);
      } finally {
        await client.end();
      }
    },
  };
}

export const scratchDatabase = (dialect: SqlDialectName): Promise<ScratchDatabase> =>
  dialect === "sqlite" ? Promise.resolve(scratchSqlite()) : scratchPostgres();

export { openDatabase };
