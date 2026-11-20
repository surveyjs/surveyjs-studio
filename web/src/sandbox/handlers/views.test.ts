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
    const legacy = JSON.parse(seed.layouts[SURVEYS.feedback]!.summary!);
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
    ).toStrictEqual(JSON.parse(seed.layouts[SURVEYS.feedback]!.table!));
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

const layout = (surveyId: string, kind: string) => `/surveys/${surveyId}/layouts/${kind}`;
const TEXT = ' {\n  "pageSize": 25,  "elements": [] }\n';

describe("shared layouts", () => {
  it("saves, reads verbatim and deletes each kind", async () => {
    const { call } = setupSandbox();
    expect((await call(layout(SURVEYS.campaign, "table"), { user: USERS.owner })).status).toBe(404);
    for (const kind of ["table", "summary", "columns"]) {
      expect(
        (await call(layout(SURVEYS.campaign, kind), put({ text: `${kind}${TEXT}` }, USERS.owner)))
          .status,
      ).toBe(204);
    }
    const read = await call(layout(SURVEYS.campaign, "columns"), { user: USERS.member });
    expect(await read.json()).toStrictEqual({ text: `columns${TEXT}` });
    const del = { method: "DELETE", user: USERS.owner };
    expect((await call(layout(SURVEYS.campaign, "columns"), del)).status).toBe(204);
    expect((await call(layout(SURVEYS.campaign, "columns"), del)).status).toBe(204);
    const gone = await call(layout(SURVEYS.campaign, "columns"), { user: USERS.owner });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "layout-not-found" });
  });

  it("serves the seeded layouts, and falls back to them as a view", async () => {
    const { call } = setupSandbox();
    const columns = await call(layout(SURVEYS.feedback, "columns"), { user: USERS.owner });
    expect(JSON.parse((await columns.json()).text)).toMatchObject({ newcolumnsvisibility: 0 });
    const saved = JSON.stringify({ pageSize: 5 });
    await call(layout(SURVEYS.campaign, "table"), put({ text: saved }, USERS.owner));
    const fallback = await call(path(SURVEYS.campaign, "table"), { user: USERS.member });
    expect(await fallback.json()).toStrictEqual({ pageSize: 5 });
    await call(layout(SURVEYS.campaign, "summary"), put({ text: "[1]" }, USERS.owner));
    expect((await call(path(SURVEYS.campaign, "summary"), { user: USERS.owner })).status).toBe(404);
  });

  it("refuses as the server: 400 kind, 422 body, 401, 403 and 404", async () => {
    const { call } = setupSandbox();
    expect((await call(layout(SURVEYS.campaign, "charts"), { user: USERS.owner })).status).toBe(
      400,
    );
    for (const body of [{ text: "" }, {}, { text: 5 }]) {
      const response = await call(layout(SURVEYS.campaign, "table"), put(body, USERS.owner));
      expect(response.status).toBe(422);
    }
    expect((await call(layout(SURVEYS.campaign, "table"))).status).toBe(401);
    // Someone outside the survey's scope sees nothing.
    expect(
      (await call(layout(SURVEYS.feedback, "table"), put({ text: "{}" }, USERS.member))).status,
    ).toBe(404);
  });

  it("is not routed outside the hosted edition: the public layout and the legacy upload answer 404", async () => {
    const { call } = setupSandbox();
    const publicLayout = await call(`/public/surveys/${SURVEYS.feedback}/layouts/table`);
    expect(publicLayout.status).toBe(404);
    expect(await publicLayout.json()).toMatchObject({ code: "not-found" });
    const upload = await call("/legacy-files", { method: "POST", user: USERS.owner });
    expect(upload.status).toBe(404);
  });
});
