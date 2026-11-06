// The web's sandbox modules read import.meta.env, which Vite types; this subset runs without Vite.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
