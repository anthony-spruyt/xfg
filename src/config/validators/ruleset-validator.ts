const VALID_RULESET_TARGETS = ["branch", "tag"];
const VALID_ENFORCEMENT_LEVELS = ["active", "disabled", "evaluate"];
const VALID_ACTOR_TYPES = ["Team", "User", "Integration"];
const VALID_BYPASS_MODES = ["always", "pull_request"];
const VALID_PATTERN_OPERATORS = [
  "starts_with",
  "ends_with",
  "contains",
  "regex",
];
const VALID_MERGE_METHODS = ["merge", "squash", "rebase"];
const VALID_ALERTS_THRESHOLDS = [
  "none",
  "errors",
  "errors_and_warnings",
  "all",
];
const VALID_SECURITY_THRESHOLDS = [
  "none",
  "critical",
  "high_or_higher",
  "medium_or_higher",
  "all",
];

const VALID_RULE_TYPES = [
  "pull_request",
  "required_status_checks",
  "required_signatures",
  "required_linear_history",
  "non_fast_forward",
  "creation",
  "update",
  "deletion",
  "required_deployments",
  "code_scanning",
  "code_quality",
  "workflows",
  "commit_author_email_pattern",
  "commit_message_pattern",
  "committer_email_pattern",
  "branch_name_pattern",
  "tag_name_pattern",
  "file_path_restriction",
  "file_extension_restriction",
  "max_file_path_length",
  "max_file_size",
];

/**
 * Validates a single ruleset rule.
 */
export function validateRule(rule: unknown, context: string): void {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw new Error(`${context}: rule must be an object`);
  }

  const r = rule as Record<string, unknown>;

  if (!r.type || typeof r.type !== "string") {
    throw new Error(`${context}: rule must have a 'type' string field`);
  }

  if (!VALID_RULE_TYPES.includes(r.type)) {
    throw new Error(
      `${context}: invalid rule type '${r.type}'. Must be one of: ${VALID_RULE_TYPES.join(", ")}`
    );
  }

  // Validate parameters based on rule type
  if (r.parameters !== undefined) {
    if (
      typeof r.parameters !== "object" ||
      r.parameters === null ||
      Array.isArray(r.parameters)
    ) {
      throw new Error(`${context}: rule parameters must be an object`);
    }

    const params = r.parameters as Record<string, unknown>;

    // Validate pattern rule parameters
    if (r.type.toString().endsWith("_pattern")) {
      if (
        params.operator !== undefined &&
        !VALID_PATTERN_OPERATORS.includes(params.operator as string)
      ) {
        throw new Error(
          `${context}: pattern rule operator must be one of: ${VALID_PATTERN_OPERATORS.join(", ")}`
        );
      }
      if (params.pattern !== undefined && typeof params.pattern !== "string") {
        throw new Error(`${context}: pattern rule pattern must be a string`);
      }
    }

    // Validate pull_request parameters
    if (r.type === "pull_request") {
      if (params.requiredApprovingReviewCount !== undefined) {
        const count = params.requiredApprovingReviewCount;
        if (
          typeof count !== "number" ||
          !Number.isInteger(count) ||
          count < 0 ||
          count > 10
        ) {
          throw new Error(
            `${context}: requiredApprovingReviewCount must be an integer between 0 and 10`
          );
        }
      }
      if (params.allowedMergeMethods !== undefined) {
        if (!Array.isArray(params.allowedMergeMethods)) {
          throw new Error(`${context}: allowedMergeMethods must be an array`);
        }
        for (const method of params.allowedMergeMethods) {
          if (!VALID_MERGE_METHODS.includes(method as string)) {
            throw new Error(
              `${context}: allowedMergeMethods values must be one of: ${VALID_MERGE_METHODS.join(", ")}`
            );
          }
        }
      }
    }

    // Validate code_scanning parameters
    if (r.type === "code_scanning" && params.codeScanningTools !== undefined) {
      if (!Array.isArray(params.codeScanningTools)) {
        throw new Error(`${context}: codeScanningTools must be an array`);
      }
      for (const tool of params.codeScanningTools) {
        if (typeof tool !== "object" || tool === null) {
          throw new Error(
            `${context}: each codeScanningTool must be an object`
          );
        }
        const t = tool as Record<string, unknown>;
        if (
          t.alertsThreshold !== undefined &&
          !VALID_ALERTS_THRESHOLDS.includes(t.alertsThreshold as string)
        ) {
          throw new Error(
            `${context}: alertsThreshold must be one of: ${VALID_ALERTS_THRESHOLDS.join(", ")}`
          );
        }
        if (
          t.securityAlertsThreshold !== undefined &&
          !VALID_SECURITY_THRESHOLDS.includes(
            t.securityAlertsThreshold as string
          )
        ) {
          throw new Error(
            `${context}: securityAlertsThreshold must be one of: ${VALID_SECURITY_THRESHOLDS.join(", ")}`
          );
        }
      }
    }
  }
}

