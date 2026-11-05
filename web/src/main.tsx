import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { shouldRetryQuery } from "./api/client";
import { createAppRouter } from "./router";

// The sandbox build answers /api from a service worker; it must control the page first. The
// comparison stays inline (not `IS_SANDBOX`) so the bundler removes the branch, and the sandbox
// code, from the normal build.
if (import.meta.env.MODE === "sandbox") await (await import("./sandbox/start")).startSandbox();

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
