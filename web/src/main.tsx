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
    await (await import("./sandbox/start")).startSandbox();
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
