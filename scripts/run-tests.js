#!/usr/bin/env node

/**
 * Test runner script that discovers and runs all test files in src/
 * This provides automatic test discovery without manual file listing
 * Requires Node.js 22+ for globSync support
 */

import { run } from "node:test";
import { spec as SpecReporter } from "node:test/reporters";
import { globSync } from "node:fs";

// Find all unit test files in test/unit/ directory
const testFiles = globSync("test/unit/**/*.test.ts", {
  windowsPathsNoEscape: true,
});

if (testFiles.length === 0) {
  console.error("No test files found in src/");
  process.exit(1);
}

// Run tests with spec reporter
// Enable file-level parallelism for faster execution
run({ files: testFiles, concurrency: true })
  .on("test:fail", () => {
    process.exitCode = 1;
  })
  .compose(new SpecReporter())
  .pipe(process.stdout);
