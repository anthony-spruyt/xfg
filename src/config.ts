import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface RepoConfig {
  git: string;
  json: Record<string, unknown>;
}

export interface Config {
  fileName: string;
  repos: RepoConfig[];
}

export function loadConfig(filePath: string): Config {
  const content = readFileSync(filePath, 'utf-8');
  const config = parse(content) as Config;

  if (!config.fileName) {
    throw new Error('Config missing required field: fileName');
  }

  if (!config.repos || !Array.isArray(config.repos)) {
    throw new Error('Config missing required field: repos (must be an array)');
  }

  for (let i = 0; i < config.repos.length; i++) {
    const repo = config.repos[i];
    if (!repo.git) {
      throw new Error(`Repo at index ${i} missing required field: git`);
    }
    if (!repo.json) {
      throw new Error(`Repo at index ${i} missing required field: json`);
    }
  }

  return config;
}

export function convertJsonToString(json: Record<string, unknown>): string {
  return JSON.stringify(json, null, 2);
}
