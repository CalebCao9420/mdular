import { workspacePath } from '@mdular/core';
import type {
  PluginVcsDiffResult,
  PluginVcsDiffSection,
  PluginVcsExternalClient,
  PluginVcsService,
  PluginVcsStatusEntry,
  PluginVcsStatusSnapshot,
} from '@mdular/plugin-sdk';

import type { DesktopBridge } from './workspace-adapter.js';

const MAX_STATUS_ENTRIES = 2_000;
const MAX_PATH_LENGTH = 1_024;
const MAX_BRANCH_LENGTH = 256;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const EXTERNAL_CLIENTS: ReadonlySet<string> = new Set([
  'default',
  'source-git',
  'tortoise-git',
  'explorer',
  'finder',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function stringValue(value: unknown, label: string, maximum: number): string {
  if ('string' !== typeof value || maximum < value.length) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if ('boolean' !== typeof value) { throw new Error(`${label} is malformed`); }
  return value;
}

function pathValue(value: unknown, label: string): string {
  return workspacePath(stringValue(value, label, MAX_PATH_LENGTH));
}

function repositoryKind(value: unknown): PluginVcsStatusSnapshot['kind'] {
  if (!['none', 'git', 'svn'].includes(String(value))) {
    throw new Error('VCS repository kind is malformed');
  }
  return value as PluginVcsStatusSnapshot['kind'];
}

function statusEntry(value: unknown): PluginVcsStatusEntry {
  if (!isRecord(value)) { throw new Error('VCS status entry is malformed'); }
  const status = stringValue(value.status, 'VCS status code', 2);
  const indexStatus = stringValue(value.indexStatus, 'VCS index status', 1);
  const workingTreeStatus = stringValue(value.workingTreeStatus, 'VCS working tree status', 1);
  if (2 !== status.length || 1 !== indexStatus.length || 1 !== workingTreeStatus.length) {
    throw new Error('VCS status code is malformed');
  }
  return {
    path: pathValue(value.path, 'VCS status path'),
    status,
    indexStatus,
    workingTreeStatus,
  };
}

export function decodeVcsStatus(value: unknown): PluginVcsStatusSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error('VCS status snapshot is malformed');
  }
  if (MAX_STATUS_ENTRIES < value.entries.length) {
    throw new Error('VCS status snapshot exceeds the entry limit');
  }
  const kind = repositoryKind(value.kind);
  const branch = undefined === value.branch
    ? undefined
    : stringValue(value.branch, 'VCS branch', MAX_BRANCH_LENGTH);
  if ('none' === kind && (branch || 0 < value.entries.length)) {
    throw new Error('Non-repository VCS status must be empty');
  }
  return {
    kind,
    ...(branch ? { branch } : {}),
    entries: value.entries.map(statusEntry),
    truncated: booleanValue(value.truncated, 'VCS status truncated marker'),
  };
}

function diffSection(value: unknown): PluginVcsDiffSection {
  if (!isRecord(value) || !['working-tree', 'staged'].includes(String(value.kind))) {
    throw new Error('VCS diff section is malformed');
  }
  const text = stringValue(value.text, 'VCS diff text', MAX_DIFF_BYTES);
  if (MAX_DIFF_BYTES < new TextEncoder().encode(text).byteLength) {
    throw new Error('VCS diff text exceeds the byte limit');
  }
  return {
    kind: value.kind as PluginVcsDiffSection['kind'],
    text,
    truncated: booleanValue(value.truncated, 'VCS diff truncated marker'),
  };
}

export function decodeVcsDiff(value: unknown): PluginVcsDiffResult {
  if (!isRecord(value) || !Array.isArray(value.sections) || 2 < value.sections.length) {
    throw new Error('VCS diff result is malformed');
  }
  const kind = repositoryKind(value.kind);
  if ('none' === kind) { throw new Error('VCS diff cannot target a non-repository'); }
  return {
    kind,
    path: pathValue(value.path, 'VCS diff path'),
    sections: value.sections.map(diffSection),
  };
}

function externalClient(value: unknown): PluginVcsExternalClient {
  if ('string' !== typeof value || !EXTERNAL_CLIENTS.has(value)) {
    throw new Error('External VCS client is malformed');
  }
  return value as PluginVcsExternalClient;
}

/** Desktop-only closed broker for native VCS operations. */
export class DesktopPluginVcsHost {
  readonly #bridge: DesktopBridge;
  readonly #activePlugins = new Map<string, symbol>();

  public constructor(bridge: DesktopBridge) {
    this.#bridge = bridge;
  }

  public createService(pluginId: string): PluginVcsService {
    const ownership = Symbol(pluginId);
    this.#activePlugins.set(pluginId, ownership);
    const assertActive = (): void => {
      if (this.#activePlugins.get(pluginId) !== ownership) {
        throw new Error('VCS service has been released');
      }
    };
    return {
      status: async () => {
        assertActive();
        const wire = await this.#bridge.invoke<unknown>('workspace_vcs_status', {});
        assertActive();
        return decodeVcsStatus(wire);
      },
      diff: async (path) => {
        assertActive();
        const checkedPath = pathValue(path, 'VCS diff path');
        const wire = await this.#bridge.invoke<unknown>('workspace_vcs_diff', {
          request: { path: checkedPath },
        });
        assertActive();
        const result = decodeVcsDiff(wire);
        if (result.path !== checkedPath) {
          throw new Error('VCS diff returned a different path');
        }
        return result;
      },
      openExternal: async (client) => {
        assertActive();
        const checkedClient = externalClient(client);
        const wire = await this.#bridge.invoke<unknown>('workspace_vcs_open_external', {
          request: { client: checkedClient },
        });
        assertActive();
        if (!isRecord(wire)) { throw new Error('External VCS result is malformed'); }
        return { client: externalClient(wire.client) };
      },
    };
  }

  public releasePlugin(pluginId: string): void {
    this.#activePlugins.delete(pluginId);
  }
}
