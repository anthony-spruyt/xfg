#!/usr/bin/env node

/**
 * Test runner script that discovers and runs all test files in src/
 * This provides automatic test discovery without manual file listing
 * Requires Node.js 22+ for globSync support
 */

import { run } from "node:test";
import { spec as SpecReporter } from "node:test/reporters";
import { globSync } from "node:fs";

// Find all test files in src/ directory (excluding integration tests in test/)
const testFiles = globSync("src/**/*.test.ts", { windowsPathsNoEscape: true });

if (testFiles.length === 0) {
  console.error("No test files found in src/");
  process.exit(1);
}

// Run tests with spec reporter
run({ files: testFiles })
  .on("test:fail", () => {
    process.exitCode = 1;
  })
  .compose(new SpecReporter())
  .pipe(process.stdout);
