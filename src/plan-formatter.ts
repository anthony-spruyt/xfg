import chalk from "chalk";

export type ResourceType = "file" | "ruleset" | "setting";
export type ResourceAction =
  | "create"
  | "update"
  | "delete"
  | "unchanged"
  | "skipped";

export interface Resource {
  type: ResourceType;
  repo: string;
  name: string;
  action: ResourceAction;
  details?: ResourceDetails;
  skipReason?: string;
}

export interface ResourceDetails {
  diff?: string[];
  properties?: PropertyChange[];
}

export interface PropertyChange {
  path: string;
  action: "add" | "change" | "remove";
  oldValue?: unknown;
  newValue?: unknown;
}

export function formatResourceId(resource: Resource): string {
  return `${resource.type} "${resource.repo}/${resource.name}"`;
}

export function formatResourceLine(resource: Resource): string {
  const id = formatResourceId(resource);

  switch (resource.action) {
    case "create":
      return chalk.green(`+ ${id}`);
    case "update":
      return chalk.yellow(`~ ${id}`);
    case "delete":
      return chalk.red(`- ${id}`);
    case "skipped":
      return chalk.gray(`⊘ ${id}`);
    case "unchanged":
      return chalk.gray(`  ${id}`);
  }
}

export interface PlanCounts {
  create: number;
  update: number;
  delete: number;
  skipped?: number;
}

export function formatPlanSummary(counts: PlanCounts): string {
  const parts: string[] = [];

  if (counts.create > 0) {
    parts.push(chalk.green(`${counts.create} to create`));
  }
  if (counts.update > 0) {
    parts.push(chalk.yellow(`${counts.update} to change`));
  }
  if (counts.delete > 0) {
    parts.push(chalk.red(`${counts.delete} to destroy`));
  }

  if (parts.length === 0 && (!counts.skipped || counts.skipped === 0)) {
    return "No changes. Your repositories match the configuration.";
  }

  let summary = parts.length > 0 ? `Plan: ${parts.join(", ")}` : "Plan:";

  if (counts.skipped && counts.skipped > 0) {
    summary += chalk.gray(` (${counts.skipped} skipped)`);
  }

  return summary;
}

export interface Plan {
  resources: Resource[];
  errors?: RepoError[];
}

export interface RepoError {
  repo: string;
  message: string;
}

export function formatPlan(plan: Plan): string[] {
  const lines: string[] = [];

  // Filter to only changed resources
  const changedResources = plan.resources.filter(
    (r) => r.action !== "unchanged"
  );

  // Format each resource
  for (const resource of changedResources) {
    lines.push(formatResourceLine(resource));

    // Add details if present (indented)
    if (resource.details?.diff) {
      for (const diffLine of resource.details.diff) {
        lines.push(`    ${diffLine}`);
      }
    }
  }

  // Add errors
  if (plan.errors && plan.errors.length > 0) {
    for (const error of plan.errors) {
      lines.push(chalk.red(`✗ ${error.repo}`));
      lines.push(chalk.red(`    Error: ${error.message}`));
    }
  }

  // Add blank line before summary
  if (lines.length > 0) {
    lines.push("");
  }

  // Count actions
  const counts: PlanCounts = {
    create: plan.resources.filter((r) => r.action === "create").length,
    update: plan.resources.filter((r) => r.action === "update").length,
    delete: plan.resources.filter((r) => r.action === "delete").length,
    skipped: plan.resources.filter((r) => r.action === "skipped").length,
  };

  lines.push(formatPlanSummary(counts));

  // Add error count if any
  if (plan.errors && plan.errors.length > 0) {
    lines.push(
      chalk.red(
        `${plan.errors.length} ${plan.errors.length === 1 ? "repository" : "repositories"} failed.`
      )
    );
  }

  return lines;
}

export function printPlan(plan: Plan): void {
  const lines = formatPlan(plan);
  for (const line of lines) {
    console.log(line);
  }
}
