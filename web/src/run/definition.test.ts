import { describe, expect, it } from "vitest";
import { forRunPage, limitCookieOf, withServerFileStorage } from "./definition";

describe("withServerFileStorage", () => {
  it("makes File Upload and Signature Pad questions at the top level store on the server", () => {
    const definition = {
      elements: [
        { type: "file", name: "receipt" },
        { type: "signaturepad", name: "signature" },
        { type: "text", name: "comment" },
      ],
    };

    expect(withServerFileStorage(definition)).toEqual({
      elements: [
        { type: "file", name: "receipt", storeDataAsText: false },
        { type: "signaturepad", name: "signature", storeDataAsText: false },
        { type: "text", name: "comment" },
      ],
    });
  });

  it("overrides an explicit storeDataAsText: true", () => {
    const definition = { elements: [{ type: "file", name: "receipt", storeDataAsText: true }] };

    expect(withServerFileStorage(definition)).toEqual({
      elements: [{ type: "file", name: "receipt", storeDataAsText: false }],
    });
  });

  it("reaches questions in pages, panels and dynamic panels' templates", () => {
    const definition = {
      pages: [
        {
          name: "page1",
          elements: [
            { type: "panel", name: "p", elements: [{ type: "file", name: "inPanel" }] },
            {
              type: "paneldynamic",
              name: "d",
              templateElements: [
                { type: "signaturepad", name: "inTemplate" },
                { type: "text", name: "note" },
              ],
            },
          ],
        },
      ],
    };

    expect(withServerFileStorage(definition)).toEqual({
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "panel",
              name: "p",
              elements: [{ type: "file", name: "inPanel", storeDataAsText: false }],
            },
            {
              type: "paneldynamic",
              name: "d",
              templateElements: [
                { type: "signaturepad", name: "inTemplate", storeDataAsText: false },
                { type: "text", name: "note" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("reaches matrix columns of a file cell type, their own or the matrix's", () => {
    const definition = {
      elements: [
        {
          type: "matrixdynamic",
          name: "m",
          columns: [
            { name: "scan", cellType: "file" },
            { name: "sign", cellType: "signaturepad" },
            { name: "label", cellType: "text" },
          ],
        },
        {
          type: "matrixdropdown",
          name: "n",
          cellType: "file",
          columns: [
            { name: "a" },
            { name: "b", cellType: "default" },
            { name: "c", cellType: "text" },
          ],
        },
      ],
    };

    expect(withServerFileStorage(definition)).toEqual({
      elements: [
        {
          type: "matrixdynamic",
          name: "m",
          columns: [
            { name: "scan", cellType: "file", storeDataAsText: false },
            { name: "sign", cellType: "signaturepad", storeDataAsText: false },
            { name: "label", cellType: "text" },
          ],
        },
        {
          type: "matrixdropdown",
          name: "n",
          cellType: "file",
          columns: [
            { name: "a", storeDataAsText: false },
            { name: "b", cellType: "default", storeDataAsText: false },
            { name: "c", cellType: "text" },
          ],
        },
      ],
    });
  });

  it("leaves the input unchanged", () => {
    const definition = {
      title: "Feedback",
      pages: [{ elements: [{ type: "panel", elements: [{ type: "file", name: "f" }] }] }],
      elements: [{ type: "matrixdynamic", columns: [{ name: "c", cellType: "file" }] }],
    };
    const before = structuredClone(definition);

    withServerFileStorage(definition);

    expect(definition).toEqual(before);
  });
});

describe("forRunPage", () => {
  it("drops the old service's surveyId, surveyPostId and clientId", () => {
    const definition = {
      title: "Feedback",
      surveyId: "old-survey",
      surveyPostId: "old-post",
      clientId: "old-client",
      elements: [{ type: "text", name: "surveyId" }],
    };

    expect(forRunPage(definition, null)).toEqual({
      title: "Feedback",
      elements: [{ type: "text", name: "surveyId" }],
    });
  });

  it("sets the cookie name it is given", () => {
    const definition = { cookieName: "msid_csrf=x; path=/; a", elements: [] };

    expect(forRunPage(definition, "msid_csrf%3Dx%3B%20path%3D%2F%3B%20a")).toEqual({
      cookieName: "msid_csrf%3Dx%3B%20path%3D%2F%3B%20a",
      elements: [],
    });
  });

  it("drops a cookie name without a limit", () => {
    expect(forRunPage({ cookieName: 3 }, null)).toEqual({});
  });

  it("stores files on the server", () => {
    expect(forRunPage({ elements: [{ type: "file", name: "f" }] }, null)).toEqual({
      elements: [{ type: "file", name: "f", storeDataAsText: false }],
    });
  });

  it("leaves the input unchanged", () => {
    const definition = { surveyPostId: "old-post", cookieName: "a b" };
    const before = structuredClone(definition);

    forRunPage(definition, "a%20b");

    expect(definition).toEqual(before);
  });
});

describe("limitCookieOf", () => {
  it.each([
    [
      { cookieName: "11111111-0000-4000-8000-000000000001" },
      "11111111-0000-4000-8000-000000000001",
    ],
    [{ cookieName: "" }, null],
    [{ cookieName: 3 }, null],
    [{ cookieName: null }, null],
    [{}, null],
  ])("%j → %j", (definition, expected) => {
    expect(limitCookieOf(definition)).toBe(expected);
  });
});
