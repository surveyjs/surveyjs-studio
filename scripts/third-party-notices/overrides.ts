import type { Overrides } from "./notices.js";

/**
 * A package without a licence file, with the licence its package.json declares and why that is
 * trusted. Every entry was checked against the installed package.json (the "license" field) and
 * the repository it names. Nothing here silences a package whose licence is unknown.
 */
export const OVERRIDES: Overrides = {
  "@aws-sdk/credential-provider-http@3.972.79": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@aws-sdk/credential-provider-login@3.972.84": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@aws-sdk/nested-clients@3.997.51": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@nodable/entities@3.1.0": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/nodable/val-parsers.",
  },
  "abstract-logging@2.0.1": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/jsumners/abstract-logging.",
  },
  "pg-types@2.2.0": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/brianc/node-pg-types.",
  },
  "pgpass@1.0.5": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/hoegaarden/pgpass.",
  },
  "@open-draft/deferred-promise@2.2.0": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/open-draft/deferred-promise.",
  },
  "is-node-process@1.2.0": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/mswjs/is-node-process.",
  },
  "strict-event-emitter@0.5.1": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/open-draft/strict-event-emitter.",
  },
  "survey-core@3.2.2": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/surveyjs/surveyjs.",
  },
  "survey-react-ui@3.2.2": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/surveyjs/surveyjs.",
  },
};
