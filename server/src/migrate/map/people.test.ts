import { describe, expect, it } from "vitest";
import { hashCredential, lastFour } from "../../credentials/format.js";
import { mapPeople } from "./people.js";
import { createReport } from "./report.js";

const run = "2026-11-25T10:00:00.000Z";
const id = (n: number) => `0A1B2C3D-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
interface Row {
  id: string;
  email: string | null;
  displayname: string | null;
  blocked: number | null;
  accesskey: string | null;
}
const row = (n: number, email: string | null, extra: Partial<Row> = {}): Row => ({
  id: id(n),
  email,
  displayname: "Name",
  blocked: 0,
  accesskey: null,
  ...extra,
});
const all = (rows: Row[]) => new Set(rows.map((r) => r.id.toLowerCase()));

describe("mapPeople", () => {
  it("maps a person: lower-case id and email, name, block flag, run start time", () => {
    const rows = [row(1, "Ann@Example.COM", { blocked: 1 })];
    expect(mapPeople(rows, all(rows), run, createReport()).people).toEqual([
      {
        id: id(1).toLowerCase(),
        email: "ann@example.com",
        displayName: "Name",
        siteBlocked: true,
        createdAt: run,
      },
    ]);
  });

  it("uses the email for a blank or missing display name", () => {
    const rows = [row(1, "a@x.io", { displayname: "  " }), row(2, "b@x.io", { displayname: null })];
    const names = mapPeople(rows, all(rows), run, createReport()).people.map((p) => p.displayName);
    expect(names).toEqual(["a@x.io", "b@x.io"]);
  });

  it("maps only people the copied data names", () => {
    const rows = [row(1, "a@x.io"), row(2, "b@x.io")];
    const people = mapPeople(rows, new Set([id(2).toLowerCase()]), run, createReport()).people;
    expect(people.map((p) => p.id)).toEqual([id(2).toLowerCase()]);
  });

  it("excludes and reports people with no email, and never makes an @invalid email", () => {
    const rows = [row(1, null), row(2, "  "), row(3, "x@invalid"), row(4, "ok@x.io")];
    const report = createReport();
    const { people, keys } = mapPeople(
      [...rows.slice(0, 3).map((r) => ({ ...r, accesskey: "KEY" })), rows[3]!],
      all(rows),
      run,
      report,
    );
    expect(people.map((p) => p.id)).toEqual([id(4).toLowerCase()]);
    expect(keys).toEqual([]);
    expect(report.counts()).toEqual({ person_without_email: 3 });
    expect(JSON.stringify(report.toJSON())).not.toContain("invalid");
  });

  it("excludes and reports both people whose emails are equal after lower-casing", () => {
    const rows = [row(1, "A@x.io"), row(2, "a@X.io"), row(3, "c@x.io")];
    const report = createReport();
    const { people } = mapPeople(rows, all(rows), run, report);
    expect(people.map((p) => p.id)).toEqual([id(3).toLowerCase()]);
    expect(report.counts()).toEqual({ person_email_conflict: 2 });
  });

  it("excludes a named person whose email equals an unnamed user's after lower-casing", () => {
    const rows = [row(1, "A@x.io"), row(2, "a@X.io"), row(3, "c@x.io")];
    const report = createReport();
    const named = new Set([id(1).toLowerCase(), id(3).toLowerCase()]);
    const { people } = mapPeople(rows, named, run, report);
    expect(people.map((p) => p.id)).toEqual([id(3).toLowerCase()]);
    expect(report.toJSON()).toMatchObject({
      notes: [{ kind: "person_email_conflict", ids: { userId: id(1).toLowerCase() } }],
    });
  });

  it("skips and reports an id that is not a GUID", () => {
    const rows = [{ ...row(1, "a@x.io"), id: "not-a-guid" }];
    const report = createReport();
    expect(mapPeople(rows, new Set(["not-a-guid"]), run, report).people).toEqual([]);
    expect(report.counts()).toEqual({ "skipped:person": 1 });
  });

  it("hashes keys without regard to case and keeps the last four of the lower-case key", () => {
    const rows = [
      row(1, "a@x.io", { accesskey: "ABCDEF12-34" }),
      row(2, "b@x.io", { accesskey: "" }),
    ];
    const { keys } = mapPeople(rows, all(rows), run, createReport());
    expect(keys).toEqual([
      {
        userId: id(1).toLowerCase(),
        keyHash: hashCredential("abcdef12-34", "legacy-key"),
        lastFour: lastFour("abcdef12-34"),
        createdAt: run,
      },
    ]);
    expect(keys[0]!.keyHash).toBe(hashCredential("ABCDEF12-34", "legacy-key"));
  });
});
