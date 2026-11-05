import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import {
  validateRawConfig,
  validateForSync,
  validateNormalizedConfig,
} from "../../../src/config/validator.js";
import { normalizeConfig } from "../../../src/config/normalizer.js";
import { toErrorMessage } from "../../../src/shared/type-guards.js";
import type {
  ActionsSettings,
  CodeScanningRule,
  CodeScanningSettings,
  CollaboratorsConfig,
  Config,
  DeploymentBranchPolicy,
  EnvironmentConfig,
  FileExtensionRestrictionRule,
  FilePathRestrictionRule,
  GitHubRepoSettings,
  MaxFileSizeRule,
  MaxFilePathLengthRule,
  PRMergeOptions,
  PullRequestRule,
  CodeQualityRule,
  RawConfig,
  RepoSettings,
  RequiredDeploymentsRule,
  RequiredStatusChecksRule,
  Ruleset,
  UpdateRule,
  WorkflowsRule,
  BranchNamePatternRule,
} from "../../../src/config/types.js";

type Json = Record<string, unknown>;

const repoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".."
);
const schema = JSON.parse(
  readFileSync(join(repoRoot, "config-schema.json"), "utf-8")
) as Json;
const defs = schema.definitions as Record<string, Json>;

const ajv = new Ajv({ strict: false });
const schemaValidator = ajv.compile(schema);

function asNode(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function deref(node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  return deref(defs[ref.replace("#/definitions/", "")]);
}

function isDirective(node: Json): boolean {
  const resolved = deref(node);
  const props = asNode(resolved.properties);
  if (props && "$arrayMerge" in props) return true;
  return (
    Array.isArray(resolved.allOf) &&
    resolved.allOf.some((member) => {
      const m = asNode(member);
      return m !== undefined && isDirective(m);
    })
  );
}

function allowsType(node: Json, type: string): boolean {
  return (
    node.type === type || (Array.isArray(node.type) && node.type.includes(type))
  );
}

interface Walk {
  sites: Set<string>;
  blocks: Set<string>;
}

function joinPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function walkItems(items: Json, path: string, out: Walk): void {
  const node = deref(items);
  const branches = Array.isArray(node.oneOf) ? node.oneOf : undefined;
  if (!branches) {
    walk(node, `${path}[]`, out);
    return;
  }
  for (const branch of branches) {
    const b = asNode(branch);
    if (!b) continue;
    const typeProp = asNode(asNode(deref(b).properties)?.type);
    const tag = typeProp?.const;
    walk(b, `${path}[${typeof tag === "string" ? tag : ""}]`, out);
  }
}

function walk(raw: unknown, path: string, out: Walk): void {
  const start = asNode(raw);
  if (!start) return;
  const node = deref(start);
  if (isDirective(node)) {
    out.sites.add(`${path}.$values`);
    return;
  }
  if (allowsType(node, "array")) out.sites.add(path);

  const props = asNode(node.properties);
  if (props && asNode(props.inherit)) out.blocks.add(path);
  for (const [key, child] of Object.entries(props ?? {})) {
    walk(child, joinPath(path, key), out);
  }
  if (asNode(node.additionalProperties)) {
    walk(node.additionalProperties, joinPath(path, "x"), out);
  }
  if (asNode(node.items)) walkItems(node.items as Json, path, out);
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((b) => walk(b, path, out));
  }
  for (const key of ["if", "then", "else"]) walk(node[key], path, out);
}

function walkFrom(node: Json, path: string): Walk {
  const out: Walk = { sites: new Set(), blocks: new Set() };
  walk(node, path, out);
  return out;
}

const EXCLUDED: Record<string, string> = {
  repos: "the repo list, not a layer",
  "repos[].git": "one or several clone URLs per repo",
  "repos[].groups": "group names to expand",
  conditionalGroups: "the condition list, not a layer",
  "conditionalGroups[].when.allOf": "group names in a condition",
  "conditionalGroups[].when.anyOf": "group names in a condition",
  "conditionalGroups[].when.noneOf": "group names in a condition",
  "groups.x.extends": "group names to extend",
  githubHosts: "root-only host list",
  "files.x.content": "file lines merge by the file's mergeStrategy",
  "files.x.header": "innermost layer wins",
  "**.$values": "the directive's own payload",
  "prOptions.ai.**": "ai replaces whole",
};

