#!/usr/bin/env node

import { program, getVersion } from "./cli/program.js";

program.version(getVersion());
program.parse();
