import { fileURLToPath } from "node:url";

/** Absolute path to the OpenAPI 3.1 contract (the source of truth for the API). */
export const openapiPath: string = fileURLToPath(new URL("../openapi.yaml", import.meta.url));

export type { components, operations, paths } from "../generated/openapi.d.ts";