function excluded(path: string): boolean {
  return Object.keys(EXCLUDED).some((pattern) => {
    if (pattern.startsWith("**.")) return path.endsWith(pattern.slice(2));
    if (pattern.endsWith(".**")) return path.startsWith(pattern.slice(0, -2));
    return path === pattern;
  });
}

const LAYER_PREFIX =
  /^(groups\.x\.|conditionalGroups\[\]\.|repos\[\]\.)(?=(files|settings|prOptions)\b)/;

const repoSettingsWalk = walkFrom(defs.repoSettings, "settings");
const prOptionsWalk = walkFrom(defs.prOptions, "prOptions");
const rootSettingsWalk = walkFrom(defs.rootSettings, "settings");

const derivedPaths = [...repoSettingsWalk.sites, ...prOptionsWalk.sites]
  .filter((p) => !excluded(p))
  .sort();

const blockPaths = [...repoSettingsWalk.blocks, ...prOptionsWalk.blocks];

// Temporary: paths that fail on today's code; empty when the feature is done
const EXPECTED_RED = new Set<string>([
  "settings.codeScanning.languages",
  "settings.collaborators.users",
  "settings.environments.x.deploymentBranchPolicy.custom",
]);

interface Sample {
  a: unknown;
  b: unknown;
  c: unknown;
  bad: unknown;
  siblings?: Record<string, Json>;
  matchBy?: string;
}

const team = (id: number, minimumApprovals: number) => ({
  filePatterns: ["a.txt"],
  minimumApprovals,
  reviewer: { id, type: "Team" },
});
const tool = (name: string) => ({
  tool: name,
  alertsThreshold: "errors",
  securityAlertsThreshold: "high_or_higher",
});
const RULES = "settings.rulesets.x.rules";
const PR_PARAMS = `${RULES}[pull_request].parameters`;
const REVIEWERS = `${PR_PARAMS}.requiredReviewers`;

const SAMPLES: Record<string, Sample> = {
  "settings.rulesets.x.bypassActors": {
    a: { actorId: 1, actorType: "Team" },
    b: { actorId: 2, actorType: "User" },
    c: { actorId: 3, actorType: "Integration" },
    bad: { actorId: "one", actorType: "Team" },
  },
  "settings.rulesets.x.conditions.refName.include": {
    a: "refs/heads/a",
    b: "refs/heads/b",
    c: "refs/heads/c",
    bad: 1,
  },
  "settings.rulesets.x.conditions.refName.exclude": {
    a: "refs/heads/a",
    b: "refs/heads/b",
    c: "refs/heads/c",
    bad: 1,
  },
  [RULES]: {
    a: { type: "deletion" },
    b: { type: "creation" },
    c: { type: "required_signatures" },
    bad: { type: "no_such_rule" },
  },
  [`${PR_PARAMS}.allowedMergeMethods`]: {
    a: "merge",
    b: "squash",
    c: "rebase",
    bad: "fast-forward",
  },
  [REVIEWERS]: {
    a: team(1, 1),
    b: team(2, 2),
    c: team(3, 3),
    bad: { ...team(1, 1), filePatterns: "a.txt" },
  },
  [`${REVIEWERS}[].filePatterns`]: {
    a: "a.txt",
    b: "b.txt",
    c: "c.txt",
    bad: 1,
    siblings: {
      [`${REVIEWERS}[]`]: {
        minimumApprovals: 1,
        reviewer: { id: 1, type: "Team" },
      },
    },
    matchBy: "minimumApprovals",
  },
  [`${RULES}[required_status_checks].parameters.requiredStatusChecks`]: {
    a: { context: "a" },
    b: { context: "b" },
    c: { context: "c" },
    bad: { integrationId: 1 },
  },
  [`${RULES}[required_deployments].parameters.requiredDeploymentEnvironments`]:
    { a: "a", b: "b", c: "c", bad: 1 },
  [`${RULES}[code_scanning].parameters.codeScanningTools`]: {
    a: tool("a"),
    b: tool("b"),
    c: tool("c"),
    bad: { ...tool("a"), alertsThreshold: "sometimes" },
  },
  [`${RULES}[workflows].parameters.workflows`]: {
    a: { path: ".github/workflows/a.yaml", repositoryId: 1 },
    b: { path: ".github/workflows/b.yaml", repositoryId: 1 },
    c: { path: ".github/workflows/c.yaml", repositoryId: 1 },
    bad: { path: 1, repositoryId: 1 },
  },
  [`${RULES}[file_path_restriction].parameters.restrictedFilePaths`]: {
    a: "a/",
    b: "b/",
    c: "c/",
    bad: 1,
  },
  [`${RULES}[file_extension_restriction].parameters.restrictedFileExtensions`]:
    { a: ".a", b: ".b", c: ".c", bad: 1 },
  "settings.codeScanning.languages": {
    a: "go",
    b: "python",
    c: "ruby",
    bad: "cobol",
    siblings: { "settings.codeScanning": { state: "configured" } },
  },
  "settings.actions.patternsAllowed": {
    a: "a/*@*",
    b: "b/*@*",
    c: "c/*@*",
    bad: "",
    siblings: { "settings.actions": { allowedActions: "selected" } },
  },
  "settings.collaborators.users": {
    a: "alice",
    b: "bob",
    c: "carol",
    bad: "not valid!",
  },
  "settings.environments.x.deploymentBranchPolicy.custom": {
    a: { type: "branch", name: "a" },
    b: { type: "branch", name: "b" },
    c: { type: "tag", name: "c" },
    bad: { type: "branch", name: "" },
  },
  "prOptions.labels": { a: "a", b: "b", c: "c", bad: "" },
};

