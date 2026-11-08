import { describe, expect, it } from "vitest";
import { seed, setupSandbox, SURVEYS, USERS } from "./testing";

const path = (surveyId: string, view: string) => `/surveys/${surveyId}/views/${view}`;
const put = (json: unknown, user: string) => ({ method: "PUT", json, user });

describe("results views", () => {
  it("answers 404 view-not-found where nothing is saved and there is no legacy layout", async () => {
    const { call } = setupSandbox();
    const response = await call(path(SURVEYS.campaign, "summary"), { user: USERS.owner });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "view-not-found",
      title: "View not found",
    });
  });

  it("saves a layout per user: one user's is not seen by another", async () => {
    const { call } = setupSandbox();
    const layout = { elements: [{ name: "satisfaction", isVisible: false }] };
    expect((await call(path(SURVEYS.campaign, "table"), put(layout, USERS.owner))).status).toBe(
      204,
    );
    const own = await call(path(SURVEYS.campaign, "table"), { user: USERS.owner });
    expect(await own.json()).toStrictEqual(layout);
    // Another user sees none, and the other view is not changed.
    expect((await call(path(SURVEYS.campaign, "table"), { user: USERS.member })).status).toBe(404);
    expect((await call(path(SURVEYS.campaign, "summary"), { user: USERS.owner })).status).toBe(404);
    // Saving again replaces; saving does not touch the survey.
    expect((await call(path(SURVEYS.campaign, "table"), put({ x: 1 }, USERS.owner))).status).toBe(
      204,
    );
    expect(
      await (await call(path(SURVEYS.campaign, "table"), { user: USERS.owner })).json(),
    ).toStrictEqual({ x: 1 });
    const before = seed.surveys.find((s) => s.id === SURVEYS.campaign)!.updatedAt;
    const survey = await (await call(`/surveys/${SURVEYS.campaign}`, { user: USERS.owner })).json();
    expect(survey.updatedAt).toBe(before);
  });

  it("answers the legacy layout until the user resets, then 404 until the next save", async () => {
    const { call } = setupSandbox();
    const legacy = seed.legacyViews[SURVEYS.feedback]!.summary;
    expect(
      await (await call(path(SURVEYS.feedback, "summary"), { user: USERS.owner })).json(),
    ).toStrictEqual(legacy);
    expect(
      (await call(path(SURVEYS.feedback, "summary"), { method: "DELETE", user: USERS.owner }))
        .status,
    ).toBe(204);
    expect((await call(path(SURVEYS.feedback, "summary"), { user: USERS.owner })).status).toBe(404);
    // Resetting a view without a saved layout also answers 204.
    expect(
      (await call(path(SURVEYS.feedback, "summary"), { method: "DELETE", user: USERS.owner }))
        .status,
    ).toBe(204);
    expect((await call(path(SURVEYS.feedback, "summary"), put({ a: 1 }, USERS.owner))).status).toBe(
      204,
    );
    expect(
      await (await call(path(SURVEYS.feedback, "summary"), { user: USERS.owner })).json(),
    ).toStrictEqual({ a: 1 });
    // The table view still answers the legacy layout.
    expect(
      await (await call(path(SURVEYS.feedback, "table"), { user: USERS.owner })).json(),
    ).toStrictEqual(seed.legacyViews[SURVEYS.feedback]!.table);
  });

  it("answers 401, 404 and 400 as the server", async () => {
    const { call } = setupSandbox();
    expect((await call(path(SURVEYS.feedback, "summary"))).status).toBe(401);
    expect((await call(path(SURVEYS.feedback, "summary"), { user: USERS.member })).status).toBe(
      404,
    );
    expect((await call(path(SURVEYS.feedback, "summary"), put({}, USERS.member))).status).toBe(404);
    expect((await call(path(SURVEYS.feedback, "other"), { user: USERS.owner })).status).toBe(400);
    const array = await call(path(SURVEYS.feedback, "summary"), put([1], USERS.owner));
    expect(array.status).toBe(422);
    const empty = await call(path(SURVEYS.feedback, "summary"), {
      method: "PUT",
      user: USERS.owner,
    });
    expect(empty.status).toBe(422);
  });
});
