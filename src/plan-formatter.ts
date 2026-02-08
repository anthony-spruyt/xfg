import chalk from "chalk";

export type ResourceType = "file" | "ruleset" | "setting";
export type ResourceAction = "create" | "update" | "delete" | "unchanged";

export interface Resource {
  type: ResourceType;
  repo: string;
  name: string;
  action: ResourceAction;
  details?: ResourceDetails;
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
