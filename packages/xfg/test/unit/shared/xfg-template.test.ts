import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  interpolateXfgContent,
  type XfgTemplateContext,
} from "../../../src/shared/xfg-template.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../../../src/repo/index.js";

// Helper to create a GitHub repo context
function createGitHubContext(
  overrides: Partial<{
    owner: string;
    repo: string;
    host: string;
    fileName: string;
    vars: Record<string, string>;
  }> = {}
): XfgTemplateContext {
  const repoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: `git@${overrides.host ?? "github.com"}:${overrides.owner ?? "my-org"}/${overrides.repo ?? "my-repo"}.git`,
    owner: overrides.owner ?? "my-org",
    repo: overrides.repo ?? "my-repo",
    host: overrides.host ?? "github.com",
  };
  return {
    repoInfo,
    fileName: overrides.fileName ?? "config.json",
    vars: overrides.vars,
  };
}

// Helper to create an Azure DevOps repo context
function createAzureDevOpsContext(
  overrides: Partial<{
    organization: string;
    project: string;
    repo: string;
    fileName: string;
    vars: Record<string, string>;
  }> = {}
): XfgTemplateContext {
  const org = overrides.organization ?? "my-org";
  const proj = overrides.project ?? "my-project";
  const repo = overrides.repo ?? "my-repo";
  const repoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: `git@ssh.dev.azure.com:v3/${org}/${proj}/${repo}`,
    owner: org,
    repo,
    organization: org,
    project: proj,
  };
  return {
    repoInfo,
    fileName: overrides.fileName ?? "config.json",
    vars: overrides.vars,
  };
}

// Helper to create a GitLab repo context
function createGitLabContext(
  overrides: Partial<{
    namespace: string;
    owner: string;
    repo: string;
    host: string;
    fileName: string;
    vars: Record<string, string>;
  }> = {}
): XfgTemplateContext {
  const ns = overrides.namespace ?? "my-org";
  const repo = overrides.repo ?? "my-repo";
  const host = overrides.host ?? "gitlab.com";
  const repoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: `git@${host}:${ns}/${repo}.git`,
    owner: overrides.owner ?? ns.split("/")[0],
    repo,
    namespace: ns,
    host,
  };
  return {
    repoInfo,
    fileName: overrides.fileName ?? "config.json",
    vars: overrides.vars,
  };
}

