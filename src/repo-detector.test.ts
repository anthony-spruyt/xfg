import { describe, test } from "node:test";
import assert from "node:assert";
import {
  parseGitUrl,
  detectRepoType,
  getRepoDisplayName,
  isGitLabRepo,
} from "./repo-detector.js";

describe("detectRepoType", () => {
  test("detects GitHub SSH URL", () => {
    assert.strictEqual(
      detectRepoType("git@github.com:owner/repo.git"),
      "github",
    );
  });

  test("detects GitHub HTTPS URL", () => {
    assert.strictEqual(
      detectRepoType("https://github.com/owner/repo.git"),
      "github",
    );
  });

  test("detects Azure DevOps SSH URL", () => {
    assert.strictEqual(
      detectRepoType("git@ssh.dev.azure.com:v3/org/project/repo"),
      "azure-devops",
    );
  });

  test("detects Azure DevOps HTTPS URL", () => {
    assert.strictEqual(
      detectRepoType("https://dev.azure.com/org/project/_git/repo"),
      "azure-devops",
    );
  });

  test("detects GitLab SaaS SSH URL", () => {
    assert.strictEqual(
      detectRepoType("git@gitlab.com:owner/repo.git"),
      "gitlab",
    );
  });

  test("detects GitLab SaaS HTTPS URL", () => {
    assert.strictEqual(
      detectRepoType("https://gitlab.com/owner/repo.git"),
      "gitlab",
    );
  });

  test("detects GitLab SaaS nested group SSH URL", () => {
    assert.strictEqual(
      detectRepoType("git@gitlab.com:org/group/subgroup/repo.git"),
      "gitlab",
    );
  });

  test("detects GitLab SaaS nested group HTTPS URL", () => {
    assert.strictEqual(
      detectRepoType("https://gitlab.com/org/group/subgroup/repo.git"),
      "gitlab",
    );
  });

  test("detects GitLab self-hosted SSH URL", () => {
    assert.strictEqual(
      detectRepoType("git@gitlab.example.com:owner/repo.git"),
      "gitlab",
    );
  });

  test("detects GitLab self-hosted HTTPS URL", () => {
    assert.strictEqual(
      detectRepoType("https://gitlab.example.com/owner/repo.git"),
      "gitlab",
    );
  });

  test("throws for ftp URLs", () => {
    assert.throws(
      () => detectRepoType("ftp://example.com/repo"),
      /Unrecognized git URL format/,
    );
  });

  test("throws for URLs without owner/repo structure", () => {
    assert.throws(
      () => detectRepoType("git@unknown.com:invalid"),
      /Unrecognized git URL format/,
    );
  });
});

