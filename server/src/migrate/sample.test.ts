import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
} from "../providers/azure-legacy/rows.js";
import { createReport } from "./map/report.js";
import { inSampleShare, selectSample } from "./sample.js";
import type { LegacySource } from "./source/index.js";

const id = (group: string, n: number) =>
  `${group.repeat(8)}-0000-4000-8000-A${String(n).padStart(11, "0")}`;
const user = (n: number) => id("1", n);
const project = (n: number) => id("5", n);
const survey = (n: number) => id("2", n);
const ZERO = "00000000-0000-0000-0000-000000000000";

const ALICE = user(1);
const BOB = user(2);
const CAROL = user(3);
const P1 = project(1); // Alice and Bob
const P2 = project(2); // Carol only
const P_EMPTY = project(3); // no members
const MISSING_PROJECT = project(9);

const surveyRow = (
  n: number,
  owner: string,
  creator: string | null,
): LegacySurveyRow & {
  theme: string | null;
} =>
  ({
    id: survey(n),
    name: `S${n}`,
    userid: owner,
    creatorid: creator,
    postid: id("3", n),
    resultid: id("4", n),
    theme: null,
  }) as unknown as LegacySurveyRow & { theme: string | null };

const SURVEYS = [
  surveyRow(1, ALICE, ALICE), // Alice's own
  surveyRow(2, BOB, BOB), // Bob's own: not pulled in through P1
  surveyRow(3, P1, BOB), // P1's
  surveyRow(4, P2, CAROL), // P2's
  surveyRow(5, MISSING_PROJECT, ALICE), // a missing project's, Alice created it
  surveyRow(6, P_EMPTY, CAROL), // a member-less project's, Carol created it
  surveyRow(7, MISSING_PROJECT, ZERO),
];

function fakeSource(): LegacySource {
  const users = [ALICE, BOB, CAROL].map((userId) => ({ id: userId, accesskey: null }));
  const orgs: LegacyOrganizationRow[] = [P1, P2, P_EMPTY].map((orgId) => ({
    id: orgId,
    name: orgId,
    happendat: null,
  })) as unknown as LegacyOrganizationRow[];
  const members = [
    [P1, ALICE],
    [P1, BOB],
    [P2, CAROL],
  ].map(([orgId, userId], i) => ({
    id: id("6", i + 1),
    organizationid: orgId,
    userid: userId,
    role: "user",
    happendat: null,
  })) as unknown as LegacyOrganizationUserRow[];
  async function* of<T>(items: readonly T[]): AsyncGenerator<T> {
    yield* items;
  }
  return {
    users: () => of(users),
    surveys: () => of(SURVEYS),
    organizations: () => of(orgs),
    organizationUsers: () => of(members),
  } as unknown as LegacySource;
}

const lower = (values: readonly string[]) => new Set(values.map((v) => v.toLowerCase()));

describe("inSampleShare", () => {
  it("compares the first 32 bits of the id's SHA-256 with the share", () => {
    const value =
      parseInt(createHash("sha256").update(ALICE.toLowerCase()).digest("hex").slice(0, 8), 16) /
      2 ** 32;
    expect(inSampleShare(ALICE, value)).toBe(false);
    expect(inSampleShare(ALICE, value + 1e-9)).toBe(true);
    expect(inSampleShare(ALICE.toUpperCase(), value + 1e-9)).toBe(true);
    expect(inSampleShare(ALICE, 0)).toBe(false);
    expect(inSampleShare(ALICE, 1)).toBe(true);
  });
});

describe("selectSample", () => {
  it("holds an included account's closure: its surveys and projects, not its members' surveys", async () => {
    const report = createReport();
    const sample = await selectSample(fakeSource(), 0, [` ${ALICE.toUpperCase()} `], report);
    expect(sample.accounts).toEqual(lower([ALICE]));
    expect(sample.projects).toEqual(lower([P1]));
    // Its own, its project's, and the missing project's one it created (it moves to Alice).
    expect(sample.surveys).toEqual(lower([survey(1), survey(3), survey(5)]));
    expect(report.counts()).toEqual({});
  });

  it("takes a member-less project's survey with its creator", async () => {
    const sample = await selectSample(fakeSource(), 0, [CAROL]);
    expect(sample.projects).toEqual(lower([P2]));
    expect(sample.surveys).toEqual(lower([survey(4), survey(6)]));
  });

  it("is the same for the same share and include list, and everything for share 1", async () => {
    const shares = [0, 0.3, 0.6, 1];
    for (const share of shares) {
      const once = await selectSample(fakeSource(), share, [BOB]);
      const again = await selectSample(fakeSource(), share, [BOB]);
      expect(again).toEqual(once);
      const expected = [ALICE, BOB, CAROL].filter(
        (account) => account === BOB || inSampleShare(account, share),
      );
      expect(once.accounts).toEqual(lower(expected));
    }
    const all = await selectSample(fakeSource(), 1, []);
    expect(all.projects).toEqual(lower([P1, P2]));
    expect(all.surveys).toEqual(lower(SURVEYS.slice(0, 6).map((row) => row.id)));
  });

  it("counts a member as the copy does: only a role the copy keeps, and a project left with none moves its surveys", async () => {
    const DAVE = user(4);
    const O1 = project(11); // Bob admin; Alice only with a role that is no role
    const O2 = project(12); // only Bob, with a role that is no role: the copy skips it (member-less)
    const S1 = survey(11); // O1's, created by Bob
    const S2 = survey(12); // O2's, created by Alice: the copy moves it to Alice
    const S3 = survey(13); // O2's, created by Dave: moves to Dave, not Alice's
    async function* of<T>(items: readonly T[]): AsyncGenerator<T> {
      yield* items;
    }
    const member = (n: number, org: string, userId: string, role: string) =>
      ({
        id: id("6", n),
        organizationid: org,
        userid: userId,
        role,
        happendat: null,
      }) as LegacyOrganizationUserRow;
    const source = {
      users: () => of([ALICE, BOB, DAVE].map((userId) => ({ id: userId, accesskey: null }))),
      organizations: () =>
        of(
          [O1, O2].map((org) => ({
            id: org,
            name: org,
            happendat: null,
          })) as LegacyOrganizationRow[],
        ),
      organizationUsers: () =>
        of([
          member(1, O1, BOB, "admin"),
          member(2, O1, ALICE, "owner"),
          member(3, O2, BOB, "owner"),
        ]),
      surveys: () =>
        of([surveyRow(11, O1, BOB), surveyRow(12, O2, ALICE), surveyRow(13, O2, DAVE)]),
    } as unknown as LegacySource;

    const sample = await selectSample(source, 0, [ALICE]);
    expect(sample.projects).toEqual(new Set());
    expect(sample.surveys).toEqual(lower([S2]));
    expect(sample.surveys.has(S1.toLowerCase())).toBe(false);
    expect(sample.surveys.has(S3.toLowerCase())).toBe(false);
  });

  it("reports an included id that is no account, and an id that is no GUID", async () => {
    const report = createReport();
    const unknown = user(99);
    const sample = await selectSample(fakeSource(), 0, [unknown, "not-a-guid", ""], report);
    expect(sample.surveys).toEqual(new Set());
    expect(report.toJSON()).toMatchObject({
      notes: [
        { kind: "sample_include_unknown", ids: { accountId: unknown.toLowerCase() } },
        { kind: "sample_include_unknown", ids: { accountId: "not-a-guid" } },
      ],
    });
  });
});
