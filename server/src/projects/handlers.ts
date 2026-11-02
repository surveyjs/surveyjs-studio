import type { components } from "@surveyjs-studio/contract";
import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import {
  createProjectsService,
  type MemberCreate,
  type ProjectListQuery,
  type ProjectsServiceOptions,
} from "./service.js";

type ProjectCreate = components["schemas"]["ProjectCreate"];
type ProjectPatch = components["schemas"]["ProjectPatch"];
type MemberPatch = components["schemas"]["MemberPatch"];

type ProjectParams = { projectId: string };
type InvitationParams = { projectId: string; email: string };
type MemberParams = { projectId: string; userId: string };

/** The project and member operations. Requests reach them validated by the contract. */
export function createProjectHandlers(options: ProjectsServiceOptions): Handlers {
  const service = createProjectsService(options);

  return {
    listProjects: (request) =>
      service.list(requireUser(request), request.query as ProjectListQuery),

    createProject: async (request, reply) => {
      const project = await service.create(requireUser(request), request.body as ProjectCreate);
      return reply.code(201).header("location", `/api/v1/projects/${project.id}`).send(project);
    },

    getProject: (request) => {
      const { projectId } = request.params as ProjectParams;
      return service.get(requireUser(request), projectId);
    },

    updateProject: (request) => {
      const { projectId } = request.params as ProjectParams;
      return service.rename(requireUser(request), projectId, request.body as ProjectPatch);
    },

    deleteProject: async (request, reply) => {
      const { projectId } = request.params as ProjectParams;
      await service.delete(requireUser(request), projectId);
      return reply.code(204).send();
    },

    listMembers: (request) => {
      const { projectId } = request.params as ProjectParams;
      return service.members(requireUser(request), projectId, request.query as ProjectListQuery);
    },

    addMember: async (request, reply) => {
      const { projectId } = request.params as ProjectParams;
      const member = await service.addMember(
        requireUser(request),
        projectId,
        request.body as MemberCreate,
      );
      const base = `/api/v1/projects/${projectId.toLowerCase()}`;
      const location =
        member.userId === null
          ? `${base}/invitations/${member.email}`
          : `${base}/members/${member.userId}`;
      return reply.code(201).header("location", location).send(member);
    },

    updateMember: (request) => {
      const { projectId, userId } = request.params as MemberParams;
      return service.changeRole(
        requireUser(request),
        projectId,
        userId,
        request.body as MemberPatch,
      );
    },

    removeInvitation: async (request, reply) => {
      const { projectId, email } = request.params as InvitationParams;
      await service.removeInvitation(requireUser(request), projectId, email);
      return reply.code(204).send();
    },

    removeMember: async (request, reply) => {
      const { projectId, userId } = request.params as MemberParams;
      await service.removeMember(requireUser(request), projectId, userId);
      return reply.code(204).send();
    },
  };
}