/**
 * Validates a single ruleset.
 */
export function validateRuleset(
  ruleset: unknown,
  name: string,
  context: string
): void {
  if (
    typeof ruleset !== "object" ||
    ruleset === null ||
    Array.isArray(ruleset)
  ) {
    throw new Error(`${context}: ruleset '${name}' must be an object`);
  }

  const rs = ruleset as Record<string, unknown>;

  if (
    rs.target !== undefined &&
    !VALID_RULESET_TARGETS.includes(rs.target as string)
  ) {
    throw new Error(
      `${context}: ruleset '${name}' target must be one of: ${VALID_RULESET_TARGETS.join(", ")}`
    );
  }

  if (
    rs.enforcement !== undefined &&
    !VALID_ENFORCEMENT_LEVELS.includes(rs.enforcement as string)
  ) {
    throw new Error(
      `${context}: ruleset '${name}' enforcement must be one of: ${VALID_ENFORCEMENT_LEVELS.join(", ")}`
    );
  }

  // Validate bypassActors
  if (rs.bypassActors !== undefined) {
    if (!Array.isArray(rs.bypassActors)) {
      throw new Error(
        `${context}: ruleset '${name}' bypassActors must be an array`
      );
    }
    for (let i = 0; i < rs.bypassActors.length; i++) {
      const actor = rs.bypassActors[i] as Record<string, unknown>;
      if (typeof actor !== "object" || actor === null) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}] must be an object`
        );
      }
      if (typeof actor.actorId !== "number") {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].actorId must be a number`
        );
      }
      if (!VALID_ACTOR_TYPES.includes(actor.actorType as string)) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].actorType must be one of: ${VALID_ACTOR_TYPES.join(", ")}`
        );
      }
      if (
        actor.bypassMode !== undefined &&
        !VALID_BYPASS_MODES.includes(actor.bypassMode as string)
      ) {
        throw new Error(
          `${context}: ruleset '${name}' bypassActors[${i}].bypassMode must be one of: ${VALID_BYPASS_MODES.join(", ")}`
        );
      }
    }
  }

  // Validate conditions
  if (rs.conditions !== undefined) {
    if (
      typeof rs.conditions !== "object" ||
      rs.conditions === null ||
      Array.isArray(rs.conditions)
    ) {
      throw new Error(
        `${context}: ruleset '${name}' conditions must be an object`
      );
    }
    const conditions = rs.conditions as Record<string, unknown>;
    if (conditions.refName !== undefined) {
      const refName = conditions.refName as Record<string, unknown>;
      if (
        typeof refName !== "object" ||
        refName === null ||
        Array.isArray(refName)
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName must be an object`
        );
      }
      if (
        refName.include !== undefined &&
        (!Array.isArray(refName.include) ||
          !refName.include.every((s) => typeof s === "string"))
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName.include must be an array of strings`
        );
      }
      if (
        refName.exclude !== undefined &&
        (!Array.isArray(refName.exclude) ||
          !refName.exclude.every((s) => typeof s === "string"))
      ) {
        throw new Error(
          `${context}: ruleset '${name}' conditions.refName.exclude must be an array of strings`
        );
      }
    }
  }

  // Validate rules array
  if (rs.rules !== undefined) {
    if (!Array.isArray(rs.rules)) {
      throw new Error(`${context}: ruleset '${name}' rules must be an array`);
    }
    for (let i = 0; i < rs.rules.length; i++) {
      validateRule(rs.rules[i], `${context}: ruleset '${name}' rules[${i}]`);
    }
  }
}

export {
  VALID_RULESET_TARGETS,
  VALID_ENFORCEMENT_LEVELS,
  VALID_ACTOR_TYPES,
  VALID_BYPASS_MODES,
  VALID_PATTERN_OPERATORS,
  VALID_MERGE_METHODS,
  VALID_ALERTS_THRESHOLDS,
  VALID_SECURITY_THRESHOLDS,
  VALID_RULE_TYPES,
};