type Token = { kind: "key"; name: string } | { kind: "item"; type?: string };

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)) {
    if (m[1] !== undefined) tokens.push({ kind: "key", name: m[1] });
    else tokens.push({ kind: "item", ...(m[2] ? { type: m[2] } : {}) });
  }
  return tokens;
}

function pathText(tokens: Token[]): string {
  return tokens
    .map((t, i) =>
      t.kind === "item" ? `[${t.type ?? ""}]` : i === 0 ? t.name : `.${t.name}`
    )
    .join("");
}

const directive = (strategy: string, values: unknown[]): Json => ({
  $arrayMerge: strategy,
  $values: values,
});

function place(
  sample: Sample,
  tokens: Token[],
  leaf: unknown,
  mode: "base" | "overlay"
): Json {
  let current: unknown = leaf;
  for (let k = tokens.length - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.kind === "key") {
      current = {
        [t.name]: current,
        ...sample.siblings?.[pathText(tokens.slice(0, k))],
      };
      continue;
    }
    const item = {
      ...(t.type ? { type: t.type } : {}),
      ...sample.siblings?.[pathText(tokens.slice(0, k + 1))],
      ...(current as Json),
    };
    current =
      mode === "base"
        ? [item]
        : {
            $arrayMerge: "merge",
            $matchBy: t.type ? "type" : sample.matchBy,
            $values: [item],
          };
  }
  return current as Json;
}

const LAYERS = ["group", "conditionalGroup", "repo"] as const;
type Layer = (typeof LAYERS)[number];

const LAYER_ERROR_PREFIX: Record<Layer, string> = {
  group: "groups.g",
  conditionalGroup: "conditionalGroups[0]",
  repo: "Repo ",
};

interface Plan {
  root?: Json;
  layers?: Partial<Record<Layer, Json>>;
}

function buildConfig(plan: Plan): Json {
  const group: Json = { files: { "g.json": { content: {} } } };
  const config: Json = {
    id: "guard",
    files: { "x.json": { content: {} } },
    groups: { g: group },
    repos: [{ git: "https://github.com/org/repo.git", groups: ["g"] }],
    ...plan.root,
  };
  Object.assign(group, plan.layers?.group);
  if (plan.layers?.conditionalGroup) {
    config.conditionalGroups = [
      { when: { allOf: ["g"] }, ...plan.layers.conditionalGroup },
    ];
  }
  if (plan.layers?.repo) {
    config.repos = [
      {
        git: "https://github.com/org/repo.git",
        groups: ["g"],
        ...plan.layers.repo,
      },
    ];
  }
  return config;
}

