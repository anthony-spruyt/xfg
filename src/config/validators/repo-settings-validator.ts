const VALID_VISIBILITY = ["public", "private", "internal"];
const VALID_SQUASH_MERGE_COMMIT_TITLE = ["PR_TITLE", "COMMIT_OR_PR_TITLE"];
const VALID_SQUASH_MERGE_COMMIT_MESSAGE = [
  "PR_BODY",
  "COMMIT_MESSAGES",
  "BLANK",
];
const VALID_MERGE_COMMIT_TITLE = ["PR_TITLE", "MERGE_MESSAGE"];
const VALID_MERGE_COMMIT_MESSAGE = ["PR_BODY", "PR_TITLE", "BLANK"];

/**
 * Validates GitHub repository settings.
 */
export function validateRepoSettings(repo: unknown, context: string): void {
  if (typeof repo !== "object" || repo === null || Array.isArray(repo)) {
    throw new Error(`${context}: repo must be an object`);
  }

  const r = repo as Record<string, unknown>;

  // Validate boolean fields
  const booleanFields = [
    "hasIssues",
    "hasProjects",
    "hasWiki",
    "hasDiscussions",
    "isTemplate",
    "allowForking",
    "archived",
    "allowSquashMerge",
    "allowMergeCommit",
    "allowRebaseMerge",
    "allowAutoMerge",
    "deleteBranchOnMerge",
    "allowUpdateBranch",
    "vulnerabilityAlerts",
    "automatedSecurityFixes",
    "secretScanning",
    "secretScanningPushProtection",
    "privateVulnerabilityReporting",
    "webCommitSignoffRequired",
  ];

  for (const field of booleanFields) {
    if (r[field] !== undefined && typeof r[field] !== "boolean") {
      throw new Error(`${context}: ${field} must be a boolean`);
    }
  }

  // Validate string fields
  if (r.defaultBranch !== undefined && typeof r.defaultBranch !== "string") {
    throw new Error(`${context}: defaultBranch must be a string`);
  }

  // Validate enum fields
  if (
    r.visibility !== undefined &&
    !VALID_VISIBILITY.includes(r.visibility as string)
  ) {
    throw new Error(
      `${context}: visibility must be one of: ${VALID_VISIBILITY.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitTitle !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_TITLE.includes(
      r.squashMergeCommitTitle as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitTitle must be one of: ${VALID_SQUASH_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.squashMergeCommitMessage !== undefined &&
    !VALID_SQUASH_MERGE_COMMIT_MESSAGE.includes(
      r.squashMergeCommitMessage as string
    )
  ) {
    throw new Error(
      `${context}: squashMergeCommitMessage must be one of: ${VALID_SQUASH_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }

  if (
    r.mergeCommitTitle !== undefined &&
    !VALID_MERGE_COMMIT_TITLE.includes(r.mergeCommitTitle as string)
  ) {
    throw new Error(
      `${context}: mergeCommitTitle must be one of: ${VALID_MERGE_COMMIT_TITLE.join(", ")}`
    );
  }

  if (
    r.mergeCommitMessage !== undefined &&
    !VALID_MERGE_COMMIT_MESSAGE.includes(r.mergeCommitMessage as string)
  ) {
    throw new Error(
      `${context}: mergeCommitMessage must be one of: ${VALID_MERGE_COMMIT_MESSAGE.join(", ")}`
    );
  }
}

export {
  VALID_VISIBILITY,
  VALID_SQUASH_MERGE_COMMIT_TITLE,
  VALID_SQUASH_MERGE_COMMIT_MESSAGE,
  VALID_MERGE_COMMIT_TITLE,
  VALID_MERGE_COMMIT_MESSAGE,
};
