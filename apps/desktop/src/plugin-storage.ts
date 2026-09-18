import type {
  JsonValue,
  PluginStorageError,
  PluginStorageResult,
  PluginStorageService,
  VersionedJsonValue,
} from '@mdular/plugin-sdk';

import type { DesktopBridge } from './workspace-adapter.js';

export const PLUGIN_STORAGE_LIMITS = Object.freeze({
  maxKeyCharacters: 512,
  maxValueBytes: 64 * 1024,
  maxNamespaceBytes: 1024 * 1024,
});

const STORAGE_PREFIX = 'mdular:v2:plugin-storage:v1:';

export interface PluginKeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type WorkspaceIdentityProvider = () => Promise<string | null>;

function failure<T>(kind: PluginStorageError['kind'], message: string): PluginStorageResult<T> {
  return { ok: false, error: { kind, message } };
}

function storageError<T>(error: unknown): PluginStorageResult<T> {
  const name = null !== error && 'object' === typeof error && 'name' in error
    ? String(error.name)
    : '';
  return failure(
    'QuotaExceededError' === name ? 'quota' : 'unavailable',
    error instanceof Error ? error.message : String(error),
  );
}

function validKey(key: string): boolean {
  return (
    0 < key.length &&
    key.length <= PLUGIN_STORAGE_LIMITS.maxKeyCharacters &&
    !/[\u0000-\u001F\u007F]/u.test(key)
  );
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (null === value || 'string' === typeof value || 'boolean' === typeof value) { return true; }
  if ('number' === typeof value) { return Number.isFinite(value); }
  if ('object' !== typeof value) { return false; }
  if (seen.has(value)) { return false; }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (Object.prototype !== prototype && null !== prototype) { return false; }
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.entries(value).every(
        ([key, entry]) => '' !== key && isJsonValue(entry, seen),
      );
  seen.delete(value);
  return valid;
}

