import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import type { ExternalMethod } from "../config.js";
import type { AccountChange } from "../providers/types.js";
import { createAdminService, type AdminServiceOptions, type AdminUserCreate } from "./service.js";

type UserParams = { userId: string };
type IdentityParams = UserParams & { provider: ExternalMethod; subject: string };

/** The `/admin/users` operations (USER_DIRECTORY=local). Requests reach them validated. */
export function createAdminHandlers(options: AdminServiceOptions): Handlers {
  const service = createAdminService(options);

  return {
    listUsers: (request) =>
      service.list(requireUser(request), request.query as { limit: number; cursor?: string }),

    createUser: async (request, reply) => {
      const created = await service.create(requireUser(request), request.body as AdminUserCreate);
      return reply
        .code(201)
        .header("location", `/api/v1/admin/users/${created.user.id}`)
        .send(created);
    },

    updateUser: (request) => {
      const { userId } = request.params as UserParams;
      return service.update(requireUser(request), userId, request.body as AccountChange);
    },

    deleteUser: async (request, reply) => {
      const { userId } = request.params as UserParams;
      await service.delete(requireUser(request), userId);
      return reply.code(204).send();
    },

    createUserResetLink: async (request, reply) => {
      const { userId } = request.params as UserParams;
      return reply.code(201).send(await service.resetLink(requireUser(request), userId));
    },

    listUserIdentities: (request) => {
      const { userId } = request.params as UserParams;
      return service.listIdentities(requireUser(request), userId);
    },

    unlinkUserIdentity: async (request, reply) => {
      const { userId, provider, subject } = request.params as IdentityParams;
      await service.unlinkIdentity(requireUser(request), userId, provider, subject);
      return reply.code(204).send();
    },
  };
}
