import type { GitHubCollaborator, GitHubRepoInvitation } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export type CollaboratorAction = Exclude<SettingsAction, "update">;

export interface CollaboratorChange {
  action: CollaboratorAction;
  username: string;
  pending?: boolean;
  invitationId?: number;
}

export interface CollaboratorsDiffInput {
  owner: string;
  collaborators: GitHubCollaborator[];
  invitations: GitHubRepoInvitation[];
  desired: string[];
  deleteOrphaned: boolean;
}

export function diffCollaborators(
  input: CollaboratorsDiffInput
): CollaboratorChange[] {
  const owner = input.owner.toLowerCase();
  const collaborators = new Map(
    input.collaborators.map((c) => [c.login.toLowerCase(), c])
  );
  const invitations = new Map<
    string,
    { id: number; login: string; expired: boolean }
  >();
  for (const inv of input.invitations) {
    if (inv.invitee) {
      invitations.set(inv.invitee.login.toLowerCase(), {
        id: inv.id,
        login: inv.invitee.login,
        expired: inv.expired === true,
      });
    }
  }
  const desired = new Set(input.desired.map((u) => u.toLowerCase()));

  const changes: CollaboratorChange[] = [];

  if (input.deleteOrphaned) {
    for (const [key, collaborator] of collaborators) {
      if (desired.has(key) || key === owner) continue;
      changes.push({ action: "delete", username: collaborator.login });
    }
    for (const [key, invitation] of invitations) {
      if (desired.has(key) || collaborators.has(key)) continue;
      changes.push({
        action: "delete",
        username: invitation.login,
        pending: true,
        invitationId: invitation.id,
      });
    }
  }

  const unchanged: CollaboratorChange[] = [];
  for (const user of input.desired) {
    const key = user.toLowerCase();
    const collaborator = collaborators.get(key);
    const invitation = invitations.get(key);
    if (collaborator) {
      unchanged.push({ action: "unchanged", username: collaborator.login });
    } else if (invitation && !invitation.expired) {
      unchanged.push({
        action: "unchanged",
        username: invitation.login,
        pending: true,
        invitationId: invitation.id,
      });
    } else if (key === owner) {
      unchanged.push({ action: "unchanged", username: user });
    } else if (invitation) {
      changes.push({
        action: "create",
        username: user,
        invitationId: invitation.id,
      });
    } else {
      changes.push({ action: "create", username: user });
    }
  }

  return [...changes, ...unchanged];
}
