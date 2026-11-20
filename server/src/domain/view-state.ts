import type { ViewState } from "./types.js";

/**
 * The view state a shared layout text holds (ADR 0040 point 4): the JSON object it parses to;
 * null when the text is not JSON or not an object (an array, a string, `null`).
 */
export function viewStateOf(text: string): ViewState | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as ViewState)
      : null;
  } catch {
    return null;
  }
}
