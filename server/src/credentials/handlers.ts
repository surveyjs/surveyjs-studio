import type { components } from "@surveyjs-studio/contract";
import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import { createCredentialsService, type CredentialsServiceOptions } from "./service.js";

type ApiTokenCreate = components["schemas"]["ApiTokenCreate"];

/** The API token operations (ADR 0037). Requests reach them validated by the contract. */
export function createCredentialHandlers(options: CredentialsServiceOptions): Handlers {
  const service = createCredentialsService(options);

  return {
    listApiTokens: (request) => {
      const { project } = request.query as { project?: string };
      return service.list(requireUser(request), project);
    },

    createApiToken: async (request, reply) => {
      const created = await service.create(requireUser(request), request.body as ApiTokenCreate);
      return reply.code(201).header("cache-control", "no-store").send(created);
    },

    revokeApiToken: async (request, reply) => {
      const { tokenId } = request.params as { tokenId: string };
      await service.revoke(requireUser(request), tokenId);
      return reply.code(204).send();
    },

    revokeLegacyAccessKey: async (request, reply) => {
      await service.revokeLegacyKey(requireUser(request));
      return reply.code(204).send();
    },

    replaceCurrentCredential: async (request, reply) => {
      const replaced = await service.replaceCurrent(requireUser(request));
      return reply.header("cache-control", "no-store").send(replaced);
    },
  };
}
