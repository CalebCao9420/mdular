import type { PluginManifestV1 } from '@mdular/plugin-manifest';
import type {
  Disposable,
  MaybePromise,
  PluginContext,
  PluginModule,
  PluginServices,
  SubscriptionCollection,
} from '@mdular/plugin-sdk';

export type PluginRuntimeState = 'activating' | 'active' | 'deactivating';

export interface InProcessPluginHost {
  createServices(manifest: PluginManifestV1): MaybePromise<PluginServices>;
}

interface ActivePluginRecord {
  readonly manifest: PluginManifestV1;
  readonly module: PluginModule;
  readonly subscriptions: ManagedSubscriptions;
  state: PluginRuntimeState;
}

class ManagedSubscriptions implements SubscriptionCollection, Disposable {
  readonly #items: Disposable[] = [];
  #disposed = false;

  public add<TDisposable extends Disposable>(disposable: TDisposable): TDisposable {
    if (this.#disposed) { throw new Error('Cannot add a subscription after disposal'); }
    this.#items.push(disposable);
    return disposable;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) { return; }
    this.#disposed = true;

    const errors: unknown[] = [];
    for (const disposable of this.#items.reverse()) {
      try {
        await disposable.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#items.length = 0;
    throwCollectedErrors(errors, 'One or more plugin subscriptions failed to dispose');
  }
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (0 === errors.length) { return; }
  if (1 === errors.length) { throw errors[0]; }
  throw new AggregateError(errors, message);
}

/**
 * Lifecycle runner for trusted, already-bundled plugins.
 *
 * It is intentionally not a code loader or security sandbox. Installation, signature checks,
 * manifest validation, and permission brokering remain host responsibilities.
 */
export class InProcessPluginRuntime {
  readonly #host: InProcessPluginHost;
  readonly #records = new Map<string, ActivePluginRecord>();

  public constructor(host: InProcessPluginHost) {
    this.#host = host;
  }

  public getState(pluginId: string): PluginRuntimeState | undefined {
    return this.#records.get(pluginId)?.state;
  }

  public listActivePluginIds(): readonly string[] {
    return [...this.#records.keys()];
  }

  public async activate(manifest: PluginManifestV1, module: PluginModule): Promise<void> {
    if (this.#records.has(manifest.id)) {
      throw new Error(`Plugin is already active: ${manifest.id}`);
    }

    const subscriptions = new ManagedSubscriptions();
    const services = await this.#host.createServices(manifest);
    const context: PluginContext = {
      ...services,
      pluginId: manifest.id,
      subscriptions,
    };
    const record: ActivePluginRecord = {
      manifest,
      module,
      subscriptions,
      state: 'activating',
    };
    this.#records.set(manifest.id, record);

    try {
      const activationDisposable = await module.activate(context);
      if (activationDisposable) { subscriptions.add(activationDisposable); }
      record.state = 'active';
    } catch (activationError) {
      this.#records.delete(manifest.id);
      const errors: unknown[] = [activationError];
      try {
        await subscriptions.dispose();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      throwCollectedErrors(errors, `Plugin activation and cleanup failed: ${manifest.id}`);
    }
  }

  public async deactivate(pluginId: string): Promise<void> {
    const record = this.#records.get(pluginId);
    if (!record) { return; }
    record.state = 'deactivating';

    const errors: unknown[] = [];
    try {
      await record.module.deactivate?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      await record.subscriptions.dispose();
    } catch (error) {
      errors.push(error);
    }
    this.#records.delete(pluginId);
    throwCollectedErrors(errors, `Plugin deactivation failed: ${pluginId}`);
  }

  public async deactivateAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const pluginId of [...this.#records.keys()].reverse()) {
      try {
        await this.deactivate(pluginId);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCollectedErrors(errors, 'One or more plugins failed to deactivate');
  }
}
