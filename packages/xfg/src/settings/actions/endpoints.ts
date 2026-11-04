import type { ActionsSettings } from "../../config/index.js";
import type { ActionsApiBody, ActionsEndpointName } from "./types.js";

interface ActionsEndpointField {
  setting: keyof ActionsSettings;
  api: string;
}

export interface ActionsEndpoint {
  name: ActionsEndpointName;
  /** Path under /repos/{owner}/{repo}/actions/ */
  path: string;
  fields: readonly ActionsEndpointField[];
}

// Order is the write order: selected-actions needs allowed_actions: selected set first.
export const ACTIONS_ENDPOINTS: readonly ActionsEndpoint[] = [
  {
    name: "permissions",
    path: "permissions",
    fields: [
      { setting: "enabled", api: "enabled" },
      { setting: "allowedActions", api: "allowed_actions" },
      { setting: "shaPinningRequired", api: "sha_pinning_required" },
    ],
  },
  {
    name: "selectedActions",
    path: "permissions/selected-actions",
    fields: [
      { setting: "githubOwnedAllowed", api: "github_owned_allowed" },
      { setting: "verifiedAllowed", api: "verified_allowed" },
      { setting: "patternsAllowed", api: "patterns_allowed" },
    ],
  },
  {
    name: "workflow",
    path: "permissions/workflow",
    fields: [
      {
        setting: "defaultWorkflowPermissions",
        api: "default_workflow_permissions",
      },
      {
        setting: "canApprovePullRequestReviews",
        api: "can_approve_pull_request_reviews",
      },
    ],
  },
  {
    name: "forkPrApproval",
    path: "permissions/fork-pr-contributor-approval",
    fields: [{ setting: "forkPrApprovalPolicy", api: "approval_policy" }],
  },
  {
    name: "artifactRetention",
    path: "permissions/artifact-and-log-retention",
    fields: [{ setting: "artifactAndLogRetentionDays", api: "days" }],
  },
  {
    name: "cacheRetention",
    path: "cache/retention-limit",
    fields: [
      { setting: "cacheRetentionDays", api: "max_cache_retention_days" },
    ],
  },
  {
    name: "cacheStorage",
    path: "cache/storage-limit",
    fields: [{ setting: "cacheSizeGb", api: "max_cache_size_gb" }],
  },
];

export function endpointByName(name: ActionsEndpointName): ActionsEndpoint {
  const endpoint = ACTIONS_ENDPOINTS.find((e) => e.name === name);
  if (!endpoint) throw new Error(`Unknown Actions endpoint: ${name}`);
  return endpoint;
}

export function readEndpoint(
  endpoint: ActionsEndpoint,
  body: ActionsApiBody
): ActionsSettings {
  const result: Record<string, unknown> = {};
  for (const { setting, api } of endpoint.fields) {
    if (body[api] !== undefined) result[setting] = body[api];
  }
  return result as ActionsSettings;
}

/**
 * GitHub doesn't document whether a PUT keeps omitted fields, so the current
 * value of every unconfigured field is sent too.
 */
export function buildPayload(
  endpoint: ActionsEndpoint,
  desired: ActionsSettings,
  current: ActionsSettings
): ActionsApiBody {
  // Only enabled is written while Actions is off: GitHub answers 409 to allowed_actions with enabled: false
  if (
    endpoint.name === "permissions" &&
    (desired.enabled ?? current.enabled) === false
  ) {
    return { enabled: false };
  }

  const body: ActionsApiBody = {};
  for (const { setting, api } of endpoint.fields) {
    const value = desired[setting] ?? current[setting];
    if (value !== undefined) body[api] = value;
  }
  return body;
}
