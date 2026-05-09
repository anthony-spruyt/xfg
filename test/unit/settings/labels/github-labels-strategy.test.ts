import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubLabelsStrategy } from "../../../../src/settings/labels/github-labels-strategy.js";
import type { GitHubLabel } from "../../../../src/settings/labels/types.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../../../../src/repo/index.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";

interface CallRecord {
  executable: string;
  args: string[];
  cwd: string;
  options?: ExecOptions;
}

// Mock executor that records calls and returns configured responses
class MockExecutor implements ICommandExecutor {
  calls: CallRecord[] = [];
  responses: Map<string, string> = new Map();
  defaultResponse = "[]";

  async exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args, cwd, options });

    // Find matching response by checking if any arg includes the pattern
    for (const [pattern, response] of this.responses) {
      if (args.some((a) => a.includes(pattern))) {
        return response;
      }
    }
    return this.defaultResponse;
  }

  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  reset(): void {
    this.calls = [];
    this.responses.clear();
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  gitUrl: "git@github.com:test-org/test-repo.git",
  host: "github.com",
};

const mockAzureRepo: AzureDevOpsRepoInfo = {
  type: "azure-devops",
  owner: "test-org",
  organization: "test-org",
  project: "test-project",
  repo: "test-repo",
  gitUrl: "git@ssh.dev.azure.com:v3/test-org/test-project/test-repo",
};

const mockGitLabRepo: GitLabRepoInfo = {
  type: "gitlab",
  owner: "test-org",
  namespace: "test-org",
  repo: "test-repo",
  gitUrl: "git@gitlab.com:test-org/test-repo.git",
  host: "gitlab.com",
};

