import { ValidationError } from "../../shared/errors.js";
import { isPlainObject } from "../../shared/type-guards.js";
import {
  ACTIONS_SELECTED_FIELDS,
  type ActionsAllowedActions,
  type ActionsDefaultWorkflowPermissions,
  type ActionsForkPrApprovalPolicy,
  type ActionsSettings,
} from "../types.js";
import { validValues } from "./file-validator.js";

const ACTIONS_KEYS: ReadonlySet<string> = new Set<keyof ActionsSettings>([
  "enabled",
  "allowedActions",
  "shaPinningRequired",
  "githubOwnedAllowed",
  "verifiedAllowed",
  "patternsAllowed",
  "defaultWorkflowPermissions",
  "canApprovePullRequestReviews",
  "forkPrApprovalPolicy",
  "artifactAndLogRetentionDays",
  "cacheRetentionDays",
  "cacheSizeGb",
]);

const BOOLEAN_FIELDS = [
  "enabled",
  "shaPinningRequired",
  "githubOwnedAllowed",
  "verifiedAllowed",
  "canApprovePullRequestReviews",
] as const satisfies ReadonlyArray<keyof ActionsSettings>;

// Upper bounds vary by visibility and plan, so the API enforces them.
const POSITIVE_INTEGER_FIELDS = [
  "artifactAndLogRetentionDays",
  "cacheRetentionDays",
  "cacheSizeGb",
] as const satisfies ReadonlyArray<keyof ActionsSettings>;

const ENUM_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "allowedActions",
    validValues<ActionsAllowedActions>(["all", "local_only", "selected"]),
  ],
  [
    "defaultWorkflowPermissions",
    validValues<ActionsDefaultWorkflowPermissions>(["read", "write"]),
  ],
  [
    "forkPrApprovalPolicy",
    validValues<ActionsForkPrApprovalPolicy>([
      "first_time_contributors_new_to_github",
      "first_time_contributors",
      "all_external_contributors",
    ]),
  ],
];

function validateValues(a: Record<string, unknown>, context: string): void {
  for (const field of BOOLEAN_FIELDS) {
    if (a[field] !== undefined && typeof a[field] !== "boolean") {
      throw new ValidationError(`${context}: ${field} must be a boolean`);
    }
  }

  for (const [field, allowed] of ENUM_FIELDS) {
    if (a[field] !== undefined && !allowed.includes(a[field] as string)) {
      throw new ValidationError(
        `${context}: ${field} must be one of: ${allowed.join(", ")}`
      );
    }
  }

  for (const field of POSITIVE_INTEGER_FIELDS) {
    const value = a[field];
    if (
      value !== undefined &&
      !(Number.isInteger(value) && Number(value) > 0)
    ) {
      throw new ValidationError(
        `${context}: ${field} must be a positive integer`
      );
    }
  }

  if (a.patternsAllowed !== undefined) {
    if (!Array.isArray(a.patternsAllowed)) {
      throw new ValidationError(
        `${context}: patternsAllowed must be an array of strings`
      );
    }
    a.patternsAllowed.forEach((pattern: unknown, i) => {
      if (typeof pattern !== "string" || pattern.trim() === "") {
        throw new ValidationError(
          `${context}: patternsAllowed[${i}] must be a non-empty string`
        );
      }
    });
  }
}

function validateCoupling(a: Record<string, unknown>, context: string): void {
  const selectedField = ACTIONS_SELECTED_FIELDS.find((f) => a[f] !== undefined);
  if (
    selectedField &&
    a.allowedActions !== undefined &&
    a.allowedActions !== "selected"
  ) {
    throw new ValidationError(
      `${context}: ${selectedField} requires allowedActions: selected, but this layer sets allowedActions: ${String(a.allowedActions)}`
    );
  }

  if (a.enabled === false) {
    const conflicting = [
      "allowedActions",
      "shaPinningRequired",
      ...ACTIONS_SELECTED_FIELDS,
    ].find((f) => a[f] !== undefined);
    if (conflicting) {
      throw new ValidationError(
        `${context}: ${conflicting} cannot be set with enabled: false`
      );
    }
  }
}

/**
 * Validates one layer (root, group or repo) of GitHub Actions settings.
 */
export function validateActionsSettings(
  actions: unknown,
  context: string
): void {
  if (!isPlainObject(actions)) {
    throw new ValidationError(`${context}: must be an object`);
  }

  for (const key of Object.keys(actions)) {
    if (!ACTIONS_KEYS.has(key)) {
      throw new ValidationError(`${context}: unknown key '${key}'`);
    }
  }

  validateValues(actions, context);
  validateCoupling(actions, context);
}
