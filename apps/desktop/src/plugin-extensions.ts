import type {
  Disposable,
  JsonValue,
  PluginExtensionContribution,
  PluginExtensionService,
} from '@mdular/plugin-sdk';

import type { DesktopPluginFailureHandler } from './plugin-documents.js';

const MAX_EXTENSION_DATA_BYTES = 16 * 1024;
const MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024;

interface OwnedContribution {
  readonly pluginId: string;
  readonly pointId: string;
  readonly contribution: PluginExtensionContribution;
}

interface OwnedListener {
  readonly pluginId: string;
  readonly pointId: string;
  readonly listener: () => void | Promise<void>;
}

function validIdentifier(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (null === value || 'string' === typeof value || 'boolean' === typeof value) { return true; }
  if ('number' === typeof value) { return Number.isFinite(value); }
  if ('object' !== typeof value || seen.has(value)) { return false; }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (Object.prototype !== prototype && null !== prototype) { return false; }
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.entries(value).every(([key, entry]) => '' !== key && isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function cloneJson(value: JsonValue, maximum: number, label: string): JsonValue {
  if (!isJsonValue(value)) { throw new Error(`${label} must be JSON data`); }
  const encoded = JSON.stringify(value);
  if (maximum < new TextEncoder().encode(encoded).byteLength) {
    throw new Error(`${label} exceeds its byte limit`);
  }
  return JSON.parse(encoded) as JsonValue;
}

function normalizeContribution(value: PluginExtensionContribution): PluginExtensionContribution {
  if (!value || !validIdentifier(value.id)) {
    throw new Error('Plugin extension contribution ID is invalid');
  }
  if ('string' !== typeof value.label || '' === value.label.trim() || 256 < value.label.length) {
    throw new Error('Plugin extension contribution label is invalid');
  }
  if (undefined !== value.order && (!Number.isSafeInteger(value.order) ||
      value.order < -10_000 || 10_000 < value.order)) {
    throw new Error('Plugin extension contribution order is invalid');
  }
  if (undefined !== value.execute && 'function' !== typeof value.execute) {
    throw new Error('Plugin extension contribution execute handler is invalid');
  }
  return {
    id: value.id,
    label: value.label.trim(),
    ...(undefined === value.order ? {} : { order: value.order }),
    ...(undefined === value.data
      ? {}
      : { data: cloneJson(value.data, MAX_EXTENSION_DATA_BYTES, 'Plugin extension data') }),
    ...(undefined === value.execute ? {} : { execute: value.execute }),
  };
}

export class DesktopPluginExtensionHost implements Disposable {
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #contributions = new Set<OwnedContribution>();
  readonly #listeners = new Set<OwnedListener>();
  #disposed = false;

  public constructor(onFailure: DesktopPluginFailureHandler) {
    this.#onFailure = onFailure;
  }

  public createService(
    pluginId: string,
    capabilities: { readonly register: boolean; readonly consume: boolean },
  ): PluginExtensionService {
    if (this.#disposed) { throw new Error('Plugin extension host is disposed'); }
    return {
      register: (pointId, contribution) => {
        if (!capabilities.register) { throw new Error('Plugin may not register extensions'); }
        return this.#register(pluginId, pointId, contribution);
      },
      list: (pointId) => {
        if (!capabilities.consume) { throw new Error('Plugin may not consume extensions'); }
        return this.#list(pointId);
      },
      onDidChange: (pointId, listener) => {
        if (!capabilities.consume) { throw new Error('Plugin may not consume extensions'); }
        return this.#listen(pluginId, pointId, listener);
      },
    };
  }

  public releasePlugin(pluginId: string): void {
    const changedPoints = new Set<string>();
    for (const owned of [...this.#contributions]) {
      if (owned.pluginId !== pluginId) { continue; }
      this.#contributions.delete(owned);
      changedPoints.add(owned.pointId);
    }
    for (const owned of [...this.#listeners]) {
      if (owned.pluginId === pluginId) { this.#listeners.delete(owned); }
    }
    for (const pointId of changedPoints) { this.#notify(pointId); }
  }

  public contributionCount(pluginId?: string): number {
    return [...this.#contributions]
      .filter((owned) => undefined === pluginId || owned.pluginId === pluginId).length;
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#contributions.clear();
    this.#listeners.clear();
  }

  #register(
    pluginId: string,
    pointId: string,
    value: PluginExtensionContribution,
  ): Disposable {
    this.#point(pointId);
    const contribution = normalizeContribution(value);
    if ([...this.#contributions].some((owned) =>
      owned.pointId === pointId && owned.contribution.id === contribution.id)) {
      throw new Error(`Plugin extension contribution is duplicated: ${pointId}/${contribution.id}`);
    }
    const owned = { pluginId, pointId, contribution };
    this.#contributions.add(owned);
    this.#notify(pointId);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        if (this.#contributions.delete(owned)) { this.#notify(pointId); }
      },
    };
  }

  #list(pointId: string): readonly PluginExtensionContribution[] {
    this.#point(pointId);
    return [...this.#contributions]
      .filter((owned) => owned.pointId === pointId)
      .sort((left, right) =>
        (left.contribution.order ?? 100) - (right.contribution.order ?? 100) ||
        left.contribution.id.localeCompare(right.contribution.id))
      .map((owned) => ({
        id: owned.contribution.id,
        label: owned.contribution.label,
        ...(undefined === owned.contribution.order ? {} : { order: owned.contribution.order }),
        ...(undefined === owned.contribution.data
          ? {}
          : {
              data: cloneJson(
                owned.contribution.data,
                MAX_EXTENSION_DATA_BYTES,
                'Plugin extension data',
              ),
            }),
        ...(undefined === owned.contribution.execute
          ? {}
          : {
              execute: async (request: JsonValue) => {
                if (!this.#contributions.has(owned)) {
                  throw new Error('Plugin extension contribution is no longer active');
                }
                const input = cloneJson(
                  request,
                  MAX_EXTENSION_MESSAGE_BYTES,
                  'Plugin extension request',
                );
                try {
                  const result = await owned.contribution.execute!(input);
                  return undefined === result
                    ? undefined
                    : cloneJson(
                        result,
                        MAX_EXTENSION_MESSAGE_BYTES,
                        'Plugin extension response',
                      );
                } catch (error) {
                  this.#onFailure(owned.pluginId, 'provider', error);
                  throw error;
                }
              },
            }),
      }));
  }

  #listen(pluginId: string, pointId: string, listener: () => void | Promise<void>): Disposable {
    this.#point(pointId);
    if ('function' !== typeof listener) { throw new Error('Plugin extension listener is invalid'); }
    const owned = { pluginId, pointId, listener };
    this.#listeners.add(owned);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        this.#listeners.delete(owned);
      },
    };
  }

  #notify(pointId: string): void {
    for (const owned of [...this.#listeners]) {
      if (owned.pointId !== pointId) { continue; }
      try {
        void Promise.resolve(owned.listener()).catch((error: unknown) => {
          this.#onFailure(owned.pluginId, 'provider', error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, 'provider', error);
      }
    }
  }

  #point(pointId: string): void {
    if ('string' !== typeof pointId || !validIdentifier(pointId)) {
      throw new Error('Plugin extension point ID is invalid');
    }
    if (this.#disposed) { throw new Error('Plugin extension host is disposed'); }
  }
}
