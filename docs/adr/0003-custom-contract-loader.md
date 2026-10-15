# 3. Build routes from the contract with our own loader

Date: 2026-10-14

## Status

Accepted

## Context

`spec.md` says routes and validation are generated from the OpenAPI document by `operationId`,
"for example with fastify-openapi-glue and Ajv". The contract uses OpenAPI 3.1 (JSON Schema
2020-12). Two needs did not fit a ready-made glue plugin:

- Request bodies must **not** be coerced. A string sent where a number is expected must fail with
  `422`, but path, query and header values arrive as strings and must be coerced.
- Errors must map to our Problem codes: `422 validation-failed` for bodies, `400 bad-request`
  for the rest, with JSON Pointer errors. Missing headers such as `If-Match` need their own
  status (`428`), so header presence cannot be enforced by the schema.

## Decision

Write a small loader (`server/src/contract.ts`) that reads `contract/openapi.yaml` with `yaml`,
creates one Fastify route per operation, and compiles validators with **Ajv 2020**: one instance
with `coerceTypes: false` for bodies, one with `coerceTypes: "array"` for path, query and headers.
`components.schemas` are registered once and shared by `$ref`. Unknown keywords and formats are
errors, so a contract that Ajv cannot handle fails at start-up. The handler is found by
`operationId`; when there is none, the route answers `501`.

## Consequences

- Full control over coercion and error mapping; no dependency on a glue plugin's OpenAPI 3.1 support.
- We maintain about 250 lines of loader code, covered by tests through HTTP.
- Supported contract features are limited to what the loader handles (schema-based path, query and
  header parameters; no cookie parameters). The loader fails loudly on others.
- Other-language ports do not use this code. They are checked by the conformance suite.
