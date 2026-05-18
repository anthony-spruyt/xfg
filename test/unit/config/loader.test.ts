import { describe, test, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRawConfig, loadConfig } from "../../../src/config/loader.js";
import { ValidationError } from "../../../src/shared/errors.js";

const MINIMAL_CONFIG_YAML = `id: test-config
files:
  .gitkeep:
    content: ""
repos:
  - git: git@github.com:owner/repo.git
`;

describe("loadRawConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("statSync failure", () => {
    test("throws ValidationError when path does not exist", () => {
      const nonExistentPath = join(tempDir, "does-not-exist.yaml");

      assert.throws(
        () => loadRawConfig(nonExistentPath),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("Failed to read config at"),
            `Expected 'Failed to read config at' in message, got: ${err.message}`
          );
          assert.ok(
            err.message.includes(nonExistentPath),
            `Expected path in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("ValidationError from missing path has a cause", () => {
      const nonExistentPath = join(tempDir, "no-such-file.yaml");

      assert.throws(
        () => loadRawConfig(nonExistentPath),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            (err as ValidationError).cause instanceof Error,
            "Expected cause to be an Error instance"
          );
          return true;
        }
      );
    });
  });

  describe("single-file loading", () => {
    test("happy path: returns parsed RawConfig from a valid YAML file", () => {
      const configFile = join(tempDir, "config.yaml");
      writeFileSync(configFile, MINIMAL_CONFIG_YAML);

      const result = loadRawConfig(configFile);

      assert.equal(result.id, "test-config");
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo.git");
    });

    test("throws ValidationError when YAML file has invalid syntax", () => {
      const configFile = join(tempDir, "bad.yaml");
      writeFileSync(
        configFile,
        "id: test\n  invalid_indent: [\nbroken yaml here:"
      );

      assert.throws(
        () => loadRawConfig(configFile),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("Failed to parse YAML config at"),
            `Expected 'Failed to parse YAML config at' in message, got: ${err.message}`
          );
          assert.ok(
            err.message.includes(configFile),
            `Expected file path in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("YAML parse ValidationError has a cause", () => {
      const configFile = join(tempDir, "bad.yaml");
      writeFileSync(configFile, "key: [unclosed bracket\n  another: value");

      assert.throws(
        () => loadRawConfig(configFile),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            (err as ValidationError).cause instanceof Error,
            "Expected cause to be an Error"
          );
          return true;
        }
      );
    });
    test("throws ValidationError when file exists but cannot be read (permission denied)", () => {
      const configFile = join(tempDir, "unreadable.yaml");
      writeFileSync(configFile, MINIMAL_CONFIG_YAML);
      chmodSync(configFile, 0o000);

      assert.throws(
        () => loadRawConfig(configFile),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            err.message.includes("Failed to read config file"),
            `Expected 'Failed to read config file', got: ${err.message}`
          );
          return true;
        }
      );

      chmodSync(configFile, 0o644);
    });
  });

  describe("directory loading", () => {
    test("happy path: merges multiple YAML fragments into a single RawConfig", () => {
      const configDir = join(tempDir, "config-dir");
      mkdirSync(configDir);
      writeFileSync(
        join(configDir, "01-base.yaml"),
        `id: multi-config\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "02-repos.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-a.git\n  - git: git@github.com:owner/repo-b.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "multi-config");
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo-a.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/repo-b.git");
    });

    test("throws ValidationError when directory cannot be read (permission denied)", () => {
      const configDir = join(tempDir, "no-read-dir");
      mkdirSync(configDir);
      writeFileSync(join(configDir, "config.yaml"), MINIMAL_CONFIG_YAML);
      chmodSync(configDir, 0o000);

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            err.message.includes("Failed to read config directory"),
            `Expected 'Failed to read config directory', got: ${err.message}`
          );
          return true;
        }
      );

      chmodSync(configDir, 0o755);
    });

    test("throws ValidationError when a fragment file cannot be read (permission denied)", () => {
      const configDir = join(tempDir, "partial-read-dir");
      mkdirSync(configDir);
      writeFileSync(
        join(configDir, "01-base.yaml"),
        `id: test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      const unreadable = join(configDir, "02-repos.yaml");
      writeFileSync(
        unreadable,
        `repos:\n  - git: git@github.com:owner/repo.git\n`
      );
      chmodSync(unreadable, 0o000);

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            err.message.includes("Failed to read config file"),
            `Expected 'Failed to read config file', got: ${err.message}`
          );
          assert.ok(
            err.message.includes("02-repos.yaml"),
            `Expected filename in message, got: ${err.message}`
          );
          return true;
        }
      );

      chmodSync(unreadable, 0o644);
    });

    test("throws ValidationError when directory contains no YAML files", () => {
      const emptyDir = join(tempDir, "empty-dir");
      mkdirSync(emptyDir);
      // Add a non-YAML file to ensure the filter is working, not just empty dir
      writeFileSync(join(emptyDir, "readme.txt"), "not yaml");

      assert.throws(
        () => loadRawConfig(emptyDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("No .yaml or .yml files found in directory"),
            `Expected 'No .yaml or .yml files found in directory' in message, got: ${err.message}`
          );
          assert.ok(
            err.message.includes(emptyDir),
            `Expected dir path in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("throws ValidationError when a directory fragment has invalid YAML syntax", () => {
      const configDir = join(tempDir, "bad-fragment-dir");
      mkdirSync(configDir);
      writeFileSync(join(configDir, "01-base.yaml"), `id: test-config\n`);
      writeFileSync(
        join(configDir, "02-bad.yaml"),
        "repos:\n  - broken: [unclosed\n  garbage:"
      );

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("Failed to parse YAML config at"),
            `Expected 'Failed to parse YAML config at' in message, got: ${err.message}`
          );
          assert.ok(
            err.message.includes("02-bad.yaml"),
            `Expected fragment filename in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("YAML parse error in fragment has a cause", () => {
      const configDir = join(tempDir, "cause-dir");
      mkdirSync(configDir);
      writeFileSync(join(configDir, "fragment.yaml"), "key: [unclosed bracket");

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            (err as ValidationError).cause instanceof Error,
            "Expected cause to be an Error"
          );
          return true;
        }
      );
    });

    test("throws ValidationError when a directory fragment is empty (null YAML)", () => {
      const configDir = join(tempDir, "empty-fragment-dir");
      mkdirSync(configDir);
      // An empty YAML file parses to null, which is not an object
      writeFileSync(join(configDir, "empty.yaml"), "");

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("empty or invalid"),
            `Expected 'empty or invalid' in message, got: ${err.message}`
          );
          assert.ok(
            err.message.includes("empty.yaml"),
            `Expected fragment filename in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("throws ValidationError when a directory fragment is a scalar (not a mapping)", () => {
      const configDir = join(tempDir, "scalar-fragment-dir");
      mkdirSync(configDir);
      // A YAML file with only a scalar value parses to a string/number, not an object
      writeFileSync(join(configDir, "scalar.yaml"), "just a string value\n");

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("empty or invalid"),
            `Expected 'empty or invalid' in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("flat directory: recursive scan produces same results as before", () => {
      const configDir = join(tempDir, "flat-recursive");
      mkdirSync(configDir);
      writeFileSync(
        join(configDir, "01-base.yaml"),
        `id: flat-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "02-repos.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-a.git\n  - git: git@github.com:owner/repo-b.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "flat-test");
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo-a.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/repo-b.git");
    });

    test("recursive: discovers nested YAML files in depth-first alphabetical order", () => {
      const configDir = join(tempDir, "recursive-order");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "infra"));
      mkdirSync(join(configDir, "teams"));
      mkdirSync(join(configDir, "teams", "beta"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: recursive-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "shared.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-1.git\n`
      );
      writeFileSync(
        join(configDir, "infra", "shared.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-2.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "alpha.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-3.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "beta.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-4.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "beta", "overrides.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-5.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "recursive-test");
      assert.equal(result.repos.length, 5);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo-1.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/repo-2.git");
      assert.equal(result.repos[2].git, "git@github.com:owner/repo-3.git");
      assert.equal(result.repos[3].git, "git@github.com:owner/repo-4.git");
      assert.equal(result.repos[4].git, "git@github.com:owner/repo-5.git");
    });

    test("throws ValidationError when directory nesting exceeds maximum depth", () => {
      const configDir = join(tempDir, "deep-nest");
      mkdirSync(configDir);

      let current = configDir;
      for (let i = 0; i < 12; i++) {
        current = join(current, `level-${i}`);
        mkdirSync(current);
      }
      writeFileSync(
        join(configDir, "base.yaml"),
        `id: deep-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(current, "deep.yaml"),
        `repos:\n  - git: git@github.com:owner/deep.git\n`
      );

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("exceeds maximum depth of 10"),
            `Expected depth error, got: ${err.message}`
          );
          assert.ok(
            err.message.includes("level-10"),
            `Expected relative path in error, got: ${err.message}`
          );
          return true;
        }
      );
    });

    test("skips hidden files and directories (names starting with dot)", () => {
      const configDir = join(tempDir, "hidden-test");
      mkdirSync(configDir);
      mkdirSync(join(configDir, ".git"));
      mkdirSync(join(configDir, "visible"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: hidden-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "visible", "repos.yaml"),
        `repos:\n  - git: git@github.com:owner/visible.git\n`
      );
      writeFileSync(
        join(configDir, ".hidden.yaml"),
        `repos:\n  - git: git@github.com:owner/hidden-file.git\n`
      );
      writeFileSync(
        join(configDir, ".git", "config.yaml"),
        `repos:\n  - git: git@github.com:owner/hidden-dir.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "hidden-test");
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:owner/visible.git");
    });

    test("empty subdirectories and subdirs with no YAML files are skipped without error", () => {
      const configDir = join(tempDir, "empty-subdirs");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "empty"));
      mkdirSync(join(configDir, "no-yaml"));
      mkdirSync(join(configDir, "has-yaml"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: empty-sub-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(join(configDir, "no-yaml", "readme.txt"), "not yaml");
      writeFileSync(
        join(configDir, "has-yaml", "extra.yaml"),
        `repos:\n  - git: git@github.com:owner/from-subdir.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "empty-sub-test");
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/from-subdir.git");
    });

    test("skips symlinked directories", () => {
      const configDir = join(tempDir, "symlink-dir-test");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "real-subdir"));
      const realDir = join(tempDir, "real-target");
      mkdirSync(realDir);

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: symlink-dir-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(configDir, "real-subdir", "extra.yaml"),
        `repos:\n  - git: git@github.com:owner/from-real-subdir.git\n`
      );
      writeFileSync(
        join(realDir, "extra.yaml"),
        `repos:\n  - git: git@github.com:owner/symlinked.git\n`
      );
      symlinkSync(realDir, join(configDir, "linked-dir"));

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "symlink-dir-test");
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo.git");
      assert.equal(
        result.repos[1].git,
        "git@github.com:owner/from-real-subdir.git"
      );
    });

    test("follows symlinked YAML files via isSymbolicLink fallback", () => {
      const configDir = join(tempDir, "symlink-file-test");
      mkdirSync(configDir);

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: symlink-file-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      const realFile = join(tempDir, "real-repos.yaml");
      writeFileSync(
        realFile,
        `repos:\n  - git: git@github.com:owner/symlinked-file.git\n`
      );
      symlinkSync(realFile, join(configDir, "linked.yaml"));

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "symlink-file-test");
      assert.equal(result.repos.length, 1);
      assert.equal(
        result.repos[0].git,
        "git@github.com:owner/symlinked-file.git"
      );
    });

    test("discovers .yml files alongside .yaml files", () => {
      const configDir = join(tempDir, "yml-extension-test");
      mkdirSync(configDir);

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: yml-ext-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "extra.yml"),
        `repos:\n  - git: git@github.com:owner/yml-repo.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "yml-ext-test");
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:owner/yml-repo.git");
    });

    test("file references in nested fragments resolve relative to fragment directory", () => {
      const configDir = join(tempDir, "fileref-test");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "teams"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: fileref-test\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "fragment.yaml"),
        `files:\n  config.json:\n    content: "@config-data.json"\n`
      );
      writeFileSync(
        join(configDir, "teams", "config-data.json"),
        `{"key": "value"}`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "fileref-test");
      assert.ok(result.files);
      assert.deepEqual(result.files["config.json"].content, { key: "value" });
    });

    test("throws ValidationError when a subdirectory cannot be read (permission denied)", () => {
      const configDir = join(tempDir, "unreadable-subdir");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "blocked"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: unreadable-sub-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(configDir, "blocked", "fragment.yaml"),
        `repos:\n  - git: git@github.com:owner/blocked.git\n`
      );
      chmodSync(join(configDir, "blocked"), 0o000);

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("Failed to read config directory"),
            `Expected 'Failed to read config directory', got: ${err.message}`
          );
          assert.ok(
            err.message.includes("blocked"),
            `Expected relative path 'blocked' in error, got: ${err.message}`
          );
          return true;
        }
      );

      chmodSync(join(configDir, "blocked"), 0o755);
    });
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loader-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("happy path: loads, validates, and normalizes a valid config file", () => {
    const configFile = join(tempDir, "config.yaml");
    writeFileSync(configFile, MINIMAL_CONFIG_YAML);

    const result = loadConfig(configFile, { HOME: "/home/user" });

    assert.equal(result.id, "test-config");
    assert.ok(Array.isArray(result.repos), "Expected repos to be an array");
    assert.equal(result.repos.length, 1);
  });

  test("propagates ValidationError from loadRawConfig for non-existent path", () => {
    const nonExistentPath = join(tempDir, "no-such-file.yaml");

    assert.throws(
      () => loadConfig(nonExistentPath, {}),
      (err: unknown) => {
        assert.ok(
          err instanceof ValidationError,
          `Expected ValidationError, got ${String(err)}`
        );
        assert.ok(
          err.message.includes("Failed to read config at"),
          `Expected 'Failed to read config at' in message, got: ${err.message}`
        );
        return true;
      }
    );
  });
});