function stage<T>(name: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new Error(`${name}: ${toErrorMessage(error)}`, { cause: error });
  }
}

function runPipeline(config: Json): Config {
  stage("schema", () => {
    if (!schemaValidator(config)) {
      throw new Error(ajv.errorsText(schemaValidator.errors));
    }
  });
  stage("validateRawConfig", () =>
    validateRawConfig(structuredClone(config) as unknown as RawConfig)
  );
  stage("validateForSync", () =>
    validateForSync(structuredClone(config) as unknown as RawConfig)
  );
  const normalized = stage("normalizeConfig", () =>
    normalizeConfig(structuredClone(config) as unknown as RawConfig, {})
  );
  stage("validateNormalizedConfig", () => validateNormalizedConfig(normalized));
  const leaked = JSON.stringify(normalized).match(
    /\$arrayMerge|\$values|\$matchBy/
  );
  if (leaked) throw new Error(`directive key ${leaked[0]} reached the output`);
  return normalized;
}

function read(config: Config, tokens: Token[]): unknown {
  let current: unknown = config.repos[0];
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    if (token.kind === "key") {
      current = (current as Json)[token.name];
    } else if (Array.isArray(current)) {
      current = current.find(
        (item) => token.type === undefined || (item as Json).type === token.type
      );
    } else {
      return undefined;
    }
  }
  return current;
}

function expectArray(
  failures: string[],
  id: string,
  plan: Plan,
  tokens: Token[],
  expected: unknown
): void {
  try {
    const result = read(runPipeline(buildConfig(plan)), tokens);
    assert.deepEqual(result, expected);
  } catch (error) {
    failures.push(`${id}: ${toErrorMessage(error).split("\n")[0]}`);
  }
}

