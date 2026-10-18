import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { docFiles, repoRoot } from "../../../scripts/docs/generate-docs.js";
import {
  loadRawConfig,
  normalizeConfig,
  validateForSync,
  validateNormalizedConfig,
  validateSecretsConfig,
} from "../../../src/config/index.js";
import type { RawConfig } from "../../../src/config/index.js";
import { parseGitUrl } from "../../../src/repo/index.js";
import { toErrorMessage } from "../../../src/shared/type-guards.js";

const MARKER = "<!-- docs-example: skip -->";
const FENCE_OPEN = /^(\s*)(`{3,})\s*(\S*)/;
const FENCE_CLOSE = /^\s*(`{3,})\s*$/;
const FILE_REFERENCE =
  /(?:content|prTemplate):\s*["']?@(templates\/[^\s"'#]+)/g;

const anyEnv = new Proxy({} as Record<string, string | undefined>, {
  get: (_target, name) => (typeof name === "string" ? "dummy" : undefined),
});

interface Example {
  line: number;
  yaml: string;
  skipped: boolean;
}

interface Scan {
  examples: Example[];
  strayMarkers: number[];
}

function scanMarkdown(markdown: string): Scan {
  const lines = markdown.split("\n");
  const examples: Example[] = [];
  const strayMarkers: number[] = [];
  let marker: number | undefined;

  const dropMarker = (): void => {
    if (marker !== undefined) strayMarkers.push(marker);
    marker = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (open) {
      const [, indent, fence, lang] = open;
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const close = FENCE_CLOSE.exec(lines[i]);
        if (close && close[1].length >= fence.length) break;
        body.push(
          lines[i].startsWith(indent)
            ? lines[i].slice(indent.length)
            : lines[i].trimStart()
        );
      }
      const yaml = body.join("\n");
      const isExample = /^ya?ml$/.test(lang) && /^repos:/m.test(yaml);
      if (isExample) {
        examples.push({
          line: i - body.length,
          yaml,
          skipped: marker !== undefined,
        });
        marker = undefined;
      } else {
        dropMarker();
      }
    } else if (lines[i].trim() === MARKER) {
      dropMarker();
      marker = i + 1;
    } else if (lines[i].trim() !== "") {
      dropMarker();
    }
  }
  dropMarker();

  return { examples, strayMarkers };
}

function stubFileReferences(yaml: string, dir: string): void {
  for (const [, reference] of yaml.matchAll(FILE_REFERENCE)) {
    const path = join(dir, reference);
    // Escaping references stay missing so the loader reports them.
    if (relative(dir, path).startsWith("..")) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stubContent(reference));
  }
}

function stubContent(reference: string): string {
  switch (extname(reference).toLowerCase()) {
    case ".json":
    case ".json5":
      return "{}\n";
    case ".yaml":
    case ".yml":
      return "a: 1\n";
    default:
      return "stub\n";
  }
}

function isSecretsOnly(raw: RawConfig): boolean {
  const layers = [
    raw,
    ...Object.values(raw.groups ?? {}),
    ...(raw.conditionalGroups ?? []),
    ...raw.repos,
  ];
  const hasSecrets = layers.some((layer) => layer.settings?.secrets);
  const hasOther = layers.some(
    (layer) =>
      Object.keys(layer.files ?? {}).length > 0 ||
      Object.keys(layer.settings ?? {}).some((key) => key !== "secrets")
  );
  return hasSecrets && !hasOther;
}

function loadExample(yaml: string): void {
  const dir = mkdtempSync(join(tmpdir(), "xfg-doc-example-"));
  try {
    stubFileReferences(yaml, dir);
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, yaml);
    const raw = loadRawConfig(configPath);
    if (isSecretsOnly(raw)) {
      validateSecretsConfig(raw);
    } else {
      validateForSync(raw);
    }
    const config = normalizeConfig(raw, anyEnv);
    validateNormalizedConfig(config);
    for (const repo of config.repos) {
      parseGitUrl(repo.git, { githubHosts: config.githubHosts });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scanMarkdown", () => {
  test("finds yaml and yml blocks with a top-level repos key", () => {
    const { examples } = scanMarkdown(
      [
        "intro",
        "```yaml",
        "id: a",
        "repos:",
        "  - git: x",
        "```",
        "```yml",
        "repos: []",
        "```",
      ].join("\n")
    );
    assert.deepEqual(
      examples.map(({ line, skipped }) => ({ line, skipped })),
      [
        { line: 2, skipped: false },
        { line: 7, skipped: false },
      ]
    );
    assert.equal(examples[0].yaml, "id: a\nrepos:\n  - git: x");
  });

  test("ignores blocks that are not yaml with a top-level repos key", () => {
    const { examples } = scanMarkdown(
      [
        "```yaml",
        "files:",
        "  repos:",
        "    - x",
        "```",
        "```json",
        "repos:",
        "```",
        "```",
        "repos:",
        "```",
      ].join("\n")
    );
    assert.deepEqual(examples, []);
  });

  test("dedents a block fenced inside an indented admonition", () => {
    const { examples } = scanMarkdown(
      [
        '!!! note "Title"',
        "    prose",
        "",
        "    ```yaml",
        "    repos:",
        "      - git: x",
        "    ```",
      ].join("\n")
    );
    assert.equal(examples[0].line, 4);
    assert.equal(examples[0].yaml, "repos:\n  - git: x");
  });

  test("keeps a shorter fence inside a longer one as content", () => {
    const { examples } = scanMarkdown(
      [
        "````yaml",
        "repos:",
        "  - git: x",
        "    files:",
        "      ```bash",
        "      echo hi",
        "      ```",
        "````",
        "```yaml",
        "repos: []",
        "```",
      ].join("\n")
    );
    assert.deepEqual(
      examples.map(({ line }) => line),
      [1, 9]
    );
    assert.match(examples[0].yaml, /echo hi/);
  });

  test("skips only the block that directly follows a marker", () => {
    const { examples, strayMarkers } = scanMarkdown(
      [
        MARKER,
        "```yaml",
        "repos: []",
        "```",
        "",
        "```yaml",
        "repos: []",
        "```",
        MARKER,
        "",
        "",
        "```yml",
        "repos: []",
        "```",
      ].join("\n")
    );
    assert.deepEqual(
      examples.map(({ skipped }) => skipped),
      [true, false, true]
    );
    assert.deepEqual(strayMarkers, []);
  });

  test("reports a marker that is not followed by a yaml config block", () => {
    const { examples, strayMarkers } = scanMarkdown(
      [
        MARKER,
        "prose in between",
        "```yaml",
        "repos: []",
        "```",
        MARKER,
        "```bash",
        "echo hi",
        "```",
        MARKER,
        "```yaml",
        "files: {}",
        "```",
        MARKER,
        MARKER,
        "```yaml",
        "repos: []",
        "```",
        MARKER,
      ].join("\n")
    );
    assert.deepEqual(strayMarkers, [1, 6, 10, 14, 19]);
    assert.deepEqual(
      examples.map(({ skipped }) => skipped),
      [false, true]
    );
  });

  test("does not read a marker shown inside a code block", () => {
    const { strayMarkers } = scanMarkdown(
      ["```markdown", MARKER, "```"].join("\n")
    );
    assert.deepEqual(strayMarkers, []);
  });
});

