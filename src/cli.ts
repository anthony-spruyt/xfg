#!/usr/bin/env node

import { program } from "./index.js";

// Handle backwards compatibility: if no subcommand is provided, default to sync
// This maintains compatibility with existing usage like `xfg -c config.yaml`
const args = process.argv.slice(2);
const subcommands = ["sync", "protect", "help"];
const versionFlags = ["-V", "--version"];

// Check if the first argument is a subcommand or version flag
const firstArg = args[0];
const isSubcommand = firstArg && subcommands.includes(firstArg);
const isVersionFlag = firstArg && versionFlags.includes(firstArg);

if (isSubcommand || isVersionFlag) {
  // Explicit subcommand or version flag - parse normally
  program.parse();
} else {
  // No subcommand - prepend 'sync' for backwards compatibility
  // This handles: `xfg -c config.yaml`, `xfg --help`, `xfg` (no args)
  program.parse(["node", "xfg", "sync", ...args]);
}
