import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import type {
  IRepoLifecycleFactory,
  IRepoLifecycleProvider,
  IMigrationSource,
  LifecyclePlatform,
} from "./types.js";
import { GitHubLifecycleProvider } from "./github-lifecycle-provider.js";
import { AdoMigrationSource } from "./ado-migration-source.js";

/**
 * Factory for creating lifecycle providers and migration sources.
 */
export class RepoLifecycleFactory implements IRepoLifecycleFactory {
  private readonly providers: Map<LifecyclePlatform, IRepoLifecycleProvider> =
    new Map();
  private readonly sources: Map<LifecyclePlatform, IMigrationSource> =
    new Map();

  private readonly executor: ICommandExecutor;
  private readonly retries: number;

  constructor(executor?: ICommandExecutor, retries?: number) {
    this.executor = executor ?? defaultExecutor;
    this.retries = retries ?? 3;
  }

  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider {
    // Check cache first
    const cached = this.providers.get(platform);
    if (cached) {
      return cached;
    }

    // Create provider
    let provider: IRepoLifecycleProvider;
    switch (platform) {
      case "github":
        provider = new GitHubLifecycleProvider({
          executor: this.executor,
          retries: this.retries,
        });
        break;
      default:
        throw new Error(
          `Platform '${platform}' not supported as target for lifecycle operations. ` +
            `Currently supported: github`
        );
    }

    this.providers.set(platform, provider);
    return provider;
  }

  getMigrationSource(platform: LifecyclePlatform): IMigrationSource {
    // Check cache first
    const cached = this.sources.get(platform);
    if (cached) {
      return cached;
    }

    // Create source
    let source: IMigrationSource;
    switch (platform) {
      case "azure-devops":
        source = new AdoMigrationSource(this.executor, this.retries);
        break;
      default:
        throw new Error(
          `Platform '${platform}' not supported as migration source. ` +
            `Currently supported: azure-devops`
        );
    }

    this.sources.set(platform, source);
    return source;
  }
}