describe("interpolateXfgContent - built-in variables", () => {
  describe("GitHub repos", () => {
    test("${xfg:repo.name} returns repository name", () => {
      const ctx = createGitHubContext({ repo: "awesome-service" });
      const result = interpolateXfgContent("Name: ${xfg:repo.name}", ctx);
      assert.equal(result, "Name: awesome-service");
      assert.equal(typeof result, "string");
    });

    test("${xfg:repo.owner} returns owner", () => {
      const ctx = createGitHubContext({ owner: "acme-corp" });
      const result = interpolateXfgContent("Owner: ${xfg:repo.owner}", ctx);
      assert.equal(result, "Owner: acme-corp");
      assert.ok(!result.includes("${xfg:"));
    });

    test("${xfg:repo.fullName} returns owner/repo", () => {
      const ctx = createGitHubContext({
        owner: "acme-corp",
        repo: "my-service",
      });
      const result = interpolateXfgContent("Full: ${xfg:repo.fullName}", ctx);
      assert.equal(result, "Full: acme-corp/my-service");
      assert.ok((result as string).includes("/"));
    });

    test("${xfg:repo.url} returns git URL", () => {
      const ctx = createGitHubContext({ owner: "acme", repo: "test" });
      const result = interpolateXfgContent("URL: ${xfg:repo.url}", ctx);
      assert.equal(result, "URL: git@github.com:acme/test.git");
      assert.ok((result as string).endsWith(".git"));
    });

    test("${xfg:repo.platform} returns github", () => {
      const ctx = createGitHubContext();
      const result = interpolateXfgContent(
        "Platform: ${xfg:repo.platform}",
        ctx
      );
      assert.equal(result, "Platform: github");
      assert.ok(!result.includes("azure"));
    });

    test("${xfg:repo.host} returns host domain", () => {
      const ctx = createGitHubContext({ host: "github.acme.com" });
      const result = interpolateXfgContent("Host: ${xfg:repo.host}", ctx);
      assert.equal(result, "Host: github.acme.com");
      assert.ok((result as string).includes("."));
    });
  });

  describe("Azure DevOps repos", () => {
    test("${xfg:repo.name} returns repository name", () => {
      const ctx = createAzureDevOpsContext({ repo: "backend-api" });
      const result = interpolateXfgContent("Name: ${xfg:repo.name}", ctx);
      assert.equal(result, "Name: backend-api");
      assert.equal(typeof result, "string");
    });

    test("${xfg:repo.owner} returns organization", () => {
      const ctx = createAzureDevOpsContext({ organization: "contoso" });
      const result = interpolateXfgContent("Owner: ${xfg:repo.owner}", ctx);
      assert.equal(result, "Owner: contoso");
      assert.ok(!result.includes("${xfg:"));
    });

    test("${xfg:repo.fullName} returns org/project/repo", () => {
      const ctx = createAzureDevOpsContext({
        organization: "contoso",
        project: "platform",
        repo: "api",
      });
      const result = interpolateXfgContent("Full: ${xfg:repo.fullName}", ctx);
      assert.equal(result, "Full: contoso/platform/api");
      assert.equal((result as string).split("/").length - 1, 2);
    });

    test("${xfg:repo.platform} returns azure-devops", () => {
      const ctx = createAzureDevOpsContext();
      const result = interpolateXfgContent(
        "Platform: ${xfg:repo.platform}",
        ctx
      );
      assert.equal(result, "Platform: azure-devops");
      assert.ok((result as string).includes("azure"));
    });

    test("${xfg:repo.host} returns dev.azure.com", () => {
      const ctx = createAzureDevOpsContext();
      const result = interpolateXfgContent("Host: ${xfg:repo.host}", ctx);
      assert.equal(result, "Host: dev.azure.com");
      assert.ok((result as string).includes("azure"));
    });
  });

  describe("GitLab repos", () => {
    test("${xfg:repo.name} returns repository name", () => {
      const ctx = createGitLabContext({ repo: "frontend-app" });
      const result = interpolateXfgContent("Name: ${xfg:repo.name}", ctx);
      assert.equal(result, "Name: frontend-app");
      assert.equal(typeof result, "string");
    });

    test("${xfg:repo.owner} returns first namespace segment", () => {
      const ctx = createGitLabContext({
        namespace: "acme/infra",
        owner: "acme",
      });
      const result = interpolateXfgContent("Owner: ${xfg:repo.owner}", ctx);
      assert.equal(result, "Owner: acme");
      assert.ok(!result.includes("/"));
    });

    test("${xfg:repo.fullName} returns namespace/repo", () => {
      const ctx = createGitLabContext({
        namespace: "acme/infra",
        repo: "terraform",
      });
      const result = interpolateXfgContent("Full: ${xfg:repo.fullName}", ctx);
      assert.equal(result, "Full: acme/infra/terraform");
      assert.ok((result as string).includes("acme/infra"));
    });

    test("${xfg:repo.platform} returns gitlab", () => {
      const ctx = createGitLabContext();
      const result = interpolateXfgContent(
        "Platform: ${xfg:repo.platform}",
        ctx
      );
      assert.equal(result, "Platform: gitlab");
      assert.ok(!result.includes("github"));
    });

    test("${xfg:repo.host} returns host domain", () => {
      const ctx = createGitLabContext({ host: "gitlab.acme.io" });
      const result = interpolateXfgContent("Host: ${xfg:repo.host}", ctx);
      assert.equal(result, "Host: gitlab.acme.io");
      assert.ok((result as string).includes("gitlab"));
    });
  });

  describe("file and date variables", () => {
    test("${xfg:file.name} returns current file name", () => {
      const ctx = createGitHubContext({ fileName: "README.md" });
      const result = interpolateXfgContent("File: ${xfg:file.name}", ctx);
      assert.equal(result, "File: README.md");
      assert.ok(!result.includes("${xfg:"));
    });

    test("${xfg:date} returns current date in YYYY-MM-DD format", () => {
      const ctx = createGitHubContext();
      const result = interpolateXfgContent("Date: ${xfg:date}", ctx) as string;
      assert.match(result, /^Date: \d{4}-\d{2}-\d{2}$/);
      const datePart = result.replace("Date: ", "");
      assert.ok(!isNaN(Date.parse(datePart)));
    });
  });
});

