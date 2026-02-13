import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoLifecycleManager } from "../../../src/lifecycle/repo-lifecycle-manager.js";
import type {
  IRepoLifecycleFactory,
  IRepoLifecycleProvider,
  IMigrationSource,
} from "../../../src/lifecycle/types.js";
import type { RepoConfig } from "../../../src/config/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("RepoLifecycleManager", () => {
  const testDir = join(tmpdir(), `lifecycle-manager-test-${Date.now()}`);
  let workDir: string;

  const mockGitHubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockFactory(options: {
    exists?: boolean;
    createCalled?: () => void;
    forkCalled?: () => void;
    migrateCalled?: () => void;
    cloneCalled?: () => void;
  }): IRepoLifecycleFactory {
    // Track whether a lifecycle operation has been performed so
    // waitForRepoReady() sees the repo as ready immediately.
    let repoCreated = false;

    const provider: IRepoLifecycleProvider = {
      platform: "github",
      async exists() {
        return repoCreated || (options.exists ?? false);
      },
      async create() {
        options.createCalled?.();
        repoCreated = true;
      },
      async fork() {
        options.forkCalled?.();
        repoCreated = true;
      },
      async receiveMigration() {
        options.migrateCalled?.();
        repoCreated = true;
      },
    };

    const source: IMigrationSource = {
      platform: "azure-devops",
      async cloneForMigration(_repoInfo, cloneDir) {
        // Create the directory to simulate clone
        mkdirSync(cloneDir, { recursive: true });
        options.cloneCalled?.();
      },
    };

    return {
      getProvider: () => provider,
      getMigrationSource: () => source,
    };
  }

  describe("ensureRepo()", () => {
    test("returns existed when repo exists", async () => {
      const factory = createMockFactory({ exists: true });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "existed");
    });

    test("creates repo when missing and no upstream/source", async () => {
      let createCalled = false;
      const factory = createMockFactory({
        exists: false,
        createCalled: () => {
          createCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "created");
      assert.equal(createCalled, true);
    });

    test("forks when upstream present and missing", async () => {
      let forkCalled = false;
      const factory = createMockFactory({
        exists: false,
        forkCalled: () => {
          forkCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "forked");
      assert.equal(forkCalled, true);
    });

    test("migrates when source present and missing", async () => {
      let migrateCalled = false;
      let cloneCalled = false;
      const factory = createMockFactory({
        exists: false,
        migrateCalled: () => {
          migrateCalled = true;
        },
        cloneCalled: () => {
          cloneCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "migrated");
      assert.equal(cloneCalled, true);
      assert.equal(migrateCalled, true);
    });

    test("cleans up migration source directory after success", async () => {
      const factory = createMockFactory({
        exists: false,
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      // Migration source dir should be cleaned up
      const sourceDir = join(workDir, "migration-source");
      assert.equal(existsSync(sourceDir), false);
    });

    test("skips action in dry-run mode", async () => {
      let createCalled = false;
      const factory = createMockFactory({
        exists: false,
        createCalled: () => {
          createCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: true,
        workDir,
      });

      assert.equal(result.action, "created");
      assert.equal(result.skipped, true);
      assert.equal(createCalled, false);
    });

    test("ignores upstream when repo exists", async () => {
      let forkCalled = false;
      const factory = createMockFactory({
        exists: true,
        forkCalled: () => {
          forkCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: false,
        workDir,
      });

      assert.equal(result.action, "existed");
      assert.equal(forkCalled, false);
    });

    test("dry-run fork returns skipped", async () => {
      const factory = createMockFactory({ exists: false });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: true,
        workDir,
      });

      assert.equal(result.action, "forked");
      assert.equal(result.skipped, true);
    });

    test("dry-run migrate returns skipped", async () => {
      const factory = createMockFactory({ exists: false });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      const result = await manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
        dryRun: true,
        workDir,
      });

      assert.equal(result.action, "migrated");
      assert.equal(result.skipped, true);
    });

    test("passes settings to create", async () => {
      let createCalled = false;
      const factory = createMockFactory({
        exists: false,
        createCalled: () => {
          createCalled = true;
        },
      });
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
      };

      await manager.ensureRepo(
        repoConfig,
        mockGitHubRepoInfo,
        { dryRun: false, workDir },
        { visibility: "private" }
      );

      assert.equal(createCalled, true);
    });

    test("throws when platform does not support forking", async () => {
      const provider = {
        platform: "github" as const,
        async exists() {
          return false;
        },
        async create() {},
        // fork is undefined
        async receiveMigration() {},
      };

      const factory = {
        getProvider: () => provider,
        getMigrationSource: () => ({
          platform: "azure-devops" as const,
          async cloneForMigration() {},
        }),
      };

      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        upstream: "git@github.com:opensource/tool.git",
      };

      await assert.rejects(
        () =>
          manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
            dryRun: false,
            workDir,
          }),
        /does not support forking/
      );
    });

    test("cleans up migration source on error", async () => {
      const provider = {
        platform: "github" as const,
        async exists() {
          return false;
        },
        async create() {},
        async fork() {},
        async receiveMigration() {
          throw new Error("Push failed");
        },
      };

      const source = {
        platform: "azure-devops" as const,
        async cloneForMigration(_repoInfo: unknown, cloneDir: string) {
          mkdirSync(cloneDir, { recursive: true });
        },
      };

      const factory = {
        getProvider: () => provider,
        getMigrationSource: () => source,
      };

      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "https://dev.azure.com/myorg/myproject/_git/myrepo",
      };

      await assert.rejects(
        () =>
          manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
            dryRun: false,
            workDir,
          }),
        /Push failed/
      );

      // Migration source dir should still be cleaned up even on error
      const sourceDir = join(workDir, "migration-source");
      assert.equal(existsSync(sourceDir), false);
    });

    test("returns existed for unsupported platform without lifecycle fields", async () => {
      const factory: IRepoLifecycleFactory = {
        getProvider() {
          throw new Error("Platform not supported");
        },
        getMigrationSource() {
          throw new Error("Platform not supported");
        },
      };
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: "https://dev.azure.com/org/project/_git/repo",
        files: [],
      };

      const adoRepoInfo = {
        type: "azure-devops" as const,
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        org: "org",
        project: "project",
        repo: "repo",
      };

      const result = await manager.ensureRepo(
        repoConfig,
        adoRepoInfo as never,
        { dryRun: false, workDir }
      );

      assert.equal(result.action, "existed");
    });

    test("throws for unsupported migration source (e.g., GitHub-to-GitHub)", async () => {
      const factory: IRepoLifecycleFactory = {
        getProvider: () => ({
          platform: "github" as const,
          async exists() {
            return false;
          },
          async create() {},
          async fork() {},
          async receiveMigration() {},
        }),
        getMigrationSource(platform) {
          throw new Error(
            `Platform '${platform}' not supported as migration source. ` +
              `Currently supported: azure-devops`
          );
        },
      };
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: mockGitHubRepoInfo.gitUrl,
        files: [],
        source: "git@github.com:other-org/source-repo.git",
      };

      await assert.rejects(
        () =>
          manager.ensureRepo(repoConfig, mockGitHubRepoInfo, {
            dryRun: false,
            workDir,
          }),
        /not supported as migration source.*Currently supported: azure-devops/
      );
    });

    test("throws for unsupported platform when upstream is set", async () => {
      const factory: IRepoLifecycleFactory = {
        getProvider() {
          throw new Error("Platform not supported as target");
        },
        getMigrationSource() {
          throw new Error("Platform not supported");
        },
      };
      const manager = new RepoLifecycleManager(factory);

      const repoConfig: RepoConfig = {
        git: "https://dev.azure.com/org/project/_git/repo",
        files: [],
        upstream: "https://dev.azure.com/org/project/_git/other",
      };

      const adoRepoInfo = {
        type: "azure-devops" as const,
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        org: "org",
        project: "project",
        repo: "repo",
      };

      await assert.rejects(
        () =>
          manager.ensureRepo(repoConfig, adoRepoInfo as never, {
            dryRun: false,
            workDir,
          }),
        /Platform not supported as target/
      );
    });
  });
});
