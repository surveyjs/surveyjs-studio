import { lazy, Suspense, type ComponentType } from "react";

// The shared routes reach the sandbox UI only through these, and only behind an inline
// `import.meta.env.MODE === "sandbox"` test: the bundler then drops them, and the sandbox modules
// with them, from the normal build. The lazy components are made on first use, not at import, so
// nothing here keeps a dynamic import alive when the build removes every caller.
let banner: ComponentType<{ compact?: boolean }> | undefined;
let signIn: ComponentType<{ returnTo: string | undefined }> | undefined;

export function LazySandboxBanner({ compact }: { compact: boolean }) {
  banner ??= lazy(async () => ({
    default: (await import("./sandbox/SandboxBanner")).SandboxBanner,
  }));
  const Banner = banner;
  return (
    <Suspense fallback={null}>
      <Banner compact={compact} />
    </Suspense>
  );
}

export function LazySandboxSignIn({ returnTo }: { returnTo: string | undefined }) {
  signIn ??= lazy(() => import("./sandbox/SandboxSignIn"));
  const SignIn = signIn;
  return (
    <Suspense fallback={null}>
      <SignIn returnTo={returnTo} />
    </Suspense>
  );
}
