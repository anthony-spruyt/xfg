import chalk from "chalk";
import type {
  PropertyDiff,
  ActiveAction,
  SecretsPlanEntry,
} from "../settings/index.js";
import type { Ruleset, Label } from "../config/index.js";
import { writeGitHubStepSummary } from "./github-summary.js";
import { formatScalarValue } from "../shared/string-utils.js";
import {
  formatActionCountEntry,
  type ActionTotals,
} from "../shared/count-format.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { create: number; update: number };
    rulesets: { create: number; update: number; delete: number };
    labels: { create: number; update: number; delete: number };
    variables?: { create: number; update: number; delete: number };
    secrets?: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  labels: LabelChange[];
  variables?: {
    name: string;
    action: ActiveAction;
    oldValue?: string;
    newValue?: string;
  }[];
  secrets?: SecretsPlanEntry[];
  error?: string;
}

export function hasRepoSettingsChanges(repo: RepoChanges): boolean {
  return (
    repo.settings.length > 0 ||
    repo.rulesets.length > 0 ||
    repo.labels.length > 0 ||
    (repo.variables ?? []).length > 0 ||
    (repo.secrets ?? []).length > 0 ||
    !!repo.error
  );
}

export interface SettingChange {
  name: string;
  action: Exclude<ActiveAction, "delete">;
  oldValue?: unknown;
  newValue: unknown;
}

export interface RulesetChange {
  name: string;
  action: ActiveAction;
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}

export interface LabelChange {
  name: string;
  action: ActiveAction;
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

const SETTINGS_CATEGORIES: {
  noun: string;
  plural: string;
  totals: (t: SettingsReport["totals"]) => ActionTotals | undefined;
}[] = [
  { noun: "setting", plural: "settings", totals: (t) => t.settings },
  { noun: "ruleset", plural: "rulesets", totals: (t) => t.rulesets },
  { noun: "label", plural: "labels", totals: (t) => t.labels },
  { noun: "variable", plural: "variables", totals: (t) => t.variables },
  { noun: "secret", plural: "secrets", totals: (t) => t.secrets },
];

/** One count entry per settings category with changes, e.g. "2 labels (2 to create)". */
export function formatSettingsCountEntries(
  totals: SettingsReport["totals"],
  dryRun: boolean
): string[] {
  return SETTINGS_CATEGORIES.flatMap(({ noun, plural, totals: pick }) => {
    const t = pick(totals);
    const entry = t && formatActionCountEntry(noun, plural, t, dryRun);
    return entry ? [entry] : [];
  });
}

function formatSettingsSummary(totals: SettingsReport["totals"]): string {
  const parts = formatSettingsCountEntries(totals, true);
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
    if (!hasRepoSettingsChanges(repo)) continue;

    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    const diffLines: string[] = [];
    renderRepoSettingsDiffLines(repo, diffLines);
    for (const diffLine of diffLines) {
      lines.push(colorizeDiffLine(diffLine));
    }

    lines.push("");
  }

  lines.push(formatSettingsSummary(report.totals));

  return lines;
}

function formatValuePlain(val: unknown): string {
  const scalar = formatScalarValue(val);
  if (scalar !== undefined) return scalar;
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
  const startLength = diffLines.length;

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

  if (repo.rulesets.length > 0 && diffLines.length > startLength) {
    diffLines.push("");
  }

  for (let i = 0; i < repo.rulesets.length; i++) {
    const ruleset = repo.rulesets[i];

    if (i > 0) diffLines.push("");

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

  if (repo.labels.length > 0 && diffLines.length > startLength) {
    diffLines.push("");
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

  if ((repo.variables ?? []).length > 0 && diffLines.length > startLength) {
    diffLines.push("");
  }

  for (const variable of repo.variables ?? []) {
    if (variable.action === "create") {
      diffLines.push(
        `+ variable "${variable.name}": ${formatValuePlain(variable.newValue)}`
      );
    } else if (variable.action === "update") {
      diffLines.push(
        `! variable "${variable.name}": ${formatValuePlain(variable.oldValue)} → ${formatValuePlain(variable.newValue)}`
      );
    } else if (variable.action === "delete") {
      diffLines.push(`- variable "${variable.name}"`);
    }
  }

  if ((repo.secrets ?? []).length > 0 && diffLines.length > startLength) {
    diffLines.push("");
  }

  // Names only: secret values are write-only and must never reach output.
  for (const secret of repo.secrets ?? []) {
    if (secret.action === "create") {
      diffLines.push(`+ secret "${secret.name}"`);
    } else if (secret.action === "update") {
      diffLines.push(`! secret "${secret.name}" (update, value write-only)`);
    } else {
      diffLines.push(`- secret "${secret.name}"`);
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

  const title = dryRun ? "## xfg Plan" : "## xfg Apply";
  lines.push(title);
  lines.push("");

  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  for (const repo of report.repos) {
    if (!hasRepoSettingsChanges(repo)) continue;

    lines.push(`### ${repo.repoName}`);
    lines.push("");

    const diffLines: string[] = [];
    renderRepoSettingsDiffLines(repo, diffLines);

    if (diffLines.length > 0) {
      lines.push("```diff");
      lines.push(...diffLines);
      lines.push("```");
      lines.push("");
    }
  }

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
