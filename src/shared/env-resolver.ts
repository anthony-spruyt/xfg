import { ValidationError } from "./errors.js";

export interface IEnvResolver {
  resolve(envName: string): string;
  resolveAll(entries: { name: string; envVar: string }[]): Map<string, string>;
}

export class EnvResolver implements IEnvResolver {
  private readonly env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined>) {
    this.env = env;
  }

  resolve(envName: string): string {
    const value = this.env[envName];
    if (value === undefined) {
      throw new ValidationError(
        `Environment variable '${envName}' is not set.`
      );
    }
    if (value === "") {
      throw new ValidationError(`Environment variable '${envName}' is empty.`);
    }
    return value;
  }

  resolveAll(entries: { name: string; envVar: string }[]): Map<string, string> {
    const missing = new Set<string>();
    const result = new Map<string, string>();

    for (const { name, envVar } of entries) {
      const value = this.env[envVar];
      if (value === undefined || value === "") {
        missing.add(envVar);
      } else {
        result.set(name, value);
      }
    }

    if (missing.size > 0) {
      throw new ValidationError(
        `Missing environment variables: ${[...missing].join(", ")}`
      );
    }

    return result;
  }
}
