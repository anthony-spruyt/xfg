import type {
  DeploymentBranchPattern,
  DeploymentBranchPolicy,
  EnvironmentConfig,
} from "../../config/index.js";
import type {
  ExistingBranchPattern,
  GitHubDeploymentBranchPolicy,
  GitHubEnvironment,
} from "./types.js";

export type BranchPolicyKind = "all" | "protected" | "custom";

export type EnvironmentAction = "create" | "update" | "unchanged";

export interface EnvironmentChange {
  action: EnvironmentAction;
  /** GitHub's spelling when the environment exists, else the config key */
  name: string;
  currentKind?: BranchPolicyKind;
  desiredKind: BranchPolicyKind;
  putPolicy: boolean;
  missingPatterns: DeploymentBranchPattern[];
  unmanagedPatterns: ExistingBranchPattern[];
  orphanPatterns: ExistingBranchPattern[];
  /** False when the existing patterns were not read, so missingPatterns may hold some that exist */
  patternsKnown: boolean;
}

export interface EnvironmentDeletion {
  action: "delete";
  name: string;
}

export interface DiffEnvironmentsOptions {
  /** Skip pattern deletions even where the policy sets deleteOrphaned */
  noDelete?: boolean;
}

export function currentPolicyKind(
  policy: GitHubDeploymentBranchPolicy | null
): BranchPolicyKind {
  if (policy?.custom_branch_policies) return "custom";
  if (policy?.protected_branches) return "protected";
  return "all";
}

export function desiredPolicyKind(
  policy: DeploymentBranchPolicy | undefined
): BranchPolicyKind {
  if (policy?.custom) return "custom";
  if (policy?.protectedBranches) return "protected";
  return "all";
}

export function toGitHubPolicy(
  kind: BranchPolicyKind
): GitHubDeploymentBranchPolicy | null {
  if (kind === "all") return null;
  return {
    protected_branches: kind === "protected",
    custom_branch_policies: kind === "custom",
  };
}

function indexByName(
  current: GitHubEnvironment[]
): Map<string, GitHubEnvironment> {
  return new Map(current.map((env) => [env.name.toLowerCase(), env]));
}

/** Existing environments whose patterns must be read before diffing. */
export function needsPatternLookup(
  desired: Record<string, EnvironmentConfig>,
  current: GitHubEnvironment[]
): string[] {
  const existing = indexByName(current);
  const names: string[] = [];
  for (const [name, config] of Object.entries(desired)) {
    const env = existing.get(name.toLowerCase());
    if (
      env &&
      currentPolicyKind(env.deployment_branch_policy) === "custom" &&
      desiredPolicyKind(config.deploymentBranchPolicy) === "custom"
    ) {
      names.push(env.name);
    }
  }
  return names;
}

function patternKey(p: DeploymentBranchPattern): string {
  return `${p.type}\u0000${p.name}`;
}

function diffEnvironment(
  configName: string,
  config: EnvironmentConfig,
  env: GitHubEnvironment | undefined,
  currentPatterns: ReadonlyMap<string, ExistingBranchPattern[]>,
  noDelete: boolean
): EnvironmentChange {
  const desiredKind = desiredPolicyKind(config.deploymentBranchPolicy);
  const wanted = config.deploymentBranchPolicy?.custom ?? [];

  if (!env) {
    return {
      action: "create",
      name: configName,
      desiredKind,
      putPolicy: true,
      missingPatterns: [...wanted],
      unmanagedPatterns: [],
      orphanPatterns: [],
      patternsKnown: true,
    };
  }

  const currentKind = currentPolicyKind(env.deployment_branch_policy);
  const putPolicy = currentKind !== desiredKind;
  const known = currentPatterns.get(env.name.toLowerCase());
  const have = new Set((known ?? []).map(patternKey));
  const want = new Set(wanted.map(patternKey));
  const missingPatterns = wanted.filter((p) => !have.has(patternKey(p)));
  const extra =
    desiredKind === "custom"
      ? (known ?? []).filter((p) => !want.has(patternKey(p)))
      : [];
  const deleteExtra =
    config.deploymentBranchPolicy?.deleteOrphaned === true && !noDelete;
  const orphanPatterns = deleteExtra ? extra : [];

  return {
    action:
      putPolicy || missingPatterns.length > 0 || orphanPatterns.length > 0
        ? "update"
        : "unchanged",
    name: env.name,
    currentKind,
    desiredKind,
    putPolicy,
    missingPatterns,
    unmanagedPatterns: deleteExtra ? [] : extra,
    orphanPatterns,
    patternsKnown: desiredKind !== "custom" || known !== undefined,
  };
}

export function diffEnvironments(
  desired: Record<string, EnvironmentConfig>,
  current: GitHubEnvironment[],
  currentPatterns: ReadonlyMap<string, ExistingBranchPattern[]>,
  options: DiffEnvironmentsOptions = {}
): EnvironmentChange[] {
  const existing = indexByName(current);
  return Object.entries(desired).map(([configName, config]) =>
    diffEnvironment(
      configName,
      config,
      existing.get(configName.toLowerCase()),
      currentPatterns,
      options.noDelete ?? false
    )
  );
}

/** Environments on GitHub with no config entry, matched ignoring case. */
export function orphanEnvironments(
  desired: Record<string, EnvironmentConfig>,
  current: GitHubEnvironment[]
): EnvironmentDeletion[] {
  const wanted = new Set(Object.keys(desired).map((n) => n.toLowerCase()));
  return current
    .filter((env) => !wanted.has(env.name.toLowerCase()))
    .map((env) => ({ action: "delete", name: env.name }));
}
