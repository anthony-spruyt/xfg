import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { docFiles, repoRoot } from "../../../scripts/docs/generate-docs.js";

const PIN = /anthony-spruyt\/xfg@v(\d+)/;
const MARKER = "x-release-please-major";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf-8")) as T;
}

const manifest = readJson<Record<string, string>>(
  ".release-please-manifest.json"
);
const releaseConfig = readJson<{
  packages: Record<string, { "extra-files"?: string[] }>;
}>("release-please-config.json");

const major = Number(manifest["packages/xfg"].split(".")[0]);
const extraFiles = new Set(
  releaseConfig.packages["packages/xfg"]["extra-files"] ?? []
);

interface Pin {
  file: string;
  line: number;
  text: string;
  major: number;
}

const pins: Pin[] = docFiles()
  .filter((file) => !/migration-v\d+\.md$/.test(file))
  .flatMap((file) =>
    readFileSync(file, "utf-8")
      .split("\n")
      .flatMap((text, index) => {
        const match = PIN.exec(text);
        if (!match) return [];
        return [
          {
            file: relative(repoRoot, file),
            line: index + 1,
            text,
            major: Number(match[1]),
          },
        ];
      })
  );

describe("action version pins", () => {
  test("the release manifest has a usable major", () => {
    assert.ok(Number.isInteger(major) && major > 0, `bad major: ${major}`);
  });

  test("docs contain at least one pin", () => {
    assert.ok(pins.length > 0, "expected @vN pins in README.md or docs/");
  });

  for (const pin of pins) {
    const where = `${pin.file}:${pin.line}`;

    test(`${where} pins the released major`, () => {
      assert.equal(
        pin.major,
        major,
        `${where} pins v${pin.major} but the release manifest is at v${major}`
      );
    });

    test(`${where} carries the release-please marker`, () => {
      assert.ok(
        pin.text.includes(MARKER),
        `${where} has no ${MARKER} comment, so release-please will never bump it`
      );
    });

    test(`${where} is listed in release-please extra-files`, () => {
      assert.ok(
        extraFiles.has(`/${pin.file}`),
        `/${pin.file} must be listed under extra-files in release-please-config.json`
      );
    });
  }
});
