import { ICommandExecutor } from "../shared/command-executor.js";
import { LifecycleError } from "../shared/errors.js";
import type { DebugWarnLog } from "../shared/logger.js";
import type {
  IRepoLifecycleFactory,
  IRepoLifecycleProvider,
  IMigrationSource,
  LifecyclePlatform,
} from "./types.js";
import { GitHubLifecycleProvider } from "./github-lifecycle-provider.js";
import { AdoMigrationSource } from "./ado-migration-source.js";

export class RepoLifecycleFactory implements IRepoLifecycleFactory {
  private readonly providers: Map<LifecyclePlatform, IRepoLifecycleProvider> =
    new Map();
  private readonly sources: Map<LifecyclePlatform, IMigrationSource> =
    new Map();

  private readonly executor: ICommandExecutor;
  private readonly retries: number;
  private readonly cwd: string;
  private readonly log?: DebugWarnLog;

  constructor(
    executor: ICommandExecutor,
    retries: number | undefined,
    cwd: string,
    log?: DebugWarnLog
  ) {
    this.executor = executor;
    this.retries = retries ?? 3;
    this.cwd = cwd;
    this.log = log;
  }

  getProvider(platform: LifecyclePlatform): IRepoLifecycleProvider {
    const cached = this.providers.get(platform);
    if (cached) {
      return cached;
    }

    let provider: IRepoLifecycleProvider;
    switch (platform) {
      case "github":
        provider = new GitHubLifecycleProvider({
          executor: this.executor,
          retries: this.retries,
          cwd: this.cwd,
          log: this.log,
        });
        break;
      default:
        throw new LifecycleError(
          `Platform '${platform}' not supported as target for lifecycle operations. ` +
            `Currently supported: github`
        );
    }

    this.providers.set(platform, provider);
    return provider;
  }

  getMigrationSource(platform: LifecyclePlatform): IMigrationSource {
    const cached = this.sources.get(platform);
    if (cached) {
      return cached;
    }

    let source: IMigrationSource;
    switch (platform) {
      case "azure-devops":
        source = new AdoMigrationSource(this.executor, this.retries, this.cwd);
        break;
      default:
        throw new LifecycleError(
          `Platform '${platform}' not supported as migration source. ` +
            `Currently supported: azure-devops`
        );
    }

    this.sources.set(platform, source);
    return source;
  }
}
