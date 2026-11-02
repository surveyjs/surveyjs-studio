import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvitationStore, ProjectInvitation, ProjectStore } from "../types.js";

export interface InvitationsUnderTest {
  readonly invitations: InvitationStore;
  /** The project store over the same data: projects are made, and memberships read, through it. */
  readonly projects: ProjectStore;
  close(): Promise<void>;
}

const AT = "2026-10-29T12:00:00.000Z";
const NOW = "2026-11-02T09:00:00.000Z";
const INVITER = randomUUID();

const invite = (
  projectId: string,
  email: string,
  over: Partial<ProjectInvitation> = {},
): ProjectInvitation => ({
  projectId,
  email,
  role: "user",
  invitedBy: INVITER,
  createdAt: AT,
  ...over,
});

/** What every invitation store does. `create` starts with no projects. */
export function describeInvitationSuite(
  name: string,
  create: () => Promise<InvitationsUnderTest>,
): void {
  describe(`project invitations: ${name}`, () => {
    let store: InvitationsUnderTest;
    beforeAll(async () => {
      store = await create();
    });
    afterAll(async () => {
      await store.close();
    });

    const newProject = async (): Promise<string> => {
      const id = randomUUID();
      await store.projects.createProject({
        id,
        name: `Project ${id}`,
        creatorId: INVITER,
        createdAt: AT,
      });
      return id;
    };
    const email = (tag: string): string => `${tag}.${randomUUID()}@example.com`;

    it("adds an invitation and lists it with a lower-case email", async () => {
      const projectId = await newProject();
      const id = randomUUID();
      expect(
        await store.invitations.addInvitation(
          invite(projectId, `Alice.${id}@Example.com`, { role: "admin" }),
        ),
      ).toBe("added");
      expect(await store.invitations.listInvitations(projectId)).toEqual([
        invite(projectId, `alice.${id}@example.com`, { role: "admin" }),
      ]);
    });

    it("lists a project's invitations by email, and only that project's", async () => {
      const projectId = await newProject();
      const other = await newProject();
      await store.invitations.addInvitation(invite(projectId, "b@example.com"));
      await store.invitations.addInvitation(invite(projectId, "a@example.com"));
      await store.invitations.addInvitation(invite(other, "c@example.com"));
      const listed = await store.invitations.listInvitations(projectId);
      expect(listed.map((i) => i.email)).toEqual(["a@example.com", "b@example.com"]);
      expect(await store.invitations.listInvitations(randomUUID())).toEqual([]);
      expect(await store.invitations.listInvitations("not-a-guid")).toEqual([]);
    });

    it("refuses the same email again, in any case, and an unknown project", async () => {
      const projectId = await newProject();
      const address = email("dup");
      expect(await store.invitations.addInvitation(invite(projectId, address))).toBe("added");
      expect(
        await store.invitations.addInvitation(
          invite(projectId, address.toUpperCase(), { role: "admin" }),
        ),
      ).toBe("already-invited");
      expect((await store.invitations.listInvitations(projectId))[0]?.role).toBe("user");
      expect(await store.invitations.addInvitation(invite(randomUUID(), address))).toBe(
        "project-not-found",
      );
      expect(await store.invitations.addInvitation(invite("not-a-guid", address))).toBe(
        "project-not-found",
      );
    });

    it("removes an invitation once", async () => {
      const projectId = await newProject();
      const address = email("gone");
      await store.invitations.addInvitation(invite(projectId, address));
      expect(await store.invitations.removeInvitation(projectId, address.toUpperCase())).toBe(
        "removed",
      );
      expect(await store.invitations.removeInvitation(projectId, address)).toBe("not-found");
      expect(await store.invitations.listInvitations(projectId)).toEqual([]);
      expect(await store.invitations.removeInvitation("not-a-guid", address)).toBe("not-found");
    });

    it("tells whether an email has an invitation, in any case", async () => {
      const projectId = await newProject();
      const address = email("has");
      expect(await store.invitations.hasInvitation(address)).toBe(false);
      await store.invitations.addInvitation(invite(projectId, address));
      expect(await store.invitations.hasInvitation(address.toUpperCase())).toBe(true);
      await store.invitations.removeInvitation(projectId, address);
      expect(await store.invitations.hasInvitation(address)).toBe(false);
    });

    it("claims every invitation of the email as a membership with its role", async () => {
      const first = await newProject();
      const second = await newProject();
      const address = email("claim");
      const userId = randomUUID();
      await store.invitations.addInvitation(invite(first, address, { role: "admin" }));
      await store.invitations.addInvitation(invite(second, address, { role: "user" }));
      await store.invitations.addInvitation(invite(second, email("someone-else")));
      const claimed = await store.invitations.claimInvitations(userId, address.toUpperCase(), {
        now: NOW,
      });
      expect(claimed).toBe(2);
      expect((await store.projects.getUserProject(userId, first))?.role).toBe("admin");
      expect((await store.projects.getUserProject(userId, second))?.role).toBe("user");
      expect(await store.invitations.hasInvitation(address)).toBe(false);
      expect(await store.invitations.listInvitations(first)).toEqual([]);
      expect(await store.invitations.listInvitations(second)).toHaveLength(1);
      // Nothing is left to claim.
      expect(await store.invitations.claimInvitations(userId, address, { now: NOW })).toBe(0);
    });

    it("keeps the role of a user who is already a member, and still drops the invitation", async () => {
      const first = await newProject();
      const second = await newProject();
      const address = email("member");
      const userId = randomUUID();
      await store.projects.addMember(first, userId, "user", { now: NOW });
      await store.invitations.addInvitation(invite(first, address, { role: "admin" }));
      await store.invitations.addInvitation(invite(second, address, { role: "admin" }));
      expect(await store.invitations.claimInvitations(userId, address, { now: NOW })).toBe(1);
      expect((await store.projects.getUserProject(userId, first))?.role).toBe("user");
      expect((await store.projects.getUserProject(userId, second))?.role).toBe("admin");
      expect(await store.invitations.hasInvitation(address)).toBe(false);
    });

    it("drops a project's invitations with the project", async () => {
      const projectId = await newProject();
      const address = email("cascade");
      await store.invitations.addInvitation(invite(projectId, address));
      await store.projects.deleteProject(projectId, { receiverId: INVITER, now: NOW });
      expect(await store.invitations.listInvitations(projectId)).toEqual([]);
      expect(await store.invitations.hasInvitation(address)).toBe(false);
    });
  });
}