function isVersionedJsonValue(value: unknown): value is VersionedJsonValue {
  return (
    null !== value &&
    'object' === typeof value &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    Number.isSafeInteger(value.schemaVersion) &&
    0 < Number(value.schemaVersion) &&
    'value' in value &&
    isJsonValue(value.value)
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function namespacePrefix(workspaceIdentity: string, pluginId?: string): string {
  const workspace = `${STORAGE_PREFIX}${encodeURIComponent(workspaceIdentity)}:`;
  return undefined === pluginId ? workspace : `${workspace}${encodeURIComponent(pluginId)}:`;
}

export class DesktopPluginStorageManager {
  readonly #storage: PluginKeyValueStorage | null;
  readonly #workspaceIdentity: WorkspaceIdentityProvider;

  public constructor(
    storage: PluginKeyValueStorage | null,
    workspaceIdentity: WorkspaceIdentityProvider,
  ) {
    this.#storage = storage;
    this.#workspaceIdentity = workspaceIdentity;
  }

  public createService(pluginId: string): PluginStorageService {
    return {
      get: (key) => this.#get(pluginId, key),
      set: (key, value) => this.#set(pluginId, key, value),
      remove: (key) => this.#remove(pluginId, key),
    };
  }

  public async migrateDocumentPath(
    previousPath: string,
    nextPath: string,
  ): Promise<PluginStorageResult<null>> {
    if (!validKey(previousPath) || !validKey(nextPath)) {
      return failure('invalid-key', 'Document path is invalid for plugin storage migration');
    }
    let identity: string | null;
    try {
      identity = await this.#workspaceIdentity();
    } catch (error) {
      return storageError(error);
    }
    if (!identity || !this.#storage) {
      return failure('unavailable', 'Workspace plugin storage is unavailable');
    }
    const workspacePrefix = namespacePrefix(identity);
    const previousPrefix = `document:${encodeURIComponent(previousPath)}:`;
    const nextPrefix = `document:${encodeURIComponent(nextPath)}:`;
    const moves: Array<{
      sourceKey: string;
      destinationKey: string;
      sourceValue: string;
      destinationValue: string | null;
    }> = [];
    try {
      for (let index = 0; index < this.#storage.length; index += 1) {
        const storageKey = this.#storage.key(index);
        if (!storageKey?.startsWith(workspacePrefix)) { continue; }
        const pluginSeparator = storageKey.indexOf(':', workspacePrefix.length);
        if (-1 === pluginSeparator) { continue; }
        const encodedUserKey = storageKey.slice(pluginSeparator + 1);
        let userKey: string;
        try {
          userKey = decodeURIComponent(encodedUserKey);
        } catch {
          continue;
        }
        if (!userKey.startsWith(previousPrefix)) { continue; }
        const nextUserKey = `${nextPrefix}${userKey.slice(previousPrefix.length)}`;
        const destinationKey = `${storageKey.slice(0, pluginSeparator + 1)}` +
          encodeURIComponent(nextUserKey);
        const sourceValue = this.#storage.getItem(storageKey);
        if (null === sourceValue) { continue; }
        moves.push({
          sourceKey: storageKey,
          destinationKey,
          sourceValue,
          destinationValue: this.#storage.getItem(destinationKey),
        });
      }
      const written: typeof moves = [];
      try {
        for (const move of moves) {
          this.#storage.setItem(move.destinationKey, move.sourceValue);
          written.push(move);
        }
      } catch (error) {
        for (const move of written.reverse()) {
          if (null === move.destinationValue) {
            this.#storage.removeItem(move.destinationKey);
          } else {
            this.#storage.setItem(move.destinationKey, move.destinationValue);
          }
        }
        return storageError(error);
      }
      for (const move of moves) { this.#storage.removeItem(move.sourceKey); }
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }

  async #resolveKey(pluginId: string, key: string): Promise<PluginStorageResult<{
    readonly storageKey: string;
    readonly namespace: string;
  }>> {
    if (!validKey(pluginId) || !validKey(key)) {
      return failure('invalid-key', 'Plugin storage key is empty, too long or contains controls');
    }
    let identity: string | null;
    try {
      identity = await this.#workspaceIdentity();
    } catch (error) {
      return storageError(error);
    }
    if (!identity || !this.#storage) {
      return failure('unavailable', 'Workspace plugin storage is unavailable');
    }
    const namespace = namespacePrefix(identity, pluginId);
    return {
      ok: true,
      value: { namespace, storageKey: `${namespace}${encodeURIComponent(key)}` },
    };
  }

  async #get(
    pluginId: string,
    key: string,
  ): Promise<PluginStorageResult<VersionedJsonValue | null>> {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) { return resolved; }
    try {
      const value = this.#storage?.getItem(resolved.value.storageKey) ?? null;
      if (null === value) { return { ok: true, value: null }; }
      const parsed: unknown = JSON.parse(value);
      if (!isVersionedJsonValue(parsed)) {
        return failure('invalid-value', 'Stored plugin value is not versioned JSON');
      }
      return { ok: true, value: parsed };
    } catch (error) {
      return failure(
        'invalid-value',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #set(
    pluginId: string,
    key: string,
    value: VersionedJsonValue,
  ): Promise<PluginStorageResult<null>> {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) { return resolved; }
    let encoded: string;
    try {
      if (!isVersionedJsonValue(value)) {
        return failure('invalid-value', 'Plugin storage accepts only versioned JSON');
      }
      encoded = JSON.stringify(value);
    } catch (error) {
      return failure('serialization', error instanceof Error ? error.message : String(error));
    }
    if (byteLength(encoded) > PLUGIN_STORAGE_LIMITS.maxValueBytes) {
      return failure('quota', 'Plugin storage value exceeds the per-value limit');
    }
    try {
      let namespaceBytes = 0;
      if (this.#storage) {
        for (let index = 0; index < this.#storage.length; index += 1) {
          const storageKey = this.#storage.key(index);
          if (
            !storageKey?.startsWith(resolved.value.namespace) ||
            storageKey === resolved.value.storageKey
          ) { continue; }
          const stored = this.#storage.getItem(storageKey);
          if (null !== stored) { namespaceBytes += byteLength(storageKey) + byteLength(stored); }
        }
        namespaceBytes += byteLength(resolved.value.storageKey) + byteLength(encoded);
        if (namespaceBytes > PLUGIN_STORAGE_LIMITS.maxNamespaceBytes) {
          return failure('quota', 'Plugin storage namespace exceeds its quota');
        }
        this.#storage.setItem(resolved.value.storageKey, encoded);
      }
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }

  async #remove(pluginId: string, key: string): Promise<PluginStorageResult<null>> {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) { return resolved; }
    try {
      this.#storage?.removeItem(resolved.value.storageKey);
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }
}

export class DesktopWorkspaceIdentity {
  readonly #bridge: DesktopBridge;
  readonly #crypto: Crypto | null;
  #cached: Promise<string | null> | null = null;

  public constructor(bridge: DesktopBridge, crypto: Crypto | null) {
    this.#bridge = bridge;
    this.#crypto = crypto;
  }

  public get = (): Promise<string | null> => {
    this.#cached ??= this.#load();
    return this.#cached;
  };

  public invalidate(): void {
    this.#cached = null;
  }

  async #load(): Promise<string | null> {
    if (!this.#crypto?.subtle) { return null; }
    try {
      const path = await this.#bridge.invoke<unknown>('workspace_get_path', {});
      if ('string' !== typeof path || '' === path) { return null; }
      const digest = await this.#crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
      const hex = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return `workspace-sha256:${hex}`;
    } catch {
      return null;
    }
  }
}
