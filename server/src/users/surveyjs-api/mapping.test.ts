import { describe, expect, it } from "vitest";
import { licenceExpiriesFromApi, userFromApi, usersFromLookup } from "./mapping.js";

const id = "11111111-0000-4000-8000-A00000000001";
const full = { id, email: "owner@example.com", displayName: "Olivia Owner", blocked: false };

describe("userFromApi", () => {
  it("maps a full user and lower-cases the id", () => {
    expect(userFromApi(full)).toEqual({
      id: id.toLowerCase(),
      email: "owner@example.com",
      displayName: "Olivia Owner",
      blocked: false,
    });
  });

  it.each([{ displayName: "  " }, { displayName: "" }, { displayName: null }, {}])(
    "falls back to the email for a blank or missing display name (%j)",
    (extra) => {
      const withoutName: Record<string, unknown> = { ...full };
      delete withoutName.displayName;
      expect(userFromApi({ ...withoutName, ...extra })?.displayName).toBe("owner@example.com");
    },
  );

  it("ignores extra members", () => {
    expect(userFromApi({ ...full, role: "admin" })).toEqual(userFromApi(full));
  });

  it.each([
    ["blocked is not a boolean", { ...full, blocked: 0 }],
    ["the id is not a GUID", { ...full, id: "not-a-guid" }],
    ["the email is missing", { ...full, email: undefined }],
    ["the display name is a number", { ...full, displayName: 5 }],
    ["null", null],
    ["an array", [full]],
    ["a string", "user"],
  ])("gives null when %s", (_name, value) => {
    expect(userFromApi(value)).toBeNull();
  });
});

describe("usersFromLookup", () => {
  it("maps every user of the answer", () => {
    expect(usersFromLookup({ users: [full, full] })).toHaveLength(2);
    expect(usersFromLookup({ users: [] })).toEqual([]);
  });

  it("gives null when one item is bad or the answer is not one", () => {
    expect(usersFromLookup({ users: [full, { id: "x" }] })).toBeNull();
    expect(usersFromLookup({})).toBeNull();
    expect(usersFromLookup(null)).toBeNull();
  });
});

describe("licenceExpiriesFromApi", () => {
  it("keeps a null expiry and parses instants with Z or an offset", () => {
    expect(
      licenceExpiriesFromApi({
        licences: [
          { expiresAt: null },
          { expiresAt: "2027-06-01T00:00:00Z" },
          { expiresAt: "2027-06-01T02:00:00+02:00" },
        ],
      }),
    ).toEqual([null, new Date("2027-06-01T00:00:00Z"), new Date("2027-06-01T00:00:00Z")]);
  });

  it("gives an empty list for no licences", () => {
    expect(licenceExpiriesFromApi({ licences: [] })).toEqual([]);
  });

  it.each([
    ["a date without a time", { licences: [{ expiresAt: "2027-06-01" }] }],
    ["text", { licences: [{ expiresAt: "soon" }] }],
    ["a missing expiry", { licences: [{}] }],
    ["a licence that is not an object", { licences: [null] }],
    ["missing licences", {}],
    ["null", null],
  ])("gives null for %s", (_name, value) => {
    expect(licenceExpiriesFromApi(value)).toBeNull();
  });
});
