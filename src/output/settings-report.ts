import { appendFileSync } from "node:fs";
import chalk from "chalk";
import {
  formatPropertyTree,
  type PropertyDiff,
} from "../settings/rulesets/formatter.js";
import type { Ruleset, Label } from "../config/index.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
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
  action: "add" | "change";
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

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

function formatRulesetConfig(config: Ruleset, indent: number): string[] {
  const lines: string[] = [];

  function renderObject(
    obj: Record<string, unknown>,
    currentIndent: number
  ): void {
    for (const [k, v] of Object.entries(obj)) {
      renderValue(k, v, currentIndent);
    }
  }

  function renderValue(
    key: string,
    value: unknown,
    currentIndent: number
  ): void {
    const pad = "    ".repeat(currentIndent);
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(chalk.green(`${pad}+ ${key}: []`));
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(
          chalk.green(
            `${pad}+ ${key}: [${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
          )
        );
      } else {
        lines.push(chalk.green(`${pad}+ ${key}:`));
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === "object" && item !== null) {
            const obj = item as Record<string, unknown>;
            const typeLabel = "type" in obj ? ` (${obj.type})` : "";
            lines.push(chalk.green(`${pad}    + [${i}]${typeLabel}:`));
            renderObject(obj, currentIndent + 2);
          } else {
            lines.push(chalk.green(`${pad}    + ${formatValue(item)}`));
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(chalk.green(`${pad}+ ${key}:`));
      renderObject(value as Record<string, unknown>, currentIndent + 1);
    } else {
      lines.push(chalk.green(`${pad}+ ${key}: ${formatValue(value)}`));
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "name") continue; // Name is in the header
    renderValue(key, value, indent);
  }

  return lines;
}

/**
 * Formats a summary entry like "3 files (1 to create, 2 to update)".
 * Returns null if total is 0.
 */
function formatCountEntry(
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
    { label: "to add", value: totals.settings.add },
    { label: "to change", value: totals.settings.change },
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

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Settings
    for (const setting of repo.settings) {
      // Skip settings where both values are undefined
      if (setting.oldValue === undefined && setting.newValue === undefined) {
        continue;
      }
      if (setting.action === "add") {
        lines.push(
          chalk.green(`    + ${setting.name}: ${formatValue(setting.newValue)}`)
        );
      } else {
        lines.push(
          chalk.yellow(
            `    ~ ${setting.name}: ${formatValue(setting.oldValue)} → ${formatValue(setting.newValue)}`
          )
        );
      }
    }

    // Rulesets
    for (const ruleset of repo.rulesets) {
      if (ruleset.action === "create") {
        lines.push(chalk.green(`    + ruleset "${ruleset.name}"`));
        if (ruleset.config) {
          lines.push(...formatRulesetConfig(ruleset.config, 2));
        }
      } else if (ruleset.action === "update") {
        lines.push(chalk.yellow(`    ~ ruleset "${ruleset.name}"`));
        if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
          const treeLines = formatPropertyTree(ruleset.propertyDiffs);
          for (const line of treeLines) {
            lines.push(`        ${line}`);
          }
        }
      } else if (ruleset.action === "delete") {
        lines.push(chalk.red(`    - ruleset "${ruleset.name}"`));
      }
    }

    // Labels
    for (const label of repo.labels) {
      if (label.action === "create") {
        lines.push(chalk.green(`    + label "${label.name}"`));
        if (label.config) {
          lines.push(chalk.green(`        color: "${label.config.color}"`));
          if (label.config.description !== undefined) {
            lines.push(
              chalk.green(`        description: "${label.config.description}"`)
            );
          }
        }
      } else if (label.action === "update") {
        if (label.newName) {
          lines.push(
            chalk.yellow(
              `    ~ label "${label.name}" \u2192 "${label.newName}"`
            )
          );
        } else {
          lines.push(chalk.yellow(`    ~ label "${label.name}"`));
        }
        if (label.propertyChanges) {
          for (const prop of label.propertyChanges) {
            if (prop.property === "new_name") continue;
            if (prop.oldValue !== undefined) {
              lines.push(
                chalk.yellow(
                  `        ${prop.property}: "${prop.oldValue}" \u2192 "${prop.newValue}"`
                )
              );
            } else {
              lines.push(
                chalk.yellow(`        ${prop.property}: "${prop.newValue}"`)
              );
            }
          }
        }
      } else if (label.action === "delete") {
        lines.push(chalk.red(`    - label "${label.name}"`));
      }
    }

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSettingsSummary(report.totals));

  return lines;
}

export function formatValuePlain(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

export function formatRulesetConfigPlain(config: Ruleset): string[] {
  const lines: string[] = [];

  function renderObject(obj: Record<string, unknown>, depth: number): void {
    for (const [k, v] of Object.entries(obj)) {
      renderValue(k, v, depth);
    }
  }

  function renderValue(key: string, value: unknown, depth: number): void {
    const indent = "  ".repeat(depth);
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`+${indent} ${key}: []`);
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(
          `+${indent} ${key}: [${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
        );
      } else {
        lines.push(`+${indent} ${key}:`);
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === "object" && item !== null) {
            const obj = item as Record<string, unknown>;
            const typeLabel = "type" in obj ? ` (${obj.type})` : "";
            lines.push(`+${indent}   [${i}]${typeLabel}:`);
            renderObject(obj, depth + 2);
          } else {
            lines.push(`+${indent}   ${formatValuePlain(item)}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`+${indent} ${key}:`);
      renderObject(value as Record<string, unknown>, depth + 1);
    } else {
      lines.push(`+${indent} ${key}: ${formatValuePlain(value)}`);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "name") continue;
    renderValue(key, value, 1);
  }

  return lines;
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
    if (setting.action === "add") {
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
            diffLines.push(`-   ${path}`);
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
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSettingsReportMarkdown(report, dryRun);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
