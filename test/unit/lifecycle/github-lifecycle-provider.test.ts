import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../src/shared/repo-detector.js";

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

      const provider = new GitHubLifecycleProvider({ executor });
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, true);
    });

    test("returns false when repo does not exist (404)", async () => {
      const notFoundError = new Error("Could not resolve to a Repository");
      (notFoundError as Error & { stderr?: string }).stderr =
        "gh: Could not resolve to a Repository";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, false);
    });

    test("throws on network/auth error (not repo-not-found)", async () => {
      const networkError = new Error("Network timeout");
      (networkError as Error & { stderr?: string }).stderr = "Network timeout";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", networkError]]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(() => provider.exists(mockRepoInfo), /Network/);
    });

    test("uses correct gh api command", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor });
      await provider.exists(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh api"));
      assert.ok(calls[0].command.includes("repos/'test-org'/'test-repo'"));
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.exists(adoRepo),
        /requires GitHub repo/
      );
    });

    test("returns false for Not Found pattern", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as Error & { stderr?: string }).stderr = "";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, false);
    });

    test("returns false for 404 pattern", async () => {
      const notFoundError = new Error("HTTP 404");
      (notFoundError as Error & { stderr?: string }).stderr = "";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, false);
    });

    test("does not include --hostname for github.com", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor });
      await provider.exists(mockRepoInfo);

      assert.ok(!calls[0].command.includes("--hostname"));
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

      const provider = new GitHubLifecycleProvider({ executor });
      await provider.exists(gheRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("--hostname"));
      assert.ok(calls[0].command.includes("'github.mycompany.com'"));
    });
  });

  describe("create()", () => {
    test("creates repo with gh repo create", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh repo create"));
      assert.ok(calls[0].command.includes("'test-org/test-repo'"));
    });

    test("applies visibility setting - private", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { visibility: "private" });

      assert.ok(calls[0].command.includes("--private"));
    });

    test("applies visibility setting - internal", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { visibility: "internal" });

      assert.ok(calls[0].command.includes("--internal"));
    });

    test("defaults to private visibility", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo);

      assert.ok(calls[0].command.includes("--private"));
    });

    test("applies visibility setting - public", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { visibility: "public" });

      assert.ok(calls[0].command.includes("--public"));
    });

    test("applies description setting", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { description: "Test repo" });

      assert.ok(calls[0].command.includes("--description"));
      assert.ok(calls[0].command.includes("Test repo"));
    });

    test("adds --disable-issues when hasIssues is false", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { hasIssues: false });

      assert.ok(calls[0].command.includes("--disable-issues"));
    });

    test("adds --disable-wiki when hasWiki is false", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { hasWiki: false });

      assert.ok(calls[0].command.includes("--disable-wiki"));
    });

    test("does not add --disable-issues when hasIssues is true", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, { hasIssues: true });

      assert.ok(!calls[0].command.includes("--disable-issues"));
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.create(adoRepo),
        /requires GitHub repo/
      );
    });

    test("throws on failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([
          ["gh repo create", new Error("Permission denied")],
        ]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.create(mockRepoInfo),
        /Permission denied/
      );
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
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      // Find the fork command (not the API check)
      const forkCall = calls.find((c) => c.command.includes("gh repo fork"));
      assert.ok(forkCall);
      assert.ok(forkCall.command.includes("'opensource/cool-tool'"));
      assert.ok(forkCall.command.includes("--org"));
      assert.ok(forkCall.command.includes("'test-org'"));
      assert.ok(forkCall.command.includes("--fork-name"));
      assert.ok(forkCall.command.includes("'test-repo'"));
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
        // Use 'users/' pattern to match the owner type check API call
        responses: new Map([
          ["users/", '{"type": "User"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, personalRepoInfo);

      // Find the fork command (not the API check)
      const forkCall = calls.find((c) => c.command.includes("gh repo fork"));
      assert.ok(forkCall);
      assert.ok(forkCall.command.includes("'opensource/cool-tool'"));
      assert.ok(!forkCall.command.includes("--org")); // Should NOT have --org
      assert.ok(forkCall.command.includes("--fork-name"));
      assert.ok(forkCall.command.includes("'my-fork'"));
    });

    test("includes --clone=false flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      const forkCall = calls.find((c) => c.command.includes("gh repo fork"));
      assert.ok(forkCall);
      assert.ok(forkCall.command.includes("--clone=false"));
    });

    test("defaults to org behavior when API check fails", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", new Error("API error")],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      // Should default to --org when we can't determine owner type
      const forkCall = calls.find((c) => c.command.includes("gh repo fork"));
      assert.ok(forkCall);
      assert.ok(forkCall.command.includes("--org"));
    });

    test("applies visibility settings after fork", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
          ["gh repo edit", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo, {
        visibility: "private",
      });

      // Should call gh repo edit after fork
      const editCall = calls.find((c) => c.command.includes("gh repo edit"));
      assert.ok(editCall);
      assert.ok(editCall.command.includes("--visibility"));
      assert.ok(editCall.command.includes("private"));
      assert.ok(
        editCall.command.includes("--accept-visibility-change-consequences")
      );
    });

    test("applies description settings after fork", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
          ["gh repo edit", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo, {
        description: "My custom fork",
      });

      // Should call gh repo edit after fork
      const editCall = calls.find((c) => c.command.includes("gh repo edit"));
      assert.ok(editCall);
      assert.ok(editCall.command.includes("--description"));
      assert.ok(editCall.command.includes("My custom fork"));
    });

    test("does not call gh repo edit when no settings provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      // Should NOT call gh repo edit
      const editCall = calls.find((c) => c.command.includes("gh repo edit"));
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.fork!(adoRepo, mockRepoInfo),
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.fork!(upstreamRepoInfo, adoRepo),
        /requires GitHub repo/
      );
    });

    test("throws on fork failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", new Error("Cannot fork private repo")],
        ]),
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.fork!(upstreamRepoInfo, mockRepoInfo),
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.fork!(sameOwnerUpstream, mockRepoInfo),
        /Cannot fork test-org\/original-repo to the same owner/
      );
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
        async exec(command: string) {
          if (command.includes("users/")) {
            return '{"type": "Organization"}';
          }
          if (command.includes("gh repo fork")) {
            return "";
          }
          if (command.includes("repos/")) {
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
      });

      await provider.fork!(upstreamRepoInfo2, mockRepoInfo);

      // Should have polled exists() 3 times (2 not-found + 1 success)
      assert.equal(apiCallCount, 3);
    });

    test("throws timeout error when fork never becomes ready", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as Error & { stderr?: string }).stderr = "";

      const executor: ICommandExecutor = {
        async exec(command: string) {
          if (command.includes("users/")) {
            return '{"type": "Organization"}';
          }
          if (command.includes("gh repo fork")) {
            return "";
          }
          if (command.includes("repos/")) {
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
      });

      await assert.rejects(
        () => provider.fork!(upstreamRepoInfo2, mockRepoInfo),
        /Timed out waiting for fork.*to become available/
      );
    });
  });

  describe("receiveMigration()", () => {
    test("uses gh repo create --source --push in single command", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

      // First call removes existing origin remote, second is gh repo create
      assert.equal(calls.length, 2);
      assert.ok(calls[0].command.includes("git -C"));
      assert.ok(calls[0].command.includes("remote remove origin"));
      assert.ok(calls[1].command.includes("gh repo create"));
      assert.ok(calls[1].command.includes("--source"));
      assert.ok(calls[1].command.includes("'/tmp/source-mirror'"));
      assert.ok(calls[1].command.includes("--push"));
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

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

      await assert.rejects(
        () => provider.receiveMigration(adoRepo, "/tmp/source"),
        /requires GitHub repo/
      );
    });

    test("passes settings to create", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.receiveMigration(mockRepoInfo, "/tmp/source", {
        visibility: "private",
      });

      // calls[0] is git remote remove origin, calls[1] is gh repo create
      assert.ok(calls[1].command.includes("--private"));
    });
  });

  describe("token prefix", () => {
    test("exists() prefixes command with GH_TOKEN when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor });
      await provider.exists(mockRepoInfo, "ghs_test_token");

      assert.equal(calls.length, 1);
      assert.ok(
        calls[0].command.startsWith("GH_TOKEN='ghs_test_token' gh api")
      );
    });

    test("exists() has no prefix when token not provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider({ executor });
      await provider.exists(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.startsWith("gh api"));
    });

    test("create() prefixes command with GH_TOKEN when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.create(mockRepoInfo, undefined, "ghs_test_token");

      assert.equal(calls.length, 1);
      assert.ok(
        calls[0].command.startsWith("GH_TOKEN='ghs_test_token' gh repo create")
      );
    });

    test("receiveMigration() prefixes command with GH_TOKEN when token provided", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.receiveMigration(
        mockRepoInfo,
        "/tmp/source",
        undefined,
        "ghs_test_token"
      );

      // calls[0] is git remote remove origin, calls[1] is gh repo create
      assert.equal(calls.length, 2);
      assert.ok(
        calls[1].command.startsWith("GH_TOKEN='ghs_test_token' gh repo create")
      );
    });

    test("fork() prefixes all gh commands with GH_TOKEN when token provided", async () => {
      const upstreamRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.com:opensource/cool-tool.git",
        owner: "opensource",
        repo: "cool-tool",
        host: "github.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        responses: new Map([
          ["users/", '{"type": "Organization"}'],
          ["gh repo fork", ""],
        ]),
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
      await provider.fork!(
        upstreamRepoInfo,
        mockRepoInfo,
        undefined,
        "ghs_test_token"
      );

      // isOrganization API call should have token prefix
      const apiCall = calls.find((c) => c.command.includes("users/"));
      assert.ok(apiCall);
      assert.ok(apiCall.command.startsWith("GH_TOKEN='ghs_test_token' gh api"));

      // fork command should have token prefix
      const forkCall = calls.find((c) => c.command.includes("gh repo fork"));
      assert.ok(forkCall);
      assert.ok(
        forkCall.command.startsWith("GH_TOKEN='ghs_test_token' gh repo fork")
      );
    });
  });
});
