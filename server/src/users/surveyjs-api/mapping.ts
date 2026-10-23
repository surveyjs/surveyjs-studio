import type { User } from "../../domain/types.js";
import { GUID } from "../../domain/guid.js";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A user of the API as the domain holds it, or null when the value is not one. A blank or missing
 * display name falls back to the email, as the legacy mapping does. Extra members are ignored.
 */
export function userFromApi(value: unknown): User | null {
  if (!isRecord(value)) return null;
  const { id, email, displayName, blocked } = value;
  if (typeof id !== "string" || !GUID.test(id) || typeof email !== "string") return null;
  if (displayName !== undefined && displayName !== null && typeof displayName !== "string") {
    return null;
  }
  if (typeof blocked !== "boolean") return null;
  const name = typeof displayName === "string" && displayName.trim() !== "" ? displayName : email;
  return { id: id.toLowerCase(), email, displayName: name, blocked };
}

/** The users of a `POST /users/lookup` answer, or null when it is not one. */
export function usersFromLookup(value: unknown): User[] | null {
  if (!isRecord(value) || !Array.isArray(value.users)) return null;
  const users: User[] = [];
  for (const item of value.users as unknown[]) {
    const user = userFromApi(item);
    if (user === null) return null;
    users.push(user);
  }
  return users;
}

/** The expiry of each licence of a `GET /users/{id}/licences` answer, or null when it is not one. */
export function licenceExpiriesFromApi(value: unknown): (Date | null)[] | null {
  if (!isRecord(value) || !Array.isArray(value.licences)) return null;
  const expiries: (Date | null)[] = [];
  for (const licence of value.licences as unknown[]) {
    if (!isRecord(licence)) return null;
    const { expiresAt } = licence;
    if (expiresAt === null) {
      expiries.push(null);
      continue;
    }
    if (typeof expiresAt !== "string" || !ISO_INSTANT.test(expiresAt)) return null;
    const at = Date.parse(expiresAt);
    if (Number.isNaN(at)) return null;
    expiries.push(new Date(at));
  }
  return expiries;
}
