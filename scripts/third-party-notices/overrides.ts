import type { Overrides } from "./notices.js";

/**
 * Keyed by package name, so a version bump needs no edit; the generator fails if the installed
 * package.json declares another licence. A package without a licence file, with the licence its package.json declares and why that is
 * trusted. Every entry was checked against the installed package.json (the "license" field) and
 * the repository it names. Nothing here silences a package whose licence is unknown.
 */
export const OVERRIDES: Overrides = {
  "@aws-sdk/credential-provider-http": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@aws-sdk/credential-provider-login": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@aws-sdk/nested-clients": {
    license: "Apache-2.0",
    reason:
      "The package ships no licence file; its package.json declares Apache-2.0 and names github.com/aws/aws-sdk-js-v3.",
  },
  "@nodable/entities": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/nodable/val-parsers.",
  },
  "abstract-logging": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/jsumners/abstract-logging.",
  },
  "pg-types": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/brianc/node-pg-types.",
  },
  pgpass: {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/hoegaarden/pgpass.",
  },
  "@open-draft/deferred-promise": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/open-draft/deferred-promise.",
  },
  "is-node-process": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/mswjs/is-node-process.",
  },
  "strict-event-emitter": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/open-draft/strict-event-emitter.",
  },
  "survey-core": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/surveyjs/surveyjs.",
  },
  "survey-react-ui": {
    license: "MIT",
    reason:
      "The package ships no licence file; its package.json declares MIT and names github.com/surveyjs/surveyjs.",
  },
};
