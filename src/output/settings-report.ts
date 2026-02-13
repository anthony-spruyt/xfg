import { appendFileSync } from "node:fs";
import chalk from "chalk";
import {
  formatPropertyTree,
  type PropertyDiff,
} from "../settings/rulesets/formatter.js";
import type { Ruleset } from "../config/index.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
    rulesets: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
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

// =============================================================================
// Helpers
// =============================================================================

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

function formatSummary(totals: SettingsReport["totals"]): string {
  const parts: string[] = [];
  const settingsTotal = totals.settings.add + totals.settings.change;
  const rulesetsTotal =
    totals.rulesets.create + totals.rulesets.update + totals.rulesets.delete;

  if (settingsTotal > 0) {
    const settingWord = settingsTotal === 1 ? "setting" : "settings";
    const actions: string[] = [];
    if (totals.settings.add > 0) actions.push(`${totals.settings.add} to add`);
    if (totals.settings.change > 0)
      actions.push(`${totals.settings.change} to change`);
    parts.push(`${settingsTotal} ${settingWord} (${actions.join(", ")})`);
  }

  if (rulesetsTotal > 0) {
    const rulesetWord = rulesetsTotal === 1 ? "ruleset" : "rulesets";
    const actions: string[] = [];
    if (totals.rulesets.create > 0)
      actions.push(`${totals.rulesets.create} to create`);
    if (totals.rulesets.update > 0)
      actions.push(`${totals.rulesets.update} to update`);
    if (totals.rulesets.delete > 0)
      actions.push(`${totals.rulesets.delete} to delete`);
    parts.push(`${rulesetsTotal} ${rulesetWord} (${actions.join(", ")})`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return `Plan: ${parts.join(", ")}`;
}

// =============================================================================
// CLI Formatter
// =============================================================================

export function formatSettingsReportCLI(report: SettingsReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
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

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}

// =============================================================================
// Markdown Formatter
// =============================================================================

function formatValuePlain(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

function formatRulesetConfigPlain(config: Ruleset): string[] {
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

export function formatSettingsReportMarkdown(
  report: SettingsReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## Repository Settings Summary${titleSuffix}`);
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
      !repo.error
    ) {
      continue;
    }

    diffLines.push(
      `<span style="color:#d29922">~ ${escapeHtml(repo.repoName)}</span>`
    );

    for (const setting of repo.settings) {
      // Skip settings where both values are undefined
      if (setting.oldValue === undefined && setting.newValue === undefined) {
        continue;
      }
      if (setting.action === "add") {
        diffLines.push(
          `<span style="color:#3fb950">    + ${escapeHtml(setting.name)}: ${escapeHtml(formatValuePlain(setting.newValue))}</span>`
        );
      } else {
        diffLines.push(
          `<span style="color:#d29922">    ~ ${escapeHtml(setting.name)}: ${escapeHtml(formatValuePlain(setting.oldValue))} → ${escapeHtml(formatValuePlain(setting.newValue))}</span>`
        );
      }
    }

    for (const ruleset of repo.rulesets) {
      if (ruleset.action === "create") {
        diffLines.push(
          `<span style="color:#3fb950">    + ruleset "${escapeHtml(ruleset.name)}"</span>`
        );
        if (ruleset.config) {
          for (const line of formatRulesetConfigPlain(ruleset.config)) {
            diffLines.push(
              `<span style="color:#3fb950">${escapeHtml(line)}</span>`
            );
          }
        }
      } else if (ruleset.action === "update") {
        diffLines.push(
          `<span style="color:#d29922">    ~ ruleset "${escapeHtml(ruleset.name)}"</span>`
        );
        if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
          for (const diff of ruleset.propertyDiffs) {
            const path = diff.path.join(".");
            if (diff.action === "add") {
              diffLines.push(
                `<span style="color:#3fb950">        + ${escapeHtml(path)}: ${escapeHtml(formatValuePlain(diff.newValue))}</span>`
              );
            } else if (diff.action === "change") {
              diffLines.push(
                `<span style="color:#d29922">        ~ ${escapeHtml(path)}: ${escapeHtml(formatValuePlain(diff.oldValue))} → ${escapeHtml(formatValuePlain(diff.newValue))}</span>`
              );
            } else if (diff.action === "remove") {
              diffLines.push(
                `<span style="color:#f85149">        - ${escapeHtml(path)}</span>`
              );
            }
          }
        }
      } else if (ruleset.action === "delete") {
        diffLines.push(
          `<span style="color:#f85149">    - ruleset "${escapeHtml(ruleset.name)}"</span>`
        );
      }
    }

    if (repo.error) {
      diffLines.push(
        `<span style="color:#f85149">    ! Error: ${escapeHtml(repo.error)}</span>`
      );
    }
  }

  if (diffLines.length > 0) {
    lines.push("<pre>");
    lines.push(...diffLines);
    lines.push("</pre>");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSummary(report.totals)}**`);

  return lines.join("\n");
}

// =============================================================================
// File Writer
// =============================================================================

export function writeSettingsReportSummary(
  report: SettingsReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSettingsReportMarkdown(report, dryRun);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
