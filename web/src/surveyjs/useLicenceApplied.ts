import { useEffect, useState } from "react";
import { applySurveyJSLicense } from "./license";

/** Applies the SurveyJS licence key before a SurveyJS component is built (it reads the key then). */
export function useLicenceApplied(key: string | null): boolean {
  const [applied, setApplied] = useState(key === null);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    applySurveyJSLicense(key)
      .catch((error: unknown) => console.warn("Could not apply the SurveyJS licence key", error))
      .finally(() => {
        if (active) setApplied(true);
      });
    return () => {
      active = false;
    };
  }, [key]);
  return applied;
}