describe("GitHubLabelsStrategy", () => {
  let mockExecutor: MockExecutor;
  let strategy: GitHubLabelsStrategy;

  beforeEach(() => {
    mockExecutor = new MockExecutor();
    strategy = new GitHubLabelsStrategy(mockExecutor, {
      retries: 0,
      cwd: "/test",
    });
  });

  describe("list", () => {
    test("fetches all labels for a repository", async () => {
      const labels: GitHubLabel[] = [
        {
          id: 1,
          name: "bug",
          color: "d73a4a",
          description: "Something isn't working",
          default: true,
        },
        {
          id: 2,
          name: "enhancement",
          color: "a2eeef",
          description: "New feature or request",
          default: true,
        },
      ];
      mockExecutor.setResponse("/labels", JSON.stringify(labels));

      const result = await strategy.list(mockGitHubRepo);

      assert.equal(result.length, 2);
      assert.equal(result[0].name, "bug");
      assert.equal(result[1].name, "enhancement");
      assert.strictEqual(mockExecutor.calls[0].executable, "gh");
      assert.ok(
        mockExecutor.calls[0].args.some((a) =>
          a.includes("/repos/test-org/test-repo/labels")
        )
      );
    });

    test("uses --paginate flag", async () => {
      mockExecutor.setResponse("/labels", "[]");

      await strategy.list(mockGitHubRepo);

      assert.ok(
        mockExecutor.calls[0].args.includes("--paginate"),
        "Should include --paginate flag for list endpoint"
      );
    });

    test("does not include -X flag for GET requests", async () => {
      mockExecutor.setResponse("/labels", "[]");

      await strategy.list(mockGitHubRepo);

      assert.ok(
        !mockExecutor.calls[0].args.includes("-X"),
        "GET requests should not include -X flag"
      );
    });

    test("uses custom host for GitHub Enterprise", async () => {
      mockExecutor.setResponse("/labels", "[]");
      const gheRepo: GitHubRepoInfo = {
        ...mockGitHubRepo,
        host: "github.mycompany.com",
      };

      await strategy.list(gheRepo, { host: "github.mycompany.com" });

      assert.ok(
        mockExecutor.calls[0].args.includes("--hostname"),
        "Should include --hostname flag"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("github.mycompany.com"),
        "Should include the custom host"
      );
    });

    test("does not add --hostname for github.com", async () => {
      mockExecutor.setResponse("/labels", "[]");

      await strategy.list(mockGitHubRepo, { host: "github.com" });

      assert.ok(
        !mockExecutor.calls[0].args.includes("--hostname"),
        "Should not include --hostname for github.com"
      );
    });

    test("uses token when provided", async () => {
      mockExecutor.setResponse("/labels", "[]");

      await strategy.list(mockGitHubRepo, { token: "test-token" });

      assert.strictEqual(
        mockExecutor.calls[0].options?.env?.GH_TOKEN,
        "test-token",
        "Should pass GH_TOKEN via env options"
      );
    });

    test("uses token and host combined", async () => {
      mockExecutor.setResponse("/labels", "[]");
      const gheRepo: GitHubRepoInfo = {
        ...mockGitHubRepo,
        host: "github.mycompany.com",
      };

      await strategy.list(gheRepo, {
        token: "ghe-token",
        host: "github.mycompany.com",
      });

      assert.strictEqual(
        mockExecutor.calls[0].options?.env?.GH_TOKEN,
        "ghe-token",
        "Should pass GH_TOKEN via env options"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("--hostname"),
        "Should include --hostname flag"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("github.mycompany.com"),
        "Should include the custom host"
      );
    });

    test("throws error for Azure DevOps repos", async () => {
      await assert.rejects(
        () => strategy.list(mockAzureRepo),
        /GitHub Labels strategy requires GitHub repositories/
      );
    });

    test("throws error for GitLab repos", async () => {
      await assert.rejects(
        () => strategy.list(mockGitLabRepo),
        /GitHub Labels strategy requires GitHub repositories/
      );
    });
  });

  describe("create", () => {
    test("creates a new label with POST method", async () => {
      mockExecutor.setResponse("/labels", "{}");

      await strategy.create(mockGitHubRepo, {
        name: "priority:high",
        color: "ff0000",
        description: "High priority issue",
      });

      assert.strictEqual(mockExecutor.calls[0].executable, "gh");
      assert.ok(
        mockExecutor.calls[0].args.includes("-X"),
        "Should include -X flag"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("POST"),
        "Should use POST method"
      );
      assert.ok(
        mockExecutor.calls[0].args.some((a) =>
          a.includes("/repos/test-org/test-repo/labels")
        ),
        "Should target labels endpoint"
      );
    });

    test("uses input option for payload", async () => {
      mockExecutor.setResponse("/labels", "{}");

      await strategy.create(mockGitHubRepo, {
        name: "bug",
        color: "d73a4a",
      });

      assert.ok(
        mockExecutor.calls[0].options?.input,
        "Should pass payload via options.input"
      );
    });

    test("includes label data in payload", async () => {
      mockExecutor.setResponse("/labels", "{}");

      await strategy.create(mockGitHubRepo, {
        name: "bug",
        color: "d73a4a",
        description: "Something isn't working",
      });

      const input = mockExecutor.calls[0].options?.input ?? "";
      assert.ok(input.includes("bug"), "Should include label name");
      assert.ok(input.includes("d73a4a"), "Should include label color");
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () =>
          strategy.create(mockAzureRepo, {
            name: "bug",
            color: "d73a4a",
          }),
        /GitHub Labels strategy requires GitHub repositories/
      );
    });
  });

  describe("update", () => {
    test("updates an existing label with PATCH method", async () => {
      mockExecutor.setResponse("/labels/", "{}");

      await strategy.update(mockGitHubRepo, "bug", {
        color: "ff0000",
        description: "Updated description",
      });

      assert.ok(
        mockExecutor.calls[0].args.includes("-X"),
        "Should include -X flag"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("PATCH"),
        "Should use PATCH method"
      );
      assert.ok(
        mockExecutor.calls[0].args.some((a) =>
          a.includes("/repos/test-org/test-repo/labels/")
        ),
        "Should target labels endpoint with name"
      );
    });

    test("uses encodeURIComponent for label name in URL", async () => {
      mockExecutor.setResponse("/labels/", "{}");

      await strategy.update(mockGitHubRepo, "priority:high", {
        color: "ff0000",
      });

      assert.ok(
        mockExecutor.calls[0].args.some((a) => a.includes("priority%3Ahigh")),
        "Should encode colon in label name"
      );
    });

    test("encodes spaces in label name", async () => {
      mockExecutor.setResponse("/labels/", "{}");

      await strategy.update(mockGitHubRepo, "good first issue", {
        color: "7057ff",
      });

      assert.ok(
        mockExecutor.calls[0].args.some((a) =>
          a.includes("good%20first%20issue")
        ),
        "Should encode spaces in label name"
      );
    });

    test("includes payload via input option", async () => {
      mockExecutor.setResponse("/labels/", "{}");

      await strategy.update(mockGitHubRepo, "bug", {
        new_name: "bug-report",
        color: "ff0000",
      });

      const input = mockExecutor.calls[0].options?.input ?? "";
      assert.ok(
        mockExecutor.calls[0].options?.input,
        "Should pass payload via options.input"
      );
      assert.ok(
        input.includes("bug-report"),
        "Should include new_name in payload"
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.update(mockAzureRepo, "bug", { color: "ff0000" }),
        /GitHub Labels strategy requires GitHub repositories/
      );
    });
  });

  describe("delete", () => {
    test("deletes a label with DELETE method", async () => {
      mockExecutor.setResponse("/labels/", "");

      await strategy.delete(mockGitHubRepo, "bug");

      assert.ok(
        mockExecutor.calls[0].args.includes("-X"),
        "Should include -X flag"
      );
      assert.ok(
        mockExecutor.calls[0].args.includes("DELETE"),
        "Should use DELETE method"
      );
      assert.ok(
        mockExecutor.calls[0].args.some((a) =>
          a.includes("/repos/test-org/test-repo/labels/")
        ),
        "Should target labels endpoint with name"
      );
    });

    test("uses encodeURIComponent for label name in URL", async () => {
      mockExecutor.setResponse("/labels/", "");

      await strategy.delete(mockGitHubRepo, "priority:high");

      assert.ok(
        mockExecutor.calls[0].args.some((a) => a.includes("priority%3Ahigh")),
        "Should encode colon in label name"
      );
    });

    test("does not pass input for DELETE", async () => {
      mockExecutor.setResponse("/labels/", "");

      await strategy.delete(mockGitHubRepo, "bug");

      assert.ok(
        !mockExecutor.calls[0].options?.input,
        "DELETE should not pass input option"
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.delete(mockAzureRepo, "bug"),
        /GitHub Labels strategy requires GitHub repositories/
      );
    });
  });

  describe("validateGitHub", () => {
    test("throws for Azure DevOps repo with correct message", async () => {
      await assert.rejects(
        () => strategy.list(mockAzureRepo),
        (err: Error) => {
          assert.match(
            err.message,
            /GitHub Labels strategy requires GitHub repositories/
          );
          assert.match(err.message, /azure-devops/);
          return true;
        }
      );
    });

    test("throws for GitLab repo with correct message", async () => {
      await assert.rejects(
        () => strategy.list(mockGitLabRepo),
        (err: Error) => {
          assert.match(
            err.message,
            /GitHub Labels strategy requires GitHub repositories/
          );
          assert.match(err.message, /gitlab/);
          return true;
        }
      );
    });
  });

  describe("retry behavior", () => {
    test("should retry on transient error and succeed", async () => {
      let callCount = 0;
      const executor: ICommandExecutor = {
        async exec(
          _executable: string,
          args: string[],
          _cwd: string,
          _options?: ExecOptions
        ): Promise<string> {
          if (args.some((a) => a.includes("/labels"))) {
            callCount++;
            if (callCount === 1) {
              throw new Error("Connection timed out");
            }
            return "[]";
          }
          return "{}";
        },
      };

      const retryStrategy = new GitHubLabelsStrategy(executor, {
        retries: 1,
        cwd: "/test",
      });
      const result = await retryStrategy.list(mockGitHubRepo);

      assert.deepEqual(result, []);
      assert.ok(callCount >= 2, `Expected at least 2 calls, got ${callCount}`);
    });

    test("should not retry on permanent error", async () => {
      let callCount = 0;
      const executor: ICommandExecutor = {
        async exec(
          _executable: string,
          args: string[],
          _cwd: string,
          _options?: ExecOptions
        ): Promise<string> {
          if (args.some((a) => a.includes("/labels"))) {
            callCount++;
            throw new Error("gh: Not Found (HTTP 404)");
          }
          return "{}";
        },
      };

      const retryStrategy = new GitHubLabelsStrategy(executor, {
        retries: 1,
        cwd: "/test",
      });
      await assert.rejects(
        async () => retryStrategy.list(mockGitHubRepo),
        /404/
      );

      assert.equal(callCount, 1, `Expected exactly 1 call, got ${callCount}`);
    });

    test("should propagate error from create on failure", async () => {
      const executor: ICommandExecutor = {
        async exec(
          _executable: string,
          _args: string[],
          _cwd: string,
          _options?: ExecOptions
        ): Promise<string> {
          throw new Error("gh: Validation Failed (HTTP 422)");
        },
      };

      const errorStrategy = new GitHubLabelsStrategy(executor, {
        retries: 0,
        cwd: "/test",
      });
      await assert.rejects(
        async () =>
          errorStrategy.create(mockGitHubRepo, {
            name: "bug",
            color: "d73a4a",
          }),
        /422/
      );
    });
  });
});