function runPath(path: string): string[] {
  const sample = SAMPLES[path];
  const tokens = tokenize(path);
  const failures: string[] = [];
  const base = (leaf: unknown): Json => place(sample, tokens, leaf, "base");
  const over = (leaf: unknown): Json => place(sample, tokens, leaf, "overlay");
  const primitive = typeof sample.a !== "object";

  for (const layer of LAYERS) {
    const where = layer;
    expectArray(
      failures,
      `append in ${where}`,
      {
        root: base([sample.a]),
        layers: { [layer]: over(directive("append", [sample.b])) },
      },
      tokens,
      [sample.a, sample.b]
    );
    expectArray(
      failures,
      `plain replaces in ${where}`,
      { root: base([sample.a]), layers: { [layer]: over([sample.b]) } },
      tokens,
      [sample.b]
    );
    expectArray(
      failures,
      `no base in ${where}`,
      { layers: { [layer]: over(directive("append", [sample.b])) } },
      tokens,
      [sample.b]
    );
    if (layer !== "repo") {
      expectArray(
        failures,
        `no base then plain repo after ${where}`,
        {
          layers: {
            [layer]: over(directive("append", [sample.b])),
            repo: over([sample.c]),
          },
        },
        tokens,
        [sample.c]
      );
    }
    if (primitive) {
      expectArray(
        failures,
        `repeat dropped in ${where}`,
        {
          root: base([sample.a]),
          layers: { [layer]: over(directive("append", [sample.a])) },
        },
        tokens,
        [sample.a]
      );
    }
    for (const block of blockPaths.filter((p) => path.startsWith(`${p}.`))) {
      const blockToks = tokenize(block);
      const fresh = place(
        sample,
        blockToks,
        { inherit: false, ...sample.siblings?.[block] },
        "overlay"
      );
      expectArray(
        failures,
        `inherit false on ${block} in ${where}`,
        { root: base([sample.a]), layers: { [layer]: fresh } },
        tokens,
        undefined
      );
      const withValue = over([sample.b]);
      let cursor: Json = withValue;
      for (const t of blockToks)
        cursor = cursor[(t as { name: string }).name] as Json;
      cursor.inherit = false;
      expectArray(
        failures,
        `inherit false then values on ${block} in ${where}`,
        { root: base([sample.a]), layers: { [layer]: withValue } },
        tokens,
        [sample.b]
      );
    }
  }

  expectArray(
    failures,
    "root-only directive",
    { root: base(directive("append", [sample.a])) },
    tokens,
    [sample.a]
  );

  for (const layer of LAYERS) {
    const plainConfig = buildConfig({
      root: base([sample.a]),
      layers: { [layer]: over([sample.bad]) },
    });
    const directiveConfig = buildConfig({
      root: base([sample.a]),
      layers: { [layer]: over(directive("append", [sample.bad])) },
    });
    if (!schemaValidator(plainConfig) && schemaValidator(directiveConfig)) {
      failures.push(
        `bad item in ${layer}: the schema rejects a plain bad item but accepts it in a directive`
      );
    }
    let plainError: string | undefined;
    try {
      validateRawConfig(structuredClone(plainConfig) as unknown as RawConfig);
    } catch (error) {
      plainError = toErrorMessage(error);
    }
    if (plainError !== undefined) {
      try {
        validateRawConfig(
          structuredClone(directiveConfig) as unknown as RawConfig
        );
        failures.push(
          `bad item in ${layer}: validateRawConfig rejects a plain bad item but accepts it in a directive`
        );
      } catch (error) {
        const prefix = LAYER_ERROR_PREFIX[layer];
        if (
          !toErrorMessage(error).startsWith(prefix) ||
          !plainError.startsWith(prefix)
        ) {
          failures.push(
            `bad item in ${layer}: error does not name the layer ${prefix}`
          );
        }
      }
    }
  }

  if (path === "settings.environments.x.deploymentBranchPolicy.custom") {
    const custom = (extra: Json): Json =>
      buildConfig({
        layers: {
          group: {
            settings: {
              environments: {
                x: {
                  deploymentBranchPolicy: {
                    custom: { ...directive("merge", [sample.a]), ...extra },
                  },
                },
              },
            },
          },
        },
      });
    try {
      validateRawConfig(custom({}) as unknown as RawConfig);
      failures.push(
        "custom with merge and no $matchBy passes validateRawConfig"
      );
    } catch (error) {
      if (!/\$matchBy/.test(toErrorMessage(error))) {
        failures.push(
          `custom with merge and no $matchBy is rejected for another reason: ${toErrorMessage(error)}`
        );
      }
    }
    try {
      validateRawConfig(custom({ $matchBy: "name" }) as unknown as RawConfig);
    } catch (error) {
      failures.push(
        `custom with merge and $matchBy is rejected: ${toErrorMessage(error)}`
      );
    }
  }

  return failures;
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern.startsWith("**.")) return path.endsWith(pattern.slice(2));
  if (pattern.endsWith(".**")) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

describe("array merge coverage", () => {
  test("the root and repo settings schemas hold the same arrays", () => {
    assert.deepEqual(
      [...rootSettingsWalk.sites].sort(),
      [...repoSettingsWalk.sites].sort()
    );
  });

  test("every array in the schema is a layered path or excluded with a reason", () => {
    const all = walkFrom(schema, "").sites;
    const unclassified = [...all]
      .map((p) => p.replace(LAYER_PREFIX, ""))
      .filter((p) => !excluded(p) && !derivedPaths.includes(p));
    assert.deepEqual(
      unclassified,
      [],
      "add a SAMPLES entry, or an EXCLUDED entry with a reason"
    );
  });

  test("EXCLUDED holds no stale entries", () => {
    const all = [...walkFrom(schema, "").sites].map((p) =>
      p.replace(LAYER_PREFIX, "")
    );
    const stale = Object.keys(EXCLUDED).filter(
      (pattern) =>
        !pattern.endsWith(".**") && !all.some((p) => pathMatches(pattern, p))
    );
    assert.deepEqual(stale, []);
  });

  test("every layered path has a sample, and every sample a path", () => {
    assert.deepEqual(
      derivedPaths.filter((p) => !(p in SAMPLES)),
      []
    );
    assert.deepEqual(
      Object.keys(SAMPLES).filter((p) => !derivedPaths.includes(p)),
      []
    );
  });

  for (const path of derivedPaths.filter((p) => p in SAMPLES)) {
    test(`${path} accepts directives like every other layered array`, () => {
      const failures = runPath(path);
      if (EXPECTED_RED.has(path)) {
        assert.notEqual(
          failures.length,
          0,
          `${path} passes now: remove it from EXPECTED_RED`
        );
      } else {
        assert.deepEqual(failures, []);
      }
    });
  }
});