describe("loadExample", () => {
  const valid = [
    "id: demo",
    "files:",
    "  .prettierrc.json:",
    '    content: "@templates/prettierrc.json"',
    "  config.yaml:",
    '    content: "@templates/nested/config.yaml"',
    "  NOTES.md:",
    '    content: "@templates/notes.md"',
    "  settings.json:",
    "    content:",
    '      token: "${ANY_VARIABLE_NAME}"',
    "repos:",
    "  - git: git@github.com:org/repo.git",
  ].join("\n");

  test("loads a config with file references and env variables", () => {
    loadExample(valid);
  });

  test("loads a secrets-only config as a secrets sync config", () => {
    loadExample(
      [
        "id: demo",
        "settings:",
        "  secrets:",
        "    API_TOKEN:",
        "      env: API_TOKEN_VALUE",
        "repos:",
        "  - git: git@github.com:org/repo.git",
      ].join("\n")
    );
  });

  test("rejects a config the sync pipeline rejects", () => {
    assert.throws(
      () => loadExample(valid.replace("id: demo\n", "")),
      /requires an 'id' field/
    );
  });

  test("rejects a secrets-only config the secrets pipeline rejects", () => {
    assert.throws(
      () =>
        loadExample(
          [
            "id: demo",
            "settings:",
            "  secrets:",
            "    API_TOKEN:",
            "      env: GH_TOKEN",
            "repos:",
            "  - git: git@github.com:org/repo.git",
          ].join("\n")
        ),
      /credential xfg uses/
    );
  });

  test("does not stub an @ value that is not a templates/ reference", () => {
    assert.throws(
      () =>
        loadExample(
          [
            "id: demo",
            "files:",
            "  .npmrc:",
            '    content: "@myorg:registry=https://npm.pkg.github.com"',
            "repos:",
            "  - git: git@github.com:org/repo.git",
          ].join("\n")
        ),
      /ENOENT/
    );
  });

  test("rejects a repo URL the sync pipeline cannot parse", () => {
    assert.throws(
      () =>
        loadExample(
          [
            "id: demo",
            "files:",
            "  a.txt:",
            "    content: hi",
            "repos:",
            "  - git: github.com/org/repo",
          ].join("\n")
        ),
      /Unrecognized git URL format/
    );
  });

  test("reports a file reference that escapes the config directory", () => {
    assert.throws(
      () =>
        loadExample(
          [
            "id: demo",
            "files:",
            "  a.json:",
            '    content: "@../outside.json"',
            "repos:",
            "  - git: git@github.com:org/repo.git",
          ].join("\n")
        ),
      /escapes config directory/
    );
  });
});

describe("docs config examples", () => {
  const strayMarkers: string[] = [];
  let exampleCount = 0;

  for (const file of docFiles()) {
    const name = relative(repoRoot, file);
    const scan = scanMarkdown(readFileSync(file, "utf-8"));
    strayMarkers.push(...scan.strayMarkers.map((line) => `${name}:${line}`));
    exampleCount += scan.examples.length;

    for (const example of scan.examples) {
      const where = `${name}:${example.line}`;
      if (example.skipped) {
        test(`${where} (skipped) does not load`, () => {
          assert.throws(
            () => loadExample(example.yaml),
            Error,
            `${where} loads through the config pipeline: remove the ${MARKER} marker above it`
          );
        });
        continue;
      }
      test(where, () => {
        try {
          loadExample(example.yaml);
        } catch (error) {
          assert.fail(
            `${where} does not load through the config pipeline: ${toErrorMessage(error)}`
          );
        }
      });
    }
  }

  test("docs contain at least one config example", () => {
    assert.ok(exampleCount > 0, "expected yaml blocks with repos: in docs/");
  });

  test("every skip marker is followed by a yaml config example", () => {
    assert.deepEqual(
      strayMarkers,
      [],
      `${MARKER} must directly precede a yaml block with a top-level repos key: ${strayMarkers.join(", ")}`
    );
  });
});
