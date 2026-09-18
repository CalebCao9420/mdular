import { validatePluginManifest } from '@mdular/plugin-manifest';
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

export type PluginFailurePhase =
  | 'catalog'
  | 'load'
  | 'activate'
  | 'provider'
  | 'render'
  | 'deactivate';

export interface PluginRuntimeDiagnostic {
  readonly pluginId: string;
  readonly phase: PluginFailurePhase;
  readonly message: string;
}

export interface BundledPluginModule {
  readonly default: PluginModule;
  readonly pluginManifest: PluginManifestV1;
  readonly pluginContentHash: string;
}

export interface BundledPluginCatalogEntry {
  readonly manifest: PluginManifestV1;
  readonly entry: string;
  readonly contentHash: string;
  load(): Promise<BundledPluginModule>;
}

export type BundledPluginActivationResult =
  | { readonly pluginId: string; readonly kind: 'active' }
  | { readonly pluginId: string; readonly kind: 'disabled'; readonly message: string };

export interface InProcessPluginHost {
  createServices(manifest: PluginManifestV1): MaybePromise<PluginServices>;
  releaseServices?(pluginId: string): MaybePromise<void>;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(',')}]`; }
  if (null !== value && 'object' === typeof value) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateCatalogEntry(entry: BundledPluginCatalogEntry): PluginManifestV1 {
  const validation = validatePluginManifest(entry.manifest);
  if (!validation.ok) {
    throw new Error(`Invalid bundled manifest: ${validation.errors.join('; ')}`);
  }
  if (entry.entry !== validation.manifest.entry) {
    throw new Error('Bundled catalog entry basename does not match its manifest');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(entry.contentHash)) {
    throw new Error('Bundled catalog content hash is malformed');
  }
  return validation.manifest;
}

function validateLoadedModule(
  entry: BundledPluginCatalogEntry,
  loaded: BundledPluginModule,
): PluginModule {
  const loadedManifest = validatePluginManifest(loaded.pluginManifest);
  if (!loadedManifest.ok) {
    throw new Error(`Loaded plugin manifest is invalid: ${loadedManifest.errors.join('; ')}`);
  }
  if (canonicalJson(entry.manifest) !== canonicalJson(loadedManifest.manifest)) {
    throw new Error('Loaded plugin manifest does not match the bundled catalog');
  }
  if (entry.contentHash !== loaded.pluginContentHash) {
    throw new Error('Loaded plugin content hash does not match the bundled catalog');
  }
  if (!loaded.default || 'function' !== typeof loaded.default.activate) {
    throw new Error('Loaded plugin module has no activation entrypoint');
  }
  return loaded.default;
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
  readonly #disabled = new Set<string>();
  readonly #diagnostics: PluginRuntimeDiagnostic[] = [];

  public constructor(host: InProcessPluginHost) {
    this.#host = host;
  }

  public getState(pluginId: string): PluginRuntimeState | undefined {
    return this.#records.get(pluginId)?.state;
  }

  public listActivePluginIds(): readonly string[] {
    return [...this.#records.keys()];
  }

  public listDisabledPluginIds(): readonly string[] {
    return [...this.#disabled];
  }

  public listDiagnostics(): readonly PluginRuntimeDiagnostic[] {
    return [...this.#diagnostics];
  }

  public async disable(pluginId: string): Promise<void> {
    this.#disabled.add(pluginId);
    await this.deactivate(pluginId);
  }

  /** Explicit user/host action; enabling does not implicitly execute plugin code. */
  public enable(pluginId: string): void {
    this.#disabled.delete(pluginId);
  }

  public async activate(manifest: PluginManifestV1, module: PluginModule): Promise<void> {
    const validation = validatePluginManifest(manifest);
    if (!validation.ok) {
      throw new Error(`Plugin manifest is invalid: ${validation.errors.join('; ')}`);
    }
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
      try {
        await this.#host.releaseServices?.(manifest.id);
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      throwCollectedErrors(errors, `Plugin activation and cleanup failed: ${manifest.id}`);
    }
  }

  public async activateBundledCatalog(
    catalog: readonly BundledPluginCatalogEntry[],
  ): Promise<readonly BundledPluginActivationResult[]> {
    const results: BundledPluginActivationResult[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < catalog.length; index += 1) {
      const entry = catalog[index];
      const pluginId = entry?.manifest?.id ?? `catalog-entry-${index}`;
      try {
        if (!entry) { throw new Error('Bundled catalog contains an empty entry'); }
        const manifest = validateCatalogEntry(entry);
        if (seen.has(manifest.id)) {
          throw new Error(`Bundled catalog contains duplicate plugin ID: ${manifest.id}`);
        }
        seen.add(manifest.id);
        if (this.#disabled.has(manifest.id)) {
          results.push({
            pluginId: manifest.id,
            kind: 'disabled',
            message: 'Plugin remains disabled after an earlier failure',
          });
          continue;
        }
        if (this.#records.has(manifest.id)) {
          results.push({ pluginId: manifest.id, kind: 'active' });
          continue;
        }
        let loaded: BundledPluginModule;
        try {
          loaded = await entry.load();
        } catch (error) {
          throw this.#phaseError('load', error);
        }
        const module = validateLoadedModule(entry, loaded);
        try {
          await this.activate(manifest, module);
        } catch (error) {
          throw this.#phaseError('activate', error);
        }
        results.push({ pluginId: manifest.id, kind: 'active' });
      } catch (error) {
        const phase = this.#errorPhase(error);
        const message = errorMessage(error instanceof PluginPhaseError ? error.cause : error);
        this.#disabled.add(pluginId);
        this.#diagnostics.push({ pluginId, phase, message });
        if (this.#records.has(pluginId)) {
          try {
            await this.deactivate(pluginId);
          } catch (deactivationError) {
            this.#diagnostics.push({
              pluginId,
              phase: 'deactivate',
              message: errorMessage(deactivationError),
            });
          }
        }
        results.push({ pluginId, kind: 'disabled', message });
      }
    }
    return results;
  }

  public async reportFailure(
    pluginId: string,
    phase: Extract<PluginFailurePhase, 'provider' | 'render'>,
    error: unknown,
  ): Promise<void> {
    this.#disabled.add(pluginId);
    this.#diagnostics.push({ pluginId, phase, message: errorMessage(error) });
    try {
      await this.deactivate(pluginId);
    } catch (deactivationError) {
      this.#diagnostics.push({
        pluginId,
        phase: 'deactivate',
        message: errorMessage(deactivationError),
      });
    }
  }

  public async deactivate(pluginId: string): Promise<void> {
    const record = this.#records.get(pluginId);
    if (!record) {
      await this.#host.releaseServices?.(pluginId);
      return;
    }
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
    try {
      await this.#host.releaseServices?.(pluginId);
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

  #phaseError(phase: PluginFailurePhase, error: unknown): PluginPhaseError {
    return new PluginPhaseError(phase, error);
  }

  #errorPhase(error: unknown): PluginFailurePhase {
    return error instanceof PluginPhaseError ? error.phase : 'catalog';
  }
}

class PluginPhaseError extends Error {
  public readonly phase: PluginFailurePhase;
  public override readonly cause: unknown;

  public constructor(phase: PluginFailurePhase, cause: unknown) {
    super(errorMessage(cause));
    this.name = 'PluginPhaseError';
    this.phase = phase;
    this.cause = cause;
  }
}
