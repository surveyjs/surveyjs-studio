import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import {
  createProjectsService,
  type ProjectListQuery,
  type ProjectsServiceOptions,
} from "./service.js";

/** `listProjects` and `getProject`. Requests reach them validated by the contract. */
export function createProjectHandlers(options: ProjectsServiceOptions): Handlers {
  const service = createProjectsService(options);

  return {
    listProjects: (request) =>
      service.list(requireUser(request), request.query as ProjectListQuery),

    getProject: (request) => {
      const { projectId } = request.params as { projectId: string };
      return service.get(requireUser(request), projectId);
    },
  };
}
