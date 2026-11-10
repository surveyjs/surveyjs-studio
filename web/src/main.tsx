import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { shouldRetryQuery } from "./api/client";
import { createAppRouter } from "./router";

// The sandbox build answers /api from a service worker; it must control the page first. The
// comparison stays inline (not `IS_SANDBOX`) so the bundler removes the branch, and the sandbox
// code, from the normal build.
let booted = true;
if (import.meta.env.MODE === "sandbox") {
  try {
    const { startSandbox, sandboxStore } = await import("./sandbox/start");
    if ((await startSandbox()) === "outdated") {
      // The stored data has another data version: offer a reset instead of the app.
      booted = false;
      const [{ SandboxOutdated }, { setSessionCookie }] = await Promise.all([
        import("./sandbox/SandboxOutdated"),
        import("./sandbox/store"),
      ]);
      const outdatedRoot = document.getElementById("root");
      if (!outdatedRoot) throw new Error("Missing #root element");
      createRoot(outdatedRoot).render(
        <StrictMode>
          <SandboxOutdated
            onReset={async () => {
              // Rejects with a typed error when the reset is refused; SandboxOutdated says so.
              await sandboxStore().reset();
              setSessionCookie(null);
              location.reload();
            }}
          />
        </StrictMode>,
      );
    }
  } catch (error) {
    booted = false;
    console.error("The sandbox could not start.", error);
    const target = document.getElementById("root");
    if (target) {
      const message = document.createElement("p");
      message.style.cssText =
        "font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem";
      message.textContent =
        "This demo needs a browser with service workers and site storage. Open it in a current browser, not in a private window that blocks them.";
      target.replaceChildren(message);
    }
  }
}

if (booted) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: shouldRetryQuery } } });
  const router = createAppRouter(queryClient);

  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
