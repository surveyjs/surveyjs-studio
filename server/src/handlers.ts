import type { components } from "@surveyjs-studio/contract";
import type { Handlers } from "./api.js";
import type { AppConfig } from "./config.js";
import { shellLinks } from "./shell-links.js";

type ConfigBody = components["schemas"]["AppConfig"];

/** Implemented operations, keyed by `operationId`. */
export function createHandlers(config: AppConfig): Handlers {
  const configBody: ConfigBody = {
    edition: config.edition,
    shell: config.shell,
    authMethods: [...config.authMethods],
    surveyjsLicenseKey: config.surveyjsLicenseKey,
    limits: {
      maxAssetBytesPerSurvey: config.limits.maxAssetBytesPerSurvey,
      maxFileBytes: config.limits.maxFileBytes,
      maxResponseBytes: config.limits.maxResponseBytes,
      maxDocumentBytes: config.limits.maxDocumentBytes,
    },
    readOnly: config.readOnly,
    links: shellLinks(config.shellLinks),
    branding: { ...config.branding },
    features: { ...config.features },
  };

  return {
    getConfig: () => configBody,
  };
}
