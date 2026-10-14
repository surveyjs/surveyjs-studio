/**
 * The account links of the surveyjs.io top bar's Account menu (`the site's page markup`),
 * as absolute URLs. They are the built-in `/config.links`; `SHELL_LINKS` is merged over them.
 */
export const DEFAULT_SHELL_LINKS: Readonly<Record<"settings" | "helpDesk" | "billing", string>> =
  Object.freeze({
    settings: "https://surveyjs.io/manage",
    helpDesk: "https://surveyjs.answerdesk.io/ticket/list?preset=mytickets",
    billing: "https://surveyjs.io/manage#billing",
  });

/** The `/config.links` map: the built-in links with the configured ones (`SHELL_LINKS`) over them. */
export function shellLinks(configured: Readonly<Record<string, string>>): Record<string, string> {
  return { ...DEFAULT_SHELL_LINKS, ...configured };
}