describe("interpolateXfgContent - custom variables", () => {
  test("custom var takes precedence over built-in", () => {
    const ctx = createGitHubContext({ vars: { "repo.name": "custom-name" } });
    const result = interpolateXfgContent("Name: ${xfg:repo.name}", ctx);
    assert.equal(result, "Name: custom-name");
    assert.notEqual(result, "Name: my-repo");
  });

  test("custom var is resolved", () => {
    const ctx = createGitHubContext({ vars: { myVar: "custom-value" } });
    const result = interpolateXfgContent("Value: ${xfg:myVar}", ctx);
    assert.equal(result, "Value: custom-value");
    assert.ok(!result.includes("${xfg:"));
  });

  test("multiple custom vars", () => {
    const ctx = createGitHubContext({
      vars: { env: "production", region: "us-east-1" },
    });
    const result = interpolateXfgContent("${xfg:env}-${xfg:region}", ctx);
    assert.equal(result, "production-us-east-1");
    assert.ok((result as string).includes("production"));
    assert.ok((result as string).includes("us-east-1"));
  });

  test("mix of custom and built-in vars", () => {
    const ctx = createGitHubContext({
      repo: "my-service",
      vars: { env: "prod" },
    });
    const result = interpolateXfgContent("${xfg:repo.name}-${xfg:env}", ctx);
    assert.equal(result, "my-service-prod");
    assert.ok((result as string).includes("-"));
  });
});

describe("interpolateXfgContent - escape mechanism", () => {
  test("$${xfg:var} outputs literal ${xfg:var}", () => {
    const ctx = createGitHubContext();
    const result = interpolateXfgContent("Escaped: $${xfg:repo.name}", ctx);
    assert.equal(result, "Escaped: ${xfg:repo.name}");
    assert.ok((result as string).includes("${xfg:"));
  });

  test("mixed escaped and interpolated", () => {
    const ctx = createGitHubContext({ repo: "my-repo" });
    const result = interpolateXfgContent(
      "${xfg:repo.name} and $${xfg:not.interpolated}",
      ctx
    );
    assert.equal(result, "my-repo and ${xfg:not.interpolated}");
    assert.ok((result as string).startsWith("my-repo"));
    assert.ok((result as string).includes("${xfg:not.interpolated}"));
  });

  test("multiple escaped vars", () => {
    const ctx = createGitHubContext();
    const result = interpolateXfgContent("$${xfg:a} and $${xfg:b}", ctx);
    assert.equal(result, "${xfg:a} and ${xfg:b}");
    assert.ok(!(result as string).includes("$$"));
  });

  test("consecutive escaped vars", () => {
    const ctx = createGitHubContext();
    const result = interpolateXfgContent("$${xfg:a}$${xfg:b}", ctx);
    assert.equal(result, "${xfg:a}${xfg:b}");
    assert.ok(!(result as string).includes("$$"));
  });
});

describe("interpolateXfgContent - strict mode", () => {
  test("throws on unknown var in strict mode", () => {
    const ctx = createGitHubContext();
    assert.throws(
      () => interpolateXfgContent("${xfg:unknown.var}", ctx, { strict: true }),
      /Unknown xfg template variable: unknown.var/
    );
    assert.doesNotThrow(() =>
      interpolateXfgContent("${xfg:repo.name}", ctx, { strict: true })
    );
  });

  test("leaves placeholder in non-strict mode", () => {
    const ctx = createGitHubContext();
    const result = interpolateXfgContent("${xfg:unknown.var}", ctx, {
      strict: false,
    });
    assert.equal(result, "${xfg:unknown.var}");
    assert.ok((result as string).includes("${xfg:"));
  });

  test("default is strict mode", () => {
    const ctx = createGitHubContext();
    assert.throws(
      () => interpolateXfgContent("${xfg:missing}", ctx),
      /Unknown xfg template variable: missing/
    );
    assert.doesNotThrow(() => interpolateXfgContent("${xfg:repo.name}", ctx));
  });
});