describe("parseGitUrl", () => {
  describe("GitHub URLs", () => {
    test("parses SSH format: git@github.com:owner/repo.git", () => {
      const result = parseGitUrl("git@github.com:owner/repo.git");
      assert.strictEqual(result.type, "github");
      assert.strictEqual(result.owner, "owner");
      assert.strictEqual(result.repo, "repo");
      assert.strictEqual(result.gitUrl, "git@github.com:owner/repo.git");
    });

    test("parses SSH format without .git suffix", () => {
      const result = parseGitUrl("git@github.com:owner/repo");
      assert.strictEqual(result.type, "github");
      assert.strictEqual(result.owner, "owner");
      assert.strictEqual(result.repo, "repo");
    });

    test("parses HTTPS format: https://github.com/owner/repo.git", () => {
      const result = parseGitUrl("https://github.com/owner/repo.git");
      assert.strictEqual(result.type, "github");
      assert.strictEqual(result.owner, "owner");
      assert.strictEqual(result.repo, "repo");
    });

    test("parses HTTPS format without .git suffix", () => {
      const result = parseGitUrl("https://github.com/owner/repo");
      assert.strictEqual(result.type, "github");
      assert.strictEqual(result.owner, "owner");
      assert.strictEqual(result.repo, "repo");
    });

    test("handles repo names with dots: my.repo.git", () => {
      const result = parseGitUrl("git@github.com:owner/my.repo.git");
      assert.strictEqual(result.repo, "my.repo");
    });

    test("handles repo names with multiple dots: config.sync.test.git", () => {
      const result = parseGitUrl("https://github.com/org/config.sync.test.git");
      assert.strictEqual(result.repo, "config.sync.test");
    });

    test("handles repo names with dots without .git suffix", () => {
      const result = parseGitUrl("git@github.com:owner/repo.name");
      assert.strictEqual(result.repo, "repo.name");
    });

    test("handles repo names with hyphens: my-repo", () => {
      const result = parseGitUrl("git@github.com:owner/my-repo.git");
      assert.strictEqual(result.repo, "my-repo");
    });

    test("handles repo names with underscores: my_repo", () => {
      const result = parseGitUrl("git@github.com:owner/my_repo.git");
      assert.strictEqual(result.repo, "my_repo");
    });

    test("throws for invalid GitHub URLs", () => {
      assert.throws(
        () => parseGitUrl("git@github.com:invalid"),
        /Unable to parse GitHub URL/,
      );
    });
  });

  describe("Azure DevOps URLs", () => {
    test("parses SSH format: git@ssh.dev.azure.com:v3/org/project/repo", () => {
      const result = parseGitUrl(
        "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      );
      assert.strictEqual(result.type, "azure-devops");
      assert.strictEqual(result.organization, "myorg");
      assert.strictEqual(result.project, "myproject");
      assert.strictEqual(result.repo, "myrepo");
      assert.strictEqual(result.owner, "myorg");
    });

    test("parses HTTPS format: https://dev.azure.com/org/project/_git/repo", () => {
      const result = parseGitUrl(
        "https://dev.azure.com/myorg/myproject/_git/myrepo",
      );
      assert.strictEqual(result.type, "azure-devops");
      assert.strictEqual(result.organization, "myorg");
      assert.strictEqual(result.project, "myproject");
      assert.strictEqual(result.repo, "myrepo");
    });

    test("handles repo names with dots in Azure DevOps", () => {
      const result = parseGitUrl(
        "git@ssh.dev.azure.com:v3/org/project/my.repo.name",
      );
      assert.strictEqual(result.repo, "my.repo.name");
    });

    test("handles repo names with dots and .git suffix in Azure DevOps", () => {
      const result = parseGitUrl(
        "https://dev.azure.com/org/project/_git/my.repo.git",
      );
      assert.strictEqual(result.repo, "my.repo");
    });

    test("handles project names with hyphens", () => {
      const result = parseGitUrl(
        "https://dev.azure.com/org/my-project/_git/repo",
      );
      assert.strictEqual(result.project, "my-project");
    });

    test("throws for invalid Azure DevOps URLs", () => {
      assert.throws(
        () => parseGitUrl("git@ssh.dev.azure.com:invalid"),
        /Unable to parse Azure DevOps URL/,
      );
    });
  });

  describe("GitLab URLs", () => {
    test("parses SaaS SSH format: git@gitlab.com:owner/repo.git", () => {
      const result = parseGitUrl("git@gitlab.com:owner/repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "owner");
        assert.strictEqual(result.namespace, "owner");
        assert.strictEqual(result.repo, "repo");
        assert.strictEqual(result.host, "gitlab.com");
      }
    });

    test("parses SaaS SSH format without .git suffix", () => {
      const result = parseGitUrl("git@gitlab.com:owner/repo");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "owner");
        assert.strictEqual(result.repo, "repo");
      }
    });

    test("parses SaaS HTTPS format: https://gitlab.com/owner/repo.git", () => {
      const result = parseGitUrl("https://gitlab.com/owner/repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "owner");
        assert.strictEqual(result.namespace, "owner");
        assert.strictEqual(result.repo, "repo");
        assert.strictEqual(result.host, "gitlab.com");
      }
    });

    test("parses SaaS HTTPS format without .git suffix", () => {
      const result = parseGitUrl("https://gitlab.com/owner/repo");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "owner");
        assert.strictEqual(result.repo, "repo");
      }
    });

    test("parses nested group SSH: git@gitlab.com:org/group/subgroup/repo.git", () => {
      const result = parseGitUrl("git@gitlab.com:org/group/subgroup/repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "org");
        assert.strictEqual(result.namespace, "org/group/subgroup");
        assert.strictEqual(result.repo, "repo");
        assert.strictEqual(result.host, "gitlab.com");
      }
    });

    test("parses nested group HTTPS: https://gitlab.com/org/group/subgroup/repo.git", () => {
      const result = parseGitUrl(
        "https://gitlab.com/org/group/subgroup/repo.git",
      );
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.owner, "org");
        assert.strictEqual(result.namespace, "org/group/subgroup");
        assert.strictEqual(result.repo, "repo");
        assert.strictEqual(result.host, "gitlab.com");
      }
    });

    test("parses self-hosted SSH: git@gitlab.example.com:owner/repo.git", () => {
      const result = parseGitUrl("git@gitlab.example.com:owner/repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.host, "gitlab.example.com");
        assert.strictEqual(result.namespace, "owner");
        assert.strictEqual(result.repo, "repo");
      }
    });

    test("parses self-hosted HTTPS: https://gitlab.example.com/owner/repo.git", () => {
      const result = parseGitUrl("https://gitlab.example.com/owner/repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.host, "gitlab.example.com");
        assert.strictEqual(result.namespace, "owner");
        assert.strictEqual(result.repo, "repo");
      }
    });

    test("handles repo names with dots: my.repo.git", () => {
      const result = parseGitUrl("git@gitlab.com:owner/my.repo.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.repo, "my.repo");
      }
    });

    test("handles repo names with multiple dots", () => {
      const result = parseGitUrl("https://gitlab.com/org/config.sync.test.git");
      assert.strictEqual(result.type, "gitlab");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.repo, "config.sync.test");
      }
    });

    test("handles repo names with hyphens: my-repo", () => {
      const result = parseGitUrl("git@gitlab.com:owner/my-repo.git");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.repo, "my-repo");
      }
    });

    test("handles repo names with underscores: my_repo", () => {
      const result = parseGitUrl("git@gitlab.com:owner/my_repo.git");
      if (isGitLabRepo(result)) {
        assert.strictEqual(result.repo, "my_repo");
      }
    });
  });
});

describe("getRepoDisplayName", () => {
  test("formats GitHub repos as owner/repo", () => {
    const result = getRepoDisplayName({
      type: "github",
      gitUrl: "git@github.com:owner/repo.git",
      owner: "owner",
      repo: "repo",
    });
    assert.strictEqual(result, "owner/repo");
  });

  test("formats Azure repos as org/project/repo", () => {
    const result = getRepoDisplayName({
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "project",
    });
    assert.strictEqual(result, "org/project/repo");
  });

  test("formats GitLab repos as namespace/repo", () => {
    const result = getRepoDisplayName({
      type: "gitlab",
      gitUrl: "git@gitlab.com:owner/repo.git",
      owner: "owner",
      namespace: "owner",
      repo: "repo",
      host: "gitlab.com",
    });
    assert.strictEqual(result, "owner/repo");
  });

  test("formats GitLab repos with nested groups as full namespace/repo", () => {
    const result = getRepoDisplayName({
      type: "gitlab",
      gitUrl: "git@gitlab.com:org/group/subgroup/repo.git",
      owner: "org",
      namespace: "org/group/subgroup",
      repo: "repo",
      host: "gitlab.com",
    });
    assert.strictEqual(result, "org/group/subgroup/repo");
  });
});
