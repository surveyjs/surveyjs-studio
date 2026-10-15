import type { components } from "@my-surveys/contract";
import type { RequestUser } from "../auth/authenticate.js";
import { AppError } from "../errors.js";
import {
  decodeProjectCursor,
  encodeProjectCursor,
  type ProjectPosition,
} from "../paging/cursor.js";
import type { Directory } from "../providers/types.js";
import { projectJson, type ProjectJson } from "./json.js";

type ProjectPage = components["schemas"]["ProjectPage"];

export interface ProjectsServiceOptions {
  readonly directory: Directory;
}

/** The `listProjects` query, after contract validation and defaults. */
export interface ProjectListQuery {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ProjectsService {
  list(user: RequestUser, query: ProjectListQuery): Promise<ProjectPage>;
  get(user: RequestUser, projectId: string): Promise<ProjectJson>;
}

/** Code-point order, as `projectListOrder` compares. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const positionOf = ({ project }: { project: { name: string; id: string } }): ProjectPosition => ({
  name: project.name.toLowerCase(),
  id: project.id,
});

/** `listProjects` and `getProject`: the projects the user belongs to. */
export function createProjectsService({ directory }: ProjectsServiceOptions): ProjectsService {
  return {
    async list(user, { limit, cursor }) {
      const after = cursor === undefined ? undefined : decodeProjectCursor(cursor);
      // The Directory returns the whole list in project list order; the service cuts the page.
      const all = await directory.listUserProjects(user.id);
      const rest = after
        ? all.filter((membership) => {
            const { name, id } = positionOf(membership);
            return (
              compare(name, after.name) > 0 || (name === after.name && compare(id, after.id) > 0)
            );
          })
        : all;
      const items = rest.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(projectJson),
        nextCursor: last && rest.length > limit ? encodeProjectCursor(positionOf(last)) : null,
      };
    },

    async get(user, projectId) {
      const membership = await directory.getUserProject(user.id, projectId);
      // A project of others answers like an unknown one.
      if (!membership) throw new AppError({ code: "not-found", status: 404, title: "Not found" });
      return projectJson(membership);
    },
  };
}
