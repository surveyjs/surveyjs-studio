import { useMutation } from "@tanstack/react-query";
import { ApiError, client, toApiError } from "./client";

/** Signs in with an email and a password; the server sets the session cookies (204). */
export function usePasswordLogin() {
  return useMutation({
    mutationFn: async (body: { email: string; password: string }): Promise<void> => {
      const { error, response } = await client.POST("/auth/password/login", { body });
      if (!response.ok) throw toApiError(error, response);
    },
  });
}

/** Changes the signed-in user's password; the server answers with a new session (204). */
export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }): Promise<void> => {
      const { error, response } = await client.POST("/me/password", { body });
      if (!response.ok) throw toApiError(error, response);
    },
  });
}

/**
 * Sets a password with a link's token. The first admin's setup link also sends the admin's email and
 * name; the server creates that account.
 */
export function useSetPasswordWithLink() {
  return useMutation({
    mutationFn: async (body: {
      token: string;
      password: string;
      email?: string;
      displayName?: string;
    }): Promise<void> => {
      const { error, response } = await client.POST("/auth/password-link", { body });
      if (!response.ok) throw toApiError(error, response);
    },
  });
}

/** The message to show for a failed password request: the server's detail when it sent one. */
export function passwordErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? fallback;
  return fallback;
}
