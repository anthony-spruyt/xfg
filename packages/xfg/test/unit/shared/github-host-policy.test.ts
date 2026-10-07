import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ALLOWED_GITHUB_HOSTS_ENV,
  GitHubHostPolicy,
  createGitHubHostPolicyFromEnv,
  isIpLiteral,
  isValidHostname,
  parseAllowedGitHubHosts,
} from "../../../src/shared/github-host-policy.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("isValidHostname", () => {
  test("accepts DNS hostnames", () => {
    for (const host of [
      "github.com",
      "ghe.corp",
      "github.mycompany.com",
      "a-b.example.net",
      "ghe",
    ]) {
      assert.equal(isValidHostname(host), true, host);
    }
  });

  test("rejects userinfo, ports, paths, schemes and whitespace", () => {
    for (const host of [
      "",
      "user@ghe.corp",
      "ghe.corp:8443",
      "ghe.corp/api",
      "https://ghe.corp",
      "ghe corp",
      " ghe.corp",
      "ghe.corp\n",
      "ghe.corp.",
      ".ghe.corp",
      "-ghe.corp",
      "ghe-.corp",
      "ghe..corp",
      "[::1]",
      "::1",
      "ghe_corp.com",
      `${"a".repeat(64)}.com`,
    ]) {
      assert.equal(isValidHostname(host), false, JSON.stringify(host));
    }
  });
});

describe("isIpLiteral", () => {
  test("detects IPv4 and IPv6 literals", () => {
    for (const host of ["192.0.2.10", "127.0.0.1", "1.2.3", "::1", "[::1]"]) {
      assert.equal(isIpLiteral(host), true, host);
    }
  });

  test("does not flag hostnames", () => {
    for (const host of ["github.com", "10.example.com", "ghe1"]) {
      assert.equal(isIpLiteral(host), false, host);
    }
  });
});

describe("parseAllowedGitHubHosts", () => {
  test("returns no hosts when unset or blank", () => {
    assert.deepEqual(parseAllowedGitHubHosts(undefined), []);
    assert.deepEqual(parseAllowedGitHubHosts(""), []);
    assert.deepEqual(parseAllowedGitHubHosts("  "), []);
  });

  test("splits on commas and whitespace and lowercases", () => {
    assert.deepEqual(
      parseAllowedGitHubHosts("GHE.corp, github.mycompany.com\nother.net"),
      ["ghe.corp", "github.mycompany.com", "other.net"]
    );
  });

  test("rejects entries that are not hostnames", () => {
    for (const value of [
      "user@ghe.corp",
      "ghe.corp:8443",
      "https://ghe.corp",
      "ghe.corp/api",
    ]) {
      assert.throws(
        () => parseAllowedGitHubHosts(value),
        (err: unknown) =>
          err instanceof ValidationError &&
          err.message.includes(ALLOWED_GITHUB_HOSTS_ENV),
        value
      );
    }
  });

  test("rejects IP literals", () => {
    assert.throws(() => parseAllowedGitHubHosts("192.0.2.10"), /IP address/);
  });
});

describe("GitHubHostPolicy", () => {
  test("allows github.com by default and nothing else", () => {
    const policy = new GitHubHostPolicy();
    assert.equal(policy.isAllowed("github.com"), true);
    assert.equal(policy.isAllowed("GitHub.com"), true);
    assert.equal(policy.isAllowed("ghe.corp"), false);
    assert.equal(policy.isAllowed("attacker.example"), false);
  });

  test("allows explicitly listed hosts, case-insensitively", () => {
    const policy = new GitHubHostPolicy(["ghe.corp"]);
    assert.equal(policy.isAllowed("ghe.corp"), true);
    assert.equal(policy.isAllowed("GHE.Corp"), true);
    assert.equal(policy.isAllowed("github.com"), true);
  });

  test("does not match look-alike hosts", () => {
    const policy = new GitHubHostPolicy(["ghe.corp"]);
    for (const host of [
      "ghe.corp:443",
      "user@ghe.corp",
      "ghe.corp.attacker.example",
      "xghe.corp",
      "github.com.attacker.example",
      "github.com:443",
      "user@github.com",
    ]) {
      assert.equal(policy.isAllowed(host), false, host);
    }
  });
});

describe("createGitHubHostPolicyFromEnv", () => {
  test("reads extra hosts from the env var", () => {
    const policy = createGitHubHostPolicyFromEnv({
      [ALLOWED_GITHUB_HOSTS_ENV]: "ghe.corp",
    });
    assert.equal(policy.isAllowed("ghe.corp"), true);
  });

  test("defaults to github.com only", () => {
    const policy = createGitHubHostPolicyFromEnv({});
    assert.equal(policy.isAllowed("github.com"), true);
    assert.equal(policy.isAllowed("ghe.corp"), false);
  });

  test("throws on an invalid entry", () => {
    assert.throws(
      () =>
        createGitHubHostPolicyFromEnv({
          [ALLOWED_GITHUB_HOSTS_ENV]: "ghe.corp:8443",
        }),
      ValidationError
    );
  });
});
