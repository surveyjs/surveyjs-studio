import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { shouldRetryQuery } from "./api/client";
import { createAppRouter } from "./router";

// The sandbox build answers /api from a service worker; it must control the page first. The
// comparison stays inline (not `IS_SANDBOX`) so the bundler removes the branch, and the sandbox
// code, from the normal build. bootSandbox shows the reset offer, or a message with Try again when
// the start fails or hangs, instead of the app.
let booted = true;
if (import.meta.env.MODE === "sandbox") {
  const target = document.getElementById("root");
  if (!target) throw new Error("Missing #root element");
  try {
    const [{ bootSandbox }, { startSandbox, sandboxStore }, { setSessionCookie }] =
      await Promise.all([
        import("./sandbox/boot"),
        import("./sandbox/start"),
        import("./sandbox/store"),
      ]);
    ({ booted } = await bootSandbox({
      root: target,
      start: startSandbox,
      // Rejects with a typed error when the reset is refused; SandboxOutdated says so.
      reset: async () => {
        await sandboxStore().reset();
        setSessionCookie(null);
      },
    }));
  } catch (error) {
    // The sandbox's own code did not load (a network error, or a deploy that replaced the files).
    booted = false;
    console.error("The sandbox could not load.", error);
    const message = document.createElement("p");
    message.style.cssText =
      "font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem";
    message.textContent = "The demo could not load. Reload the page to try again.";
    target.replaceChildren(message);
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