describe("interpolateXfgContent - content types", () => {
  describe("string content", () => {
    test("simple string interpolation", () => {
      const ctx = createGitHubContext({ repo: "test" });
      const result = interpolateXfgContent("repo: ${xfg:repo.name}", ctx);
      assert.equal(result, "repo: test");
      assert.equal(typeof result, "string");
    });

    test("multiple vars in string", () => {
      const ctx = createGitHubContext({ owner: "org", repo: "repo" });
      const result = interpolateXfgContent(
        "${xfg:repo.owner}/${xfg:repo.name}",
        ctx
      );
      assert.equal(result, "org/repo");
      assert.ok(!result.includes("${xfg:"));
    });

    test("multiline string", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const result = interpolateXfgContent(
        "line1\n${xfg:repo.name}\nline3",
        ctx
      );
      assert.equal(result, "line1\nmy-repo\nline3");
      assert.equal((result as string).split("\n").length, 3);
    });
  });

  describe("string array content", () => {
    test("interpolates each line", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const result = interpolateXfgContent(
        ["${xfg:repo.name}", "static", "${xfg:repo.platform}"],
        ctx
      );
      assert.deepEqual(result, ["my-repo", "static", "github"]);
      assert.ok(Array.isArray(result));
      assert.equal((result as string[]).length, 3);
    });

    test("handles empty array", () => {
      const ctx = createGitHubContext();
      const result = interpolateXfgContent([], ctx);
      assert.deepEqual(result, []);
      assert.ok(Array.isArray(result));
    });
  });

  describe("object content", () => {
    test("interpolates string values", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const result = interpolateXfgContent({ name: "${xfg:repo.name}" }, ctx);
      assert.deepEqual(result, { name: "my-repo" });
      assert.equal(typeof result, "object");
      assert.ok(!Array.isArray(result));
    });

    test("processes nested objects", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const input = {
        outer: {
          inner: {
            name: "${xfg:repo.name}",
          },
        },
      };
      const result = interpolateXfgContent(input, ctx);
      assert.deepEqual(result, {
        outer: { inner: { name: "my-repo" } },
      });
      assert.deepEqual(input.outer.inner.name, "${xfg:repo.name}");
    });

    test("processes arrays within objects", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const result = interpolateXfgContent(
        {
          items: ["${xfg:repo.name}", "static"],
        },
        ctx
      );
      assert.deepEqual(result, {
        items: ["my-repo", "static"],
      });
      assert.ok(Array.isArray((result as Record<string, unknown>).items));
    });

    test("leaves non-string values unchanged", () => {
      const ctx = createGitHubContext();
      const result = interpolateXfgContent(
        {
          number: 42,
          boolean: true,
          nullValue: null,
        } as Record<string, unknown>,
        ctx
      );
      assert.deepEqual(result, {
        number: 42,
        boolean: true,
        nullValue: null,
      });
      const obj = result as Record<string, unknown>;
      assert.equal(typeof obj.number, "number");
      assert.equal(typeof obj.boolean, "boolean");
    });

    test("handles arrays of objects", () => {
      const ctx = createGitHubContext({ repo: "my-repo" });
      const result = interpolateXfgContent(
        {
          repos: [{ name: "${xfg:repo.name}" }, { name: "static" }],
        },
        ctx
      );
      assert.deepEqual(result, {
        repos: [{ name: "my-repo" }, { name: "static" }],
      });
      const repos = (result as Record<string, unknown>).repos as Array<
        Record<string, string>
      >;
      assert.equal(repos.length, 2);
    });
  });
});

describe("interpolateXfgContent - real-world examples", () => {
  test("README template", () => {
    const ctx = createGitHubContext({
      owner: "acme-corp",
      repo: "backend-service",
      fileName: "README.md",
    });
    const template = `# \${xfg:repo.name}

Repository: \${xfg:repo.fullName}
Platform: \${xfg:repo.platform}

Managed by xfg.`;

    const result = interpolateXfgContent(template, ctx);
    assert.equal(
      result,
      `# backend-service

Repository: acme-corp/backend-service
Platform: github

Managed by xfg.`
    );
  });

  test("package.json template", () => {
    const ctx = createGitHubContext({
      owner: "my-org",
      repo: "my-package",
      host: "github.com",
    });
    const template = {
      name: "@${xfg:repo.owner}/${xfg:repo.name}",
      repository: {
        type: "git",
        url: "${xfg:repo.url}",
      },
    };

    const result = interpolateXfgContent(template, ctx);
    assert.deepEqual(result, {
      name: "@my-org/my-package",
      repository: {
        type: "git",
        url: "git@github.com:my-org/my-package.git",
      },
    });
  });

  test("CI workflow with environment", () => {
    const ctx = createGitHubContext({
      repo: "api-service",
      vars: { env: "staging", region: "us-west-2" },
    });
    const template = {
      name: "Deploy ${xfg:repo.name}",
      env: {
        ENVIRONMENT: "${xfg:env}",
        AWS_REGION: "${xfg:region}",
      },
    };

    const result = interpolateXfgContent(template, ctx);
    assert.deepEqual(result, {
      name: "Deploy api-service",
      env: {
        ENVIRONMENT: "staging",
        AWS_REGION: "us-west-2",
      },
    });
  });

  test("gitignore with mixed xfg and env variables", () => {
    const ctx = createGitHubContext({ repo: "my-repo" });
    // xfg template only processes ${xfg:...} patterns
    // Other patterns like ${HOME} or $${xfg:...} are left as-is
    const template = [
      "# ${xfg:repo.name} gitignore",
      "node_modules/",
      "${HOME}/.cache", // env var - left unchanged by xfg
      "*.log",
    ];

    const result = interpolateXfgContent(template, ctx);
    assert.deepEqual(result, [
      "# my-repo gitignore",
      "node_modules/",
      "${HOME}/.cache", // unchanged
      "*.log",
    ]);
  });
});
