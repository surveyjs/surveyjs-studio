const MAX_LENGTH = 2048;
function hasControlCharacter(text: string): boolean {
  // C0 controls, DEL and C1 controls.
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

/**
 * The `returnTo` path when it is a same-origin path, `/` when absent, else null.
 * Only a single leading `/` is accepted (not `//`, not `/\`), so the browser never reads it as
 * another origin; the URL check below repeats that against the configured public origin.
 */
export function validateReturnTo(value: string | undefined, publicBaseUrl: string): string | null {
  if (value === undefined) return "/";
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (hasControlCharacter(value)) return null;
  const base = new URL(publicBaseUrl);
  if (!URL.canParse(value, base.href)) return null;
  return new URL(value, base.href).origin === base.origin ? value : null;
}
