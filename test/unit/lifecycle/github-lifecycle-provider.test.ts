import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../src/repo/index.js";

describe("GitHubLifecycleProvider", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
  };

  describe("exists()", () => {
    test("returns true when repo exists", async () => {
      const { mock: executor } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      const result = await provider.exists({ repo: mockRepoInfo });

      assert.equal(result, true);
    });

    test("returns false when repo does not exist (404)", async () => {
      const notFoundError = new Error("Could not resolve to a Repository");
      (notFoundError as Error & { stderr?: string }).stderr =
        "gh: Could not resolve to a Repository";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      const result = await provider.exists({ repo: mockRepoInfo });

      assert.equal(result, false);
    });

    test("throws on network/auth error (not repo-not-found)", async () => {
      const networkError = new Error("Network timeout");
      (networkError as Error & { stderr?: string }).stderr = "Network timeout";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", networkError]]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.exists({ repo: mockRepoInfo }),
        /Network/
      );
    });

    test("uses correct gh api command", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      await provider.exists({ repo: mockRepoInfo });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].executable, "gh");
      assert.ok(calls[0].args.includes("api"));
      assert.ok(calls[0].args.includes("repos/test-org/test-repo"));
    });

    test("rejects non-GitHub repo", async () => {
      const adoRepo: AzureDevOpsRepoInfo = {
        type: "azure-devops",
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.exists({ repo: adoRepo }),
        /requires GitHub repo/
      );
    });

    test("returns false for Not Found pattern", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as Error & { stderr?: string }).stderr = "";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      const result = await provider.exists({ repo: mockRepoInfo });

      assert.equal(result, false);
    });

    test("returns false for 404 pattern", async () => {
      const notFoundError = new Error("HTTP 404");
      (notFoundError as Error & { stderr?: string }).stderr = "";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      const result = await provider.exists({ repo: mockRepoInfo });

      assert.equal(result, false);
    });

    test("does not include --hostname for github.com", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      await provider.exists({ repo: mockRepoInfo });

      assert.ok(!calls[0].args.includes("--hostname"));
    });

    test("handles GHE hostname", async () => {
      const gheRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.mycompany.com:test-org/test-repo.git",
        owner: "test-org",
        repo: "test-repo",
        host: "github.mycompany.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      await provider.exists({ repo: gheRepoInfo });

      assert.equal(calls.length, 1);
      assert.ok(calls[0].args.includes("--hostname"));
      assert.ok(calls[0].args.includes("github.mycompany.com"));
    });
  });

  describe("create()", () => {
    test("creates repo with gh repo create --add-readme and deletes README", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([["contents/README.md --jq", "abc123def"]]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({ repo: mockRepoInfo });

      // calls[0] = gh repo create, calls[1] = GET README sha, calls[2] = DELETE README
      assert.equal(calls.length, 3);
      assert.equal(calls[0].executable, "gh");
      assert.ok(calls[0].args.includes("create"));
      assert.ok(calls[0].args.includes("test-org/test-repo"));
      assert.ok(calls[0].args.includes("--add-readme"));
      assert.ok(calls[1].args.some((a) => a.includes("contents/README.md")));
      assert.ok(calls[1].args.includes("--jq"));
      assert.ok(calls[2].args.some((a) => a.includes("contents/README.md")));
      assert.ok(calls[2].args.includes("DELETE"));
    });

    test("applies visibility setting - private", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { visibility: "private" },
      });

      assert.ok(calls[0].args.includes("--private"));
    });

    test("applies visibility setting - internal", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { visibility: "internal" },
      });

      assert.ok(calls[0].args.includes("--internal"));
    });

    test("defaults to private visibility", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({ repo: mockRepoInfo });

      assert.ok(calls[0].args.includes("--private"));
    });

    test("applies visibility setting - public", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { visibility: "public" },
      });

      assert.ok(calls[0].args.includes("--public"));
    });

    test("applies description setting", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { description: "Test repo" },
      });

      assert.ok(calls[0].args.includes("--description"));
      assert.ok(calls[0].args.includes("Test repo"));
    });

    test("adds --disable-issues when hasIssues is false", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { hasIssues: false },
      });

      assert.ok(calls[0].args.includes("--disable-issues"));
    });

    test("adds --disable-wiki when hasWiki is false", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { hasWiki: false },
      });

      assert.ok(calls[0].args.includes("--disable-wiki"));
    });

    test("does not add --disable-issues when hasIssues is true", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({
        repo: mockRepoInfo,
        settings: { hasIssues: true },
      });

      assert.ok(!calls[0].args.includes("--disable-issues"));
    });

    test("initializes default branch with --add-readme then deletes README", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([["contents/README.md --jq", "abc123def"]]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({ repo: mockRepoInfo });

      // calls[0] = gh repo create with --add-readme
      // calls[1] = gh api .../contents/README.md --jq '.sha' (GET sha)
      // calls[2] = gh api .../contents/README.md --method DELETE
      assert.equal(calls.length, 3);
      assert.ok(
        calls[0].args.includes("--add-readme"),
        "Should include --add-readme flag"
      );
      assert.ok(
        calls[1].args.some((a) => a.includes("contents/README.md")) &&
          calls[1].args.includes("--jq"),
        "Should GET README.md sha via Contents API"
      );
      assert.ok(
        calls[2].args.some((a) => a.includes("contents/README.md")) &&
          calls[2].args.includes("DELETE"),
        "Should DELETE README.md via Contents API"
      );
    });

    test("rejects non-GitHub repo for create", async () => {
      const adoRepo: AzureDevOpsRepoInfo = {
        type: "azure-devops",
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.create({ repo: adoRepo }),
        /requires GitHub repo/
      );
    });

    test("throws on failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([
          ["gh repo create", new Error("Permission denied")],
        ]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.create({ repo: mockRepoInfo }),
        /Permission denied/
      );
    });

    describe("create() with defaultBranch", () => {
      test("renames branch when GitHub created a different default branch", async () => {
        // Custom executor: returns "master" on the first default_branch
        // query (before rename) and "main" on subsequent queries (after rename,
        // during the waitForDefaultBranch poll).
        // Note: This mock executor follows the same ICommandExecutor interface
        // used throughout the test suite. No shell commands are executed.
        let defaultBranchCallCount = 0;
        const calls: Array<{
          executable: string;
          args: string[];
          cwd: string;
        }> = [];
        const execFn = async (
          executable: string,
          args: string[],
          cwd: string
        ): Promise<string> => {
          calls.push({ executable, args, cwd });
          if (args.includes("--jq") && args.includes(".default_branch")) {
            defaultBranchCallCount++;
            return defaultBranchCallCount === 1 ? "master" : "main";
          }
          if (executable === "gh" && args.includes("create")) return "";
          if (args.some((a) => a.includes("branches/master/rename"))) return "";
          if (
            args.some((a) => a.includes("contents/README.md")) &&
            args.includes("--jq")
          )
            return "abc123def";
          if (args.includes("DELETE")) return "";
          return "";
        };
        const executor: ICommandExecutor = { exec: execFn };

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.create({
          repo: mockRepoInfo,
          settings: { defaultBranch: "main" },
        });

        // Should have: create, get default_branch, rename, poll default_branch, get README sha, delete README
        assert.ok(calls.length >= 5);
        assert.ok(
          calls[1].args.includes("--jq") &&
            calls[1].args.includes(".default_branch")
        );
        assert.ok(
          calls[2].args.some((a) => a.includes("branches/master/rename"))
        );
        assert.ok(calls[2].args.includes("POST"));
        assert.ok(calls[2].args.includes("new_name=main"));
        // Verify polling happened (call after rename should also query default_branch)
        assert.ok(
          calls[3].args.includes("--jq") &&
            calls[3].args.includes(".default_branch")
        );
      });

      test("skips rename when GitHub created branch matches desired name", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map([
            ["gh repo create", ""],
            [".default_branch", "main"],
            ["contents/README.md --jq", "abc123def"],
            ["DELETE", ""],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.create({
          repo: mockRepoInfo,
          settings: { defaultBranch: "main" },
        });

        // Should have: create, get default_branch, get README sha, delete README (no rename)
        assert.equal(calls.length, 4);
        assert.ok(
          !calls.some((c) => c.args.some((a) => a.includes("branches/")))
        );
      });

      test("no extra API calls when defaultBranch is not set", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map([["contents/README.md --jq", "abc123def"]]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.create({ repo: mockRepoInfo });

        // Should have: create, get README sha, delete README (no default_branch check)
        assert.equal(calls.length, 3);
        assert.ok(!calls.some((c) => c.args.includes(".default_branch")));
      });

      test("waitForDefaultBranch handles API errors during polling", async () => {
        // Poll throws errors intermittently, then succeeds
        let defaultBranchCallCount = 0;
        const calls: Array<{
          executable: string;
          args: string[];
          cwd: string;
        }> = [];
        const execFn2 = async (
          executable: string,
          args: string[],
          cwd: string
        ): Promise<string> => {
          calls.push({ executable, args, cwd });
          if (args.includes("--jq") && args.includes(".default_branch")) {
            defaultBranchCallCount++;
            if (defaultBranchCallCount === 1) return "master";
            if (defaultBranchCallCount === 2)
              throw new Error("HTTP 500: Internal Server Error");
            return "main"; // Third call succeeds
          }
          if (executable === "gh" && args.includes("create")) return "";
          if (args.some((a) => a.includes("branches/master/rename"))) return "";
          if (
            args.some((a) => a.includes("contents/README.md")) &&
            args.includes("--jq")
          )
            return "abc123def";
          if (args.includes("DELETE")) return "";
          return "";
        };
        const executor: ICommandExecutor = { exec: execFn2 };

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.create({
          repo: mockRepoInfo,
          settings: { defaultBranch: "main" },
        });

        // Should have recovered from the error and continued polling
        const pollCalls = calls.filter(
          (c) => c.args.includes("--jq") && c.args.includes(".default_branch")
        );
        assert.ok(
          pollCalls.length >= 3,
          `Expected at least 3 default_branch calls (initial + error + success), got ${pollCalls.length}`
        );
      });

      test("error propagates from rename API and deleteReadme is not reached", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map<string, string | Error>([
            ["gh repo create", ""],
            [".default_branch", "master"],
            [
              "new_name=main",
              new Error("Rename failed: 422 Unprocessable Entity"),
            ],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });

        await assert.rejects(
          () =>
            provider.create({
              repo: mockRepoInfo,
              settings: { defaultBranch: "main" },
            }),
          /Rename failed/
        );

        // Should have: create, get default_branch, rename (failed) - no README calls
        assert.equal(calls.length, 3);
        assert.ok(
          !calls.some((c) =>
            c.args.some((a) => a.includes("contents/README.md"))
          )
        );
      });
    });
  });

  describe("fork()", () => {
    const upstreamRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:opensource/cool-tool.git",
      owner: "opensource",
      repo: "cool-tool",
      host: "github.com",
    };

    test("forks repo to organization with --org flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        // Use 'users/' pattern to match the owner type check API call
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
      });

      // Find the fork command (not the API check)
      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(forkCall.args.includes("opensource/cool-tool"));
      assert.ok(forkCall.args.includes("--org"));
      assert.ok(forkCall.args.includes("test-org"));
      assert.ok(forkCall.args.includes("--fork-name"));
      assert.ok(forkCall.args.includes("test-repo"));
    });

    test("forks repo to personal account without --org flag", async () => {
      const personalRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:myusername/my-fork.git",
        owner: "myusername",
        repo: "my-fork",
        host: "github.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        // Use 'users/myusername' pattern to match the owner type check API call
        responses: new Map([
          ["users/myusername", '{"type": "User"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: personalRepoInfo,
      });

      // Find the fork command (not the API check)
      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(forkCall.args.includes("opensource/cool-tool"));
      assert.ok(!forkCall.args.includes("--org")); // Should NOT have --org
      assert.ok(forkCall.args.includes("--fork-name"));
      assert.ok(forkCall.args.includes("my-fork"));
    });

    test("includes --clone=false flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
      });

      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(forkCall.args.includes("--clone=false"));
    });

    test("defaults to org behavior when API check fails", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map<string, string | Error>([
          ["users/test-org", new Error("API error")],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
      });

      // Should default to --org when we can't determine owner type
      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(forkCall.args.includes("--org"));
    });

    test("applies visibility settings after fork", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
          ["gh repo edit", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
        settings: {
          visibility: "private",
        },
      });

      // Should call gh repo edit after fork
      const editCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("edit")
      );
      assert.ok(editCall);
      assert.ok(editCall.args.includes("--visibility"));
      assert.ok(editCall.args.includes("private"));
      assert.ok(
        editCall.args.includes("--accept-visibility-change-consequences")
      );
    });

    test("applies description settings after fork", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
          ["gh repo edit", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
        settings: {
          description: "My custom fork",
        },
      });

      // Should call gh repo edit after fork
      const editCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("edit")
      );
      assert.ok(editCall);
      assert.ok(editCall.args.includes("--description"));
      assert.ok(editCall.args.includes("My custom fork"));
    });

    test("does not call gh repo edit when no settings provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
      });

      // Should NOT call gh repo edit
      const editCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("edit")
      );
      assert.equal(editCall, undefined);
    });

    test("rejects non-GitHub upstream repo", async () => {
      const adoRepo: AzureDevOpsRepoInfo = {
        type: "azure-devops",
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.fork!({ upstream: adoRepo, target: mockRepoInfo }),
        /requires GitHub repo/
      );
    });

    test("rejects non-GitHub target repo", async () => {
      const adoRepo: AzureDevOpsRepoInfo = {
        type: "azure-devops",
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.fork!({ upstream: upstreamRepoInfo, target: adoRepo }),
        /requires GitHub repo/
      );
    });

    test("throws on fork failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map<string, string | Error>([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", new Error("Cannot fork private repo")],
        ]),
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () =>
          provider.fork!({ upstream: upstreamRepoInfo, target: mockRepoInfo }),
        /Cannot fork private repo/
      );
    });

    test("rejects fork when upstream and target have same owner", async () => {
      const sameOwnerUpstream: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:test-org/original-repo.git",
        owner: "test-org",
        repo: "original-repo",
        host: "github.com",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () =>
          provider.fork!({ upstream: sameOwnerUpstream, target: mockRepoInfo }),
        /Cannot fork test-org\/original-repo to the same owner/
      );
    });

    test("rejects fork when owners match case-insensitively", async () => {
      const upstream: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:TestOrg/upstream.git",
        owner: "TestOrg",
        repo: "upstream",
        host: "github.com",
      };
      const target: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:testorg/fork.git",
        owner: "testorg",
        repo: "fork",
        host: "github.com",
      };
      const { mock: executor } = createMockExecutor({ defaultResponse: "" });
      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () => provider.fork!({ upstream: upstream, target: target }),
        /Cannot fork.*same owner/
      );
    });

    test("fork with defaultBranch set completes without rename", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
        settings: {
          defaultBranch: "main",
        },
      });

      // Should not call any branch rename API
      assert.ok(
        !calls.some((c) => c.args.some((a) => a.includes("branches/")))
      );
      assert.ok(!calls.some((c) => c.args.includes("-m")));
    });
  });

  describe("waitForForkReady (via fork())", () => {
    const upstreamRepoInfo2: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:upstream-org/tool.git",
      owner: "upstream-org",
      repo: "tool",
      host: "github.com",
    };

    test("polls exists() until fork is ready", async () => {
      let apiCallCount = 0;
      const executor: ICommandExecutor = {
        async exec(executable: string, args: string[]) {
          if (args.some((a) => a.startsWith("users/"))) {
            return '{"type": "Organization"}';
          }
          if (executable === "gh" && args.includes("fork")) {
            return "";
          }
          if (args.some((a) => a.startsWith("repos/"))) {
            apiCallCount++;
            if (apiCallCount <= 2) {
              const err = new Error("Not Found");
              (err as Error & { stderr?: string }).stderr = "";
              throw err;
            }
            return '{"id": 123}';
          }
          return "";
        },
      };

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        forkReadyTimeoutMs: 5000,
        forkPollIntervalMs: 10,
        cwd: "/test",
      });

      await provider.fork!({
        upstream: upstreamRepoInfo2,
        target: mockRepoInfo,
      });

      // Should have polled exists() 3 times (2 not-found + 1 success)
      assert.equal(apiCallCount, 3);
    });

    test("throws timeout error when fork never becomes ready", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as Error & { stderr?: string }).stderr = "";

      const executor: ICommandExecutor = {
        async exec(executable: string, args: string[]) {
          if (args.some((a) => a.startsWith("users/"))) {
            return '{"type": "Organization"}';
          }
          if (executable === "gh" && args.includes("fork")) {
            return "";
          }
          if (args.some((a) => a.startsWith("repos/"))) {
            throw notFoundError;
          }
          return "";
        },
      };

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        forkReadyTimeoutMs: 50,
        forkPollIntervalMs: 10,
        cwd: "/test",
      });

      await assert.rejects(
        () =>
          provider.fork!({ upstream: upstreamRepoInfo2, target: mockRepoInfo }),
        /Timed out waiting for fork.*to become available/
      );
    });
  });

  describe("receiveMigration()", () => {
    test("creates repo then pushes mirror content separately", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          [
            "for-each-ref",
            "refs/heads/main\nrefs/tags/v1.0\nrefs/pull/1/head\nrefs/merge-requests/1/head",
          ],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.receiveMigration({
        repo: mockRepoInfo,
        sourceDir: "/tmp/source-mirror",
      });

      // calls[0] = remote remove origin (cleanup from mirror clone)
      // calls[1] = for-each-ref (all refs)
      // calls[2] = update-ref -d refs/pull/1/head
      // calls[3] = update-ref -d refs/merge-requests/1/head
      // calls[4] = gh repo create (without --source --push)
      // calls[5] = git remote add origin (authenticated URL)
      // calls[6] = git push --mirror origin
      assert.equal(calls.length, 7);
      assert.ok(calls[0].args.includes("remove"));
      assert.ok(calls[0].args.includes("origin"));
      assert.ok(calls[1].args.includes("for-each-ref"));
      assert.ok(calls[1].args.includes("--format=%(refname)"));
      assert.ok(calls[2].args.includes("update-ref"));
      assert.ok(calls[2].args.includes("refs/pull/1/head"));
      assert.ok(calls[3].args.includes("update-ref"));
      assert.ok(calls[3].args.includes("refs/merge-requests/1/head"));
      assert.equal(calls[4].executable, "gh");
      assert.ok(calls[4].args.includes("create"));
      assert.ok(!calls[4].args.includes("--source"));
      assert.ok(!calls[4].args.includes("--push"));
      assert.ok(calls[5].args.includes("add"));
      assert.ok(calls[5].args.includes("origin"));
      assert.ok(calls[6].args.includes("--mirror"));
    });

    test("rejects non-GitHub repo", async () => {
      const adoRepo: AzureDevOpsRepoInfo = {
        type: "azure-devops",
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const { mock: executor } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });

      await assert.rejects(
        () =>
          provider.receiveMigration({
            repo: adoRepo,
            sourceDir: "/tmp/source",
          }),
        /requires GitHub repo/
      );
    });

    test("passes settings to create", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["for-each-ref", "refs/heads/main\nrefs/tags/v1.0\nrefs/pull/1/head"],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.receiveMigration({
        repo: mockRepoInfo,
        sourceDir: "/tmp/source",
        settings: {
          visibility: "private",
        },
      });

      // calls[0] = git remote remove origin, calls[1] = git for-each-ref,
      // calls[2] = update-ref -d refs/pull/1/head, calls[3] = gh repo create
      const createCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("create")
      );
      assert.ok(createCall);
      assert.ok(createCall.args.includes("--private"));
    });

    test("continues when remote remove origin fails", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map<string, string | Error>([
          [
            "remote remove origin",
            new Error("fatal: No such remote: 'origin'"),
          ],
          ["for-each-ref", "refs/heads/main\nrefs/tags/v1.0"],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.receiveMigration({
        repo: mockRepoInfo,
        sourceDir: "/tmp/source-mirror",
      });

      // Should still reach gh repo create despite remote remove failure
      const createCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("create")
      );
      assert.ok(
        createCall,
        "should proceed to create repo after remote remove failure"
      );
    });

    test("continues when ref cleanup fails", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["for-each-ref", new Error("not a git repository")],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.receiveMigration({
        repo: mockRepoInfo,
        sourceDir: "/tmp/source-mirror",
      });

      // Should still reach gh repo create despite ref cleanup failure
      const createCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("create")
      );
      assert.ok(
        createCall,
        "should proceed to create repo after ref cleanup failure"
      );
    });

    describe("receiveMigration() with defaultBranch", () => {
      test("renames branch in mirror clone when source HEAD differs from desired", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map([
            ["for-each-ref", "refs/heads/master\nrefs/tags/v1.0"],
            ["symbolic-ref HEAD", "refs/heads/master"],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.receiveMigration({
          repo: mockRepoInfo,
          sourceDir: "/tmp/source-mirror",
          settings: {
            defaultBranch: "main",
          },
        });

        const branchRenameCall = calls.find(
          (c) => c.executable === "git" && c.args.includes("-m")
        );
        assert.ok(branchRenameCall, "should call git branch -m");
        assert.ok(branchRenameCall.args.includes("master"));
        assert.ok(branchRenameCall.args.includes("main"));

        const symrefSetCall = calls.find(
          (c) =>
            c.executable === "git" &&
            c.args.includes("symbolic-ref") &&
            c.args.some((a) => a.startsWith("refs/heads/"))
        );
        assert.ok(symrefSetCall, "should update symbolic-ref HEAD");
        assert.ok(symrefSetCall.args.includes("refs/heads/main"));
      });

      test("skips rename when source HEAD matches desired branch", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map([
            ["for-each-ref", "refs/heads/main\nrefs/tags/v1.0"],
            ["symbolic-ref HEAD", "refs/heads/main"],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.receiveMigration({
          repo: mockRepoInfo,
          sourceDir: "/tmp/source-mirror",
          settings: {
            defaultBranch: "main",
          },
        });

        assert.ok(!calls.some((c) => c.args.includes("-m")));
      });

      test("no git rename ops when defaultBranch is not set", async () => {
        const { mock: executor, calls } = createMockExecutor({
          responses: new Map([
            [
              "for-each-ref",
              "refs/heads/master\nrefs/tags/v1.0\nrefs/pull/1/head",
            ],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });
        await provider.receiveMigration({
          repo: mockRepoInfo,
          sourceDir: "/tmp/source-mirror",
        });

        assert.ok(
          !calls.some(
            (c) => c.args.includes("symbolic-ref") && c.args.includes("HEAD")
          )
        );
        assert.ok(!calls.some((c) => c.args.includes("-m")));
      });

      test("throws descriptive error when symbolic-ref output is not refs/heads/", async () => {
        const { mock: executor } = createMockExecutor({
          responses: new Map([
            ["for-each-ref", "refs/heads/main"],
            ["symbolic-ref HEAD", "refs/tags/v1.0"],
          ]),
          defaultResponse: "",
        });

        const provider = new GitHubLifecycleProvider({
          executor,
          retries: 0,
          cwd: "/test",
        });

        await assert.rejects(
          () =>
            provider.receiveMigration({
              repo: mockRepoInfo,
              sourceDir: "/tmp/source-mirror",
              settings: {
                defaultBranch: "main",
              },
            }),
          /refs\/heads\//
        );
      });
    });
  });

  describe("token env injection", () => {
    test("exists() passes GH_TOKEN via env when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      await provider.exists({ repo: mockRepoInfo, token: "ghs_test_token" });

      assert.equal(calls.length, 1);
      assert.ok(calls[0].executable === "gh" && calls[0].args.includes("api"));
      assert.equal(calls[0].options?.env?.GH_TOKEN, "ghs_test_token");
    });

    test("exists() has no prefix when token not provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor, cwd: "/test" });
      await provider.exists({ repo: mockRepoInfo });

      assert.equal(calls.length, 1);
      assert.ok(calls[0].executable === "gh" && calls[0].args.includes("api"));
    });

    test("create() passes GH_TOKEN via env when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([["contents/README.md --jq", "abc123def"]]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.create({ repo: mockRepoInfo, token: "ghs_test_token" });

      // calls[0] = gh repo create, calls[1] = GET README sha, calls[2] = DELETE README
      assert.equal(calls.length, 3);
      assert.ok(
        calls[0].executable === "gh" && calls[0].args.includes("create")
      );
      assert.equal(calls[0].options?.env?.GH_TOKEN, "ghs_test_token");
      // Token should also be used for the deleteReadme API calls
      assert.equal(calls[1].options?.env?.GH_TOKEN, "ghs_test_token");
      assert.equal(calls[2].options?.env?.GH_TOKEN, "ghs_test_token");
    });

    test("receiveMigration() passes GH_TOKEN via env when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.receiveMigration({
        repo: mockRepoInfo,
        sourceDir: "/tmp/source",
        token: "ghs_test_token",
      });

      // calls[0] = git remote remove origin, calls[1] = git for-each-ref,
      // calls[2] = gh repo create, calls[3] = git remote add origin, calls[4] = git push --mirror
      assert.equal(calls.length, 5);
      assert.ok(
        calls[2].executable === "gh" && calls[2].args.includes("create")
      );
      assert.equal(calls[2].options?.env?.GH_TOKEN, "ghs_test_token");
      assert.ok(
        calls[3].args.includes("add") && calls[3].args.includes("origin")
      );
      assert.ok(
        calls[3].args.some((a) => a.includes("x-access-token:ghs_test_token@"))
      );
      assert.equal(calls[4].options?.env?.GH_TOKEN, "ghs_test_token");
    });

    test("fork() passes GH_TOKEN via env for all gh commands when token provided", async () => {
      const upstreamRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:opensource/cool-tool.git",
        owner: "opensource",
        repo: "cool-tool",
        host: "github.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/test-org", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
        token: "ghs_test_token",
      });

      // isOrganization API call should have token via env
      const apiCall = calls.find((c) =>
        c.args.some((a) => a.startsWith("users/"))
      );
      assert.ok(apiCall);
      assert.ok(apiCall.executable === "gh" && apiCall.args.includes("api"));
      assert.equal(apiCall.options?.env?.GH_TOKEN, "ghs_test_token");

      // fork command should have token via env
      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(forkCall.executable === "gh" && forkCall.args.includes("fork"));
      assert.equal(forkCall.options?.env?.GH_TOKEN, "ghs_test_token");
    });

    test("defaults to org behavior when isOrganization check fails", async () => {
      const upstreamRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:opensource/cool-tool.git",
        owner: "opensource",
        repo: "cool-tool",
        host: "github.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        responses: new Map<string, string | Error>([
          ["users/test-org", new Error("API rate limit exceeded")],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({
        executor,
        retries: 0,
        cwd: "/test",
      });
      await provider.fork!({
        upstream: upstreamRepoInfo,
        target: mockRepoInfo,
      });

      // Should still fork with --org flag (defaults to org when check fails)
      const forkCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("fork")
      );
      assert.ok(forkCall);
      assert.ok(
        forkCall.args.includes("--org"),
        "Should use --org flag when isOrganization check fails"
      );
    });
  });
});
