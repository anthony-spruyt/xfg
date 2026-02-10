import { appendFileSync } from "node:fs";
import type {
  Plan,
  Resource,
  PlanCounts,
  RepoError,
} from "./plan-formatter.js";

export type { Plan, Resource, PlanCounts, RepoError };

export interface PlanMarkdownOptions {
  title: string;
  dryRun: boolean;
}

function getActionSymbol(action: string): string {
  switch (action) {
    case "create":
      return "+";
    case "update":
      return "~";
    case "delete":
      return "-";
    case "skipped":
      return "⊘";
    default:
      return "";
  }
}

function formatResourceIdPlain(resource: Resource): string {
  return `${resource.type} "${resource.repo}/${resource.name}"`;
}

function countActions(resources: Resource[]): PlanCounts {
  return {
    create: resources.filter((r) => r.action === "create").length,
    update: resources.filter((r) => r.action === "update").length,
    delete: resources.filter((r) => r.action === "delete").length,
    skipped: resources.filter((r) => r.action === "skipped").length,
  };
}

function formatPlanSummaryPlain(counts: PlanCounts): string {
  const parts: string[] = [];

  if (counts.create > 0) parts.push(`${counts.create} to create`);
  if (counts.update > 0) parts.push(`${counts.update} to change`);
  if (counts.delete > 0) parts.push(`${counts.delete} to destroy`);

  if (parts.length === 0) {
    return "No changes";
  }

  return parts.join(", ");
}

export function formatPlanMarkdown(
  plan: Plan,
  options: PlanMarkdownOptions
): string {
  const lines: string[] = [];
  const counts = countActions(plan.resources);
  const changedResources = plan.resources.filter(
    (r) => r.action !== "unchanged"
  );

  // Title
  const titleSuffix = options.dryRun ? " (Dry Run)" : "";
  lines.push(`## ${options.title}${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (options.dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Plan summary as heading
  const summaryText = formatPlanSummaryPlain(counts);
  lines.push(`### Plan: ${summaryText}`);
  lines.push("");

  // Resource table (if any changes)
  if (changedResources.length > 0) {
    lines.push("<details open>");
    lines.push("<summary><strong>Resources</strong></summary>");
    lines.push("");
    lines.push("| Resource | Action |");
    lines.push("|----------|--------|");

    for (const resource of changedResources) {
      const symbol = getActionSymbol(resource.action);
      const id = formatResourceIdPlain(resource);
      lines.push(`| \`${symbol} ${id}\` | ${resource.action} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  // Add diff details for resources that have them
  const resourcesWithDiffs = changedResources.filter(
    (r) => r.details?.diff && r.details.diff.length > 0
  );

  for (const resource of resourcesWithDiffs) {
    lines.push("");
    lines.push("<details>");
    lines.push(
      `<summary><strong>Diff: ${formatResourceIdPlain(resource)}</strong></summary>`
    );
    lines.push("");
    lines.push("```diff");
    for (const diffLine of resource.details!.diff!) {
      lines.push(diffLine);
    }
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }

  // Error section
  if (plan.errors && plan.errors.length > 0) {
    lines.push("");
    lines.push("<details open>");
    lines.push("<summary><strong>Errors</strong></summary>");
    lines.push("");
    lines.push("| Repository | Error |");
    lines.push("|------------|-------|");

    for (const error of plan.errors) {
      lines.push(`| ${error.repo} | ${error.message} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

export function writePlanSummary(
  plan: Plan,
  options: PlanMarkdownOptions
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatPlanMarkdown(plan, options);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
