# 5. Respondent files are stored as URLs (D11)

Date: 2026-10-14

## Status

Accepted, with conditions. Three checks are still open (see Consequences).

## Context

The legacy site stores a respondent's uploaded file inline in the result: a base64 data URL in
the `content` field of the answer. Large files make result rows large, and Azure Table rows have
a size limit. We want to store files as separate objects and keep a URL in the result. The
question (D11): can `api.surveyjs.io` readers, exports and the SurveyJS libraries cope with a URL
where they used to find inline content? The full analysis is in
[legacy data layout, section 8](../architecture/legacy-data-layout.md#8-d11-verdict).

## Decision

**Yes, with conditions.** Store respondent files as URLs in place of inline content when these hold:

1. Keep the Form Library value shape `[{ "name", "type", "content" }]` and put an absolute HTTPS
   URL in `content`.
2. The URL must work without our session: unguessable and long-lived, like the legacy editor-asset
   URL.
3. Write result rows directly to the results table, not through the legacy `POST post` endpoint,
   whose HTML sanitizer may encode `&` in URLs.
4. Delete files ourselves. The legacy delete paths never touch files.
5. Accept that a consumer that decodes `content` as a data URL will now see a URL.

Evidence:

- Results are one opaque JSON string. Every legacy reader parses it and passes values through
  without looking inside file content.
- Results already hold references: the legacy upload endpoint returns a `dxsimage:` or `dxsfile:`
  reference that the client keeps in the answer.
- Nothing in the legacy code reads `content` as base64.

## Consequences

- Results rows stay small, and the files live in their own store.
- The steps that store results and files build on the five conditions. Condition 2 means file URLs need a
  public, unguessable route; condition 4 means file cleanup is our code.
- Condition 5 is a product risk. Only customers and support can say whether anyone relies on
  base64 `content`.
- Open checks, from [the layout gaps](../architecture/legacy-data-layout.md#11-gaps-and-open-questions):
  - **HTML encoding** (gap 6): whether `&`, `<` and `>` are stored HTML-encoded in existing
    `result` strings. This needs a storage copy or a test post to staging.
  - **Existing references** (gap 7): how many existing results hold `dxsimage:` or `dxsfile:`
    values, and how large the biggest result is. This needs a storage copy.
  - **Base64 consumers** (gap 10): whether external customers rely on base64 `content` in
    exports or API results.
- The verdict rests on reading the legacy code, not on production data. If a check fails, add a
  new ADR that supersedes this one.
