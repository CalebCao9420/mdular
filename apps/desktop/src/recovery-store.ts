import {
  opaqueRevisionFromHost,
  workspacePath,
  workspacePathKeyFromHost,
} from '@mdular/platform';
import type { RecoveryRecord, RecoveryStore } from '@mdular/core';
import type { WorkspacePathKey } from '@mdular/platform';

import type { DesktopBridge } from './workspace-adapter.js';

export interface LoadedRecoveryRecord {
  readonly record: RecoveryRecord;
  readonly generation: 'current' | 'previous';
  readonly diagnostic?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function safeInteger(value: unknown, label: string): number {
  if ('number' !== typeof value || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if ('string' !== typeof value) { throw new Error(`${label} must be a string`); }
  return value;
}

function decodeRecoveryRecord(value: unknown): RecoveryRecord {
  if (!isRecord(value)) { throw new Error('Recovery record must be an object'); }
  if (1 !== value.schemaVersion) { throw new Error('Recovery record schema is unsupported'); }
  if ('string' !== typeof value.buffer) { throw new Error('Recovery buffer must be a string'); }
  return {
    schemaVersion: 1,
    path: workspacePath(requiredString(value.path, 'Recovery path')),
    pathKey: workspacePathKeyFromHost(requiredString(value.pathKey, 'Recovery path key')),
    savedRevision: opaqueRevisionFromHost(
      requiredString(value.savedRevision, 'Recovery saved revision'),
    ),
    buffer: value.buffer,
    bufferVersion: safeInteger(value.bufferVersion, 'Recovery bufferVersion'),
    capturedAt: safeInteger(value.capturedAt, 'Recovery capturedAt'),
  };
}

function decodeLoadedRecovery(value: unknown): LoadedRecoveryRecord {
  if (!isRecord(value)) { throw new Error('Loaded recovery entry must be an object'); }
  if ('current' !== value.generation && 'previous' !== value.generation) {
    throw new Error('Loaded recovery generation is invalid');
  }
  if (undefined !== value.diagnostic && 'string' !== typeof value.diagnostic) {
    throw new Error('Loaded recovery diagnostic must be a string');
  }
  return {
    record: decodeRecoveryRecord(value.record),
    generation: value.generation,
    ...(undefined === value.diagnostic ? {} : { diagnostic: value.diagnostic }),
  };
}

export class TauriRecoveryStore implements RecoveryStore {
  readonly #bridge: DesktopBridge;

  public constructor(bridge: DesktopBridge) {
    this.#bridge = bridge;
  }

  public async write(record: RecoveryRecord): Promise<void> {
    await this.#bridge.invoke<null>('recovery_write_record', { record });
  }

  public async remove(pathKey: WorkspacePathKey): Promise<void> {
    await this.#bridge.invoke<null>('recovery_remove_record', {
      request: { pathKey },
    });
  }

  public async list(): Promise<readonly LoadedRecoveryRecord[]> {
    const result = await this.#bridge.invoke<unknown>('recovery_list_records', {});
    if (!Array.isArray(result)) { throw new Error('Recovery list result must be an array'); }
    return result.map(decodeLoadedRecovery);
  }
}
