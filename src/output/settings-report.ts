import chalk from "chalk";
import type { PropertyDiff } from "../settings/index.js";
import type { Ruleset, Label } from "../config/index.js";
import { writeGitHubStepSummary } from "./github-summary.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { create: number; update: number };
    rulesets: { create: number; update: number; delete: number };
    labels: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  labels: LabelChange[];
  error?: string;
}

export interface SettingChange {
  name: string;
  action: "create" | "update";
  oldValue?: unknown;
  newValue: unknown;
}

export interface RulesetChange {
  name: string;
  action: "create" | "update" | "delete";
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}

export interface LabelChange {
  name: string;
  action: "create" | "update" | "delete";
  newName?: string;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
  config?: Label;
}

/**
 * Shared recursive renderer for ruleset config objects.
 * The formatLine callback controls indentation style and coloring:
 *   formatLine(depth, text) → formatted line string
 */
function renderRulesetConfig(
  config: Ruleset,
  startDepth: number,
  formatLine: (depth: number, text: string) => string
): string[] {
  const lines: string[] = [];

  function renderObject(obj: Record<string, unknown>, depth: number): void {
    for (const [k, v] of Object.entries(obj)) {
      renderValue(k, v, depth);
    }
  }

  function renderValue(key: string, value: unknown, depth: number): void {
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(formatLine(depth, `+ ${key}: []`));
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(
          formatLine(
            depth,
            `+ ${key}: [${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
          )
        );
      } else {
        lines.push(formatLine(depth, `+ ${key}:`));
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === "object" && item !== null) {
            const obj = item as Record<string, unknown>;
            const typeLabel = "type" in obj ? ` (${obj.type})` : "";
            lines.push(formatLine(depth + 1, `+ [${i}]${typeLabel}:`));
            renderObject(obj, depth + 2);
          } else {
            lines.push(formatLine(depth + 1, `+ ${formatValuePlain(item)}`));
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(formatLine(depth, `+ ${key}:`));
      renderObject(value as Record<string, unknown>, depth + 1);
    } else {
      lines.push(formatLine(depth, `+ ${key}: ${formatValuePlain(value)}`));
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "name") continue;
    renderValue(key, value, startDepth);
  }

  return lines;
}

/**
 * Formats a summary entry like "3 files (1 to create, 2 to update)".
 * Returns null if total is 0.
 */
export function formatCountEntry(
  noun: string,
  pluralNoun: string,
  counts: { label: string; value: number }[]
): string | null {
  const total = counts.reduce((sum, c) => sum + c.value, 0);
  if (total === 0) return null;

  const word = total === 1 ? noun : pluralNoun;
  const actions = counts
    .filter((c) => c.value > 0)
    .map((c) => `${c.value} ${c.label}`);
  return `${total} ${word} (${actions.join(", ")})`;
}

function formatSettingsSummary(totals: SettingsReport["totals"]): string {
  const parts: string[] = [];

  const settingsEntry = formatCountEntry("setting", "settings", [
    { label: "to create", value: totals.settings.create },
    { label: "to update", value: totals.settings.update },
  ]);
  if (settingsEntry) parts.push(settingsEntry);

  const rulesetsEntry = formatCountEntry("ruleset", "rulesets", [
    { label: "to create", value: totals.rulesets.create },
    { label: "to update", value: totals.rulesets.update },
    { label: "to delete", value: totals.rulesets.delete },
  ]);
  if (rulesetsEntry) parts.push(rulesetsEntry);

  const labelsEntry = formatCountEntry("label", "labels", [
    { label: "to create", value: totals.labels.create },
    { label: "to update", value: totals.labels.update },
    { label: "to delete", value: totals.labels.delete },
  ]);
  if (labelsEntry) parts.push(labelsEntry);

  if (parts.length === 0) {
    return "No changes";
  }

  return `Plan: ${parts.join(", ")}`;
}

function colorizeDiffLine(line: string): string {
  const prefix = line.charAt(0);
  const indented = `    ${line}`;
  if (prefix === "+") return chalk.green(indented);
  if (prefix === "!") return chalk.yellow(indented);
  if (prefix === "-") return chalk.red(indented);
  return indented;
}

export function formatSettingsReportCLI(report: SettingsReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      repo.labels.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    const diffLines: string[] = [];
    renderRepoSettingsDiffLines(repo, diffLines);
    for (const diffLine of diffLines) {
      lines.push(colorizeDiffLine(diffLine));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSettingsSummary(report.totals));

  return lines;
}

function formatValuePlain(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function formatRulesetConfigPlain(config: Ruleset): string[] {
  return renderRulesetConfig(
    config,
    1,
    (depth, text) => `+${"  ".repeat(depth)}${text.substring(1)}`
  );
}

/**
 * Renders a single repo's settings/rulesets/labels changes as plain-text diff lines.
 * Shared between formatSettingsReportMarkdown and unified-summary's renderSettingsLines.
 */
export function renderRepoSettingsDiffLines(
  repo: RepoChanges,
  diffLines: string[]
): void {
  for (const setting of repo.settings) {
    if (setting.oldValue === undefined && setting.newValue === undefined) {
      continue;
    }
    if (setting.action === "create") {
      diffLines.push(
        `+ ${setting.name}: ${formatValuePlain(setting.newValue)}`
      );
    } else {
      diffLines.push(
        `! ${setting.name}: ${formatValuePlain(setting.oldValue)} → ${formatValuePlain(setting.newValue)}`
      );
    }
  }

  for (const ruleset of repo.rulesets) {
    if (ruleset.action === "create") {
      diffLines.push(`+ ruleset "${ruleset.name}"`);
      if (ruleset.config) {
        diffLines.push(...formatRulesetConfigPlain(ruleset.config));
      }
    } else if (ruleset.action === "update") {
      diffLines.push(`! ruleset "${ruleset.name}"`);
      if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
        for (const diff of ruleset.propertyDiffs) {
          const path = diff.path.join(".");
          if (diff.action === "add") {
            diffLines.push(`+   ${path}: ${formatValuePlain(diff.newValue)}`);
          } else if (diff.action === "change") {
            diffLines.push(
              `!   ${path}: ${formatValuePlain(diff.oldValue)} → ${formatValuePlain(diff.newValue)}`
            );
          } else if (diff.action === "remove") {
            diffLines.push(
              diff.oldValue !== undefined
                ? `-   ${path}: ${formatValuePlain(diff.oldValue)}`
                : `-   ${path}`
            );
          }
        }
      }
    } else if (ruleset.action === "delete") {
      diffLines.push(`- ruleset "${ruleset.name}"`);
    }
  }

  for (const label of repo.labels) {
    if (label.action === "create") {
      diffLines.push(`+ label "${label.name}"`);
      if (label.config) {
        diffLines.push(`+   color: "${label.config.color}"`);
        if (label.config.description !== undefined) {
          diffLines.push(`+   description: "${label.config.description}"`);
        }
      }
    } else if (label.action === "update") {
      if (label.newName) {
        diffLines.push(`! label "${label.name}" \u2192 "${label.newName}"`);
      } else {
        diffLines.push(`! label "${label.name}"`);
      }
      if (label.propertyChanges) {
        for (const prop of label.propertyChanges) {
          if (prop.property === "new_name") continue;
          if (prop.oldValue !== undefined) {
            diffLines.push(
              `!   ${prop.property}: "${prop.oldValue}" \u2192 "${prop.newValue}"`
            );
          } else {
            diffLines.push(`!   ${prop.property}: "${prop.newValue}"`);
          }
        }
      }
    } else if (label.action === "delete") {
      diffLines.push(`- label "${label.name}"`);
    }
  }

  if (repo.error) {
    diffLines.push(`- Error: ${repo.error}`);
  }
}

export function formatSettingsReportMarkdown(
  report: SettingsReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const title = dryRun ? "## xfg Plan" : "## xfg Apply";
  lines.push(title);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Diff block
  const diffLines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      repo.labels.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    diffLines.push(`@@ ${repo.repoName} @@`);
    renderRepoSettingsDiffLines(repo, diffLines);
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSettingsSummary(report.totals)}**`);

  return lines.join("\n");
}

export function writeSettingsReportSummary(
  report: SettingsReport,
  dryRun: boolean,
  summaryPath: string | undefined
): void {
  const markdown = formatSettingsReportMarkdown(report, dryRun);
  writeGitHubStepSummary(markdown, summaryPath);
}
