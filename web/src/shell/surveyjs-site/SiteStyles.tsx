import type { ReactNode } from "react";
import "./assets/surveyjs-site.scss";

/**
 * The surveyjs.io stylesheet and fonts without the shell's header, footer or dialogs, for a page
 * that has no shell (the public results page, ADR 0016 R19). Loaded lazily from the registry, like
 * the shell, so the styles reach the browser only when `surveyjs-site` is configured.
 */
export function SiteStyles({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
