/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The SurveyJS licence key the sandbox build bakes in (see src/sandbox/handlers/session.ts). */
  readonly VITE_SANDBOX_LICENSE_KEY?: string;
}
