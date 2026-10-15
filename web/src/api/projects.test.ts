import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { projectsQueryOptions } from "./projects";
import { projectsHandler, sampleProject, server } from "../test/server";

describe("projects list query", () => {
  it("follows nextCursor across pages and returns one array", async () => {
    const second = {
      ...sampleProject,
      id: "55555555-0000-4000-8000-a00000000002",
      name: "Engineering",
    };
    server.use(
      projectsHandler({
        "": { items: [sampleProject], nextCursor: "page-2" },
        "page-2": { items: [second], nextCursor: null },
      }),
    );

    const projects = await new QueryClient().fetchQuery(projectsQueryOptions);

    expect(projects.map((project) => project.name)).toEqual(["Marketing", "Engineering"]);
  });
});