function keysOf(def: Json): string[] {
  return Object.keys(asNode(def.properties) ?? {})
    .filter((k) => k !== "inherit")
    .sort();
}

function ruleParameters(ruleType: string): Json {
  const rule = Object.values(defs).find((d) => {
    const type = asNode(asNode(d.properties)?.type);
    return (
      type?.const === ruleType ||
      (Array.isArray(type?.enum) && type.enum.includes(ruleType))
    );
  }) as Json;
  return asNode(asNode(rule.properties)?.parameters) as Json;
}

const T = true as const;

const TYPE_KEYS: Array<[string, Json, Record<string, true>]> = [
  [
    "ruleset",
    defs.ruleset,
    {
      target: T,
      enforcement: T,
      bypassActors: T,
      conditions: T,
      rules: T,
    } satisfies Record<keyof Ruleset, true>,
  ],
  [
    "prOptions",
    defs.prOptions,
    {
      merge: T,
      mergeStrategy: T,
      deleteBranch: T,
      bypassReason: T,
      labels: T,
      branch: T,
      ai: T,
    } satisfies Record<keyof PRMergeOptions, true>,
  ],
  [
    "actionsSettings",
    defs.actionsSettings,
    {
      enabled: T,
      allowedActions: T,
      shaPinningRequired: T,
      githubOwnedAllowed: T,
      verifiedAllowed: T,
      patternsAllowed: T,
      defaultWorkflowPermissions: T,
      canApprovePullRequestReviews: T,
      forkPrApprovalPolicy: T,
      artifactAndLogRetentionDays: T,
      cacheRetentionDays: T,
      cacheSizeGb: T,
    } satisfies Record<keyof ActionsSettings, true>,
  ],
  [
    "codeScanningSettings",
    defs.codeScanningSettings,
    {
      state: T,
      querySuite: T,
      languages: T,
    } satisfies Record<keyof CodeScanningSettings, true>,
  ],
  [
    "githubRepoSettings",
    defs.githubRepoSettings,
    {
      description: T,
      hasIssues: T,
      hasProjects: T,
      hasWiki: T,
      hasDiscussions: T,
      isTemplate: T,
      allowForking: T,
      visibility: T,
      archived: T,
      webCommitSignoffRequired: T,
      defaultBranch: T,
      allowSquashMerge: T,
      allowMergeCommit: T,
      allowRebaseMerge: T,
      allowAutoMerge: T,
      deleteBranchOnMerge: T,
      allowUpdateBranch: T,
      squashMergeCommitTitle: T,
      squashMergeCommitMessage: T,
      mergeCommitTitle: T,
      mergeCommitMessage: T,
      vulnerabilityAlerts: T,
      automatedSecurityFixes: T,
      secretScanning: T,
      secretScanningPushProtection: T,
      privateVulnerabilityReporting: T,
    } satisfies Record<keyof GitHubRepoSettings, true>,
  ],
  [
    "deploymentBranchPolicy",
    defs.deploymentBranchPolicy,
    {
      protectedBranches: T,
      custom: T,
      deleteOrphaned: T,
    } satisfies Record<keyof DeploymentBranchPolicy, true>,
  ],
  [
    "environmentConfig",
    defs.environmentConfig,
    {
      deploymentBranchPolicy: T,
      secrets: T,
    } satisfies Record<keyof EnvironmentConfig, true>,
  ],
  [
    "collaborators",
    asNode(asNode(defs.repoSettings.properties)?.collaborators) as Json,
    {
      users: T,
      deleteOrphaned: T,
    } satisfies Record<keyof CollaboratorsConfig, true>,
  ],
  [
    "repoSettings",
    defs.repoSettings,
    {
      rulesets: T,
      repo: T,
      labels: T,
      codeScanning: T,
      actions: T,
      variables: T,
      secrets: T,
      collaborators: T,
      environments: T,
      deleteOrphaned: T,
    } satisfies Record<keyof RepoSettings, true>,
  ],
  [
    "pull_request parameters",
    ruleParameters("pull_request"),
    {
      requiredApprovingReviewCount: T,
      dismissStaleReviewsOnPush: T,
      requireCodeOwnerReview: T,
      requireLastPushApproval: T,
      requiredReviewThreadResolution: T,
      allowedMergeMethods: T,
      requiredReviewers: T,
    } satisfies Record<keyof NonNullable<PullRequestRule["parameters"]>, true>,
  ],
  [
    "required_status_checks parameters",
    ruleParameters("required_status_checks"),
    {
      strictRequiredStatusChecksPolicy: T,
      doNotEnforceOnCreate: T,
      requiredStatusChecks: T,
    } satisfies Record<
      keyof NonNullable<RequiredStatusChecksRule["parameters"]>,
      true
    >,
  ],
  [
    "update parameters",
    ruleParameters("update"),
    {
      updateAllowsFetchAndMerge: T,
    } satisfies Record<keyof NonNullable<UpdateRule["parameters"]>, true>,
  ],
  [
    "required_deployments parameters",
    ruleParameters("required_deployments"),
    {
      requiredDeploymentEnvironments: T,
    } satisfies Record<
      keyof NonNullable<RequiredDeploymentsRule["parameters"]>,
      true
    >,
  ],
  [
    "code_scanning parameters",
    ruleParameters("code_scanning"),
    {
      codeScanningTools: T,
    } satisfies Record<keyof NonNullable<CodeScanningRule["parameters"]>, true>,
  ],
  [
    "code_quality parameters",
    ruleParameters("code_quality"),
    {
      severity: T,
    } satisfies Record<keyof NonNullable<CodeQualityRule["parameters"]>, true>,
  ],
  [
    "workflows parameters",
    ruleParameters("workflows"),
    {
      doNotEnforceOnCreate: T,
      workflows: T,
    } satisfies Record<keyof NonNullable<WorkflowsRule["parameters"]>, true>,
  ],
  [
    "pattern parameters",
    ruleParameters("branch_name_pattern"),
    {
      name: T,
      negate: T,
      operator: T,
      pattern: T,
    } satisfies Record<keyof BranchNamePatternRule["parameters"], true>,
  ],
  [
    "file_path_restriction parameters",
    ruleParameters("file_path_restriction"),
    {
      restrictedFilePaths: T,
    } satisfies Record<
      keyof NonNullable<FilePathRestrictionRule["parameters"]>,
      true
    >,
  ],
  [
    "file_extension_restriction parameters",
    ruleParameters("file_extension_restriction"),
    {
      restrictedFileExtensions: T,
    } satisfies Record<
      keyof NonNullable<FileExtensionRestrictionRule["parameters"]>,
      true
    >,
  ],
  [
    "max_file_path_length parameters",
    ruleParameters("max_file_path_length"),
    {
      maxFilePathLength: T,
    } satisfies Record<
      keyof NonNullable<MaxFilePathLengthRule["parameters"]>,
      true
    >,
  ],
  [
    "max_file_size parameters",
    ruleParameters("max_file_size"),
    {
      maxFileSize: T,
    } satisfies Record<keyof NonNullable<MaxFileSizeRule["parameters"]>, true>,
  ],
];

describe("schema properties match the TypeScript types", () => {
  for (const [name, def, table] of TYPE_KEYS) {
    test(name, () => {
      assert.deepEqual(keysOf(def), Object.keys(table).sort());
    });
  }
});
