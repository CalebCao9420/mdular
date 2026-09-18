import { workspacePath } from '@mdular/core';
import type { DocumentSnapshot, WorkspaceAdapter } from '@mdular/core';
import type {
  Disposable,
  MarkdownWorkspaceChange,
  MarkdownEditCommitResult,
  MarkdownEditDraft,
  PluginWorkspaceService,
  TextEditCommitResult,
  TextEditDraft,
  TextWriteCommitResult,
  TextWriteConflictPolicy,
  TextWriteFailure,
  TextWriteOperation,
  TextWritePlan,
  TextWritePlanEntry,
  TextWriteRollbackResult,
} from '@mdular/plugin-sdk';

import type { DesktopPluginFailureHandler } from './plugin-documents.js';
import type { DesktopBridge } from './workspace-adapter.js';

const POLL_INTERVAL_MS = 2_000;
const MAX_TEXT_WRITE_OPERATIONS = 128;
const MAX_TEXT_WRITE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_WRITE_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_OWNED_BATCH_TOKENS = 8;
const TEXT_EXTENSIONS = new Set(['md', 'json', 'txt', 'yaml', 'yml']);

interface MarkdownInventoryEntry {
  readonly path: string;
  readonly lastModifiedMs: number;
}

interface OwnedWatcher {
  readonly pluginId: string;
  readonly listener: (change: MarkdownWorkspaceChange) => void;
}

interface OwnedTextWritePlan {
  readonly pluginId: string;
  readonly planId: string;
  readonly policy: TextWriteConflictPolicy;
  readonly operations: readonly TextWriteOperation[];
  readonly entries: readonly TextWritePlanEntry[];
  committing: boolean;
}

interface TextWriteReceipt {
  readonly path: string;
  readonly revision: string;
}

interface OwnedTextWriteRollback {
  readonly pluginId: string;
  readonly rollbackId: string;
  readonly receipts: readonly TextWriteReceipt[];
}

interface OwnedTextEdit {
  readonly pluginId: string;
  readonly editId: string;
  readonly kind: 'markdown' | 'text';
  readonly snapshot: DocumentSnapshot;
  committing: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if ('string' !== typeof value) { throw new Error(`${label} must be a string`); }
  return value;
}

function textWritePath(value: string): ReturnType<typeof workspacePath> {
  const path = workspacePath(value);
  const extension = path.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? '';
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error('Text batch writes are limited to Markdown, JSON, text and YAML files');
  }
  return path;
}

function decodeReceipt(value: unknown): TextWriteReceipt {
  if (!isRecord(value)) { throw new Error('Text batch receipt is malformed'); }
  const path = textWritePath(assertString(value.path, 'Text batch receipt path'));
  const revision = assertString(value.revision, 'Text batch receipt revision');
  if (!/^sha256:[a-f0-9]{64}$/u.test(revision)) {
    throw new Error('Text batch receipt revision is malformed');
  }
  return { path, revision };
}

function decodeReceipts(value: unknown): readonly TextWriteReceipt[] {
  if (!Array.isArray(value)) { throw new Error('Text batch receipts must be an array'); }
  return value.map(decodeReceipt);
}

function decodeCommitResult(value: unknown): {
  readonly status: 'complete' | 'partial';
  readonly created: readonly TextWriteReceipt[];
  readonly failed?: TextWriteFailure;
} {
  if (!isRecord(value) || ('complete' !== value.status && 'partial' !== value.status)) {
    throw new Error('Text batch apply result is malformed');
  }
  const created = decodeReceipts(value.created);
  if ('complete' === value.status) { return { status: 'complete', created }; }
  if (!isRecord(value.failed)) { throw new Error('Text batch failure is malformed'); }
  const index = value.failed.index;
  if (!Number.isSafeInteger(index) || Number(index) < 0) {
    throw new Error('Text batch failure index is malformed');
  }
  return {
    status: 'partial',
    created,
    failed: {
      index: Number(index),
      path: assertString(value.failed.path, 'Text batch failure path'),
      kind: assertString(value.failed.kind, 'Text batch failure kind'),
      message: assertString(value.failed.message, 'Text batch failure message'),
    },
  };
}

function decodeRollbackResult(value: unknown): TextWriteRollbackResult {
  if (!isRecord(value) || !Array.isArray(value.removed) || !Array.isArray(value.retained)) {
    throw new Error('Text batch rollback result is malformed');
  }
  return {
    removed: value.removed.map((path) => textWritePath(assertString(path, 'Removed path'))),
    retained: value.retained.map((entry) => {
      if (!isRecord(entry)) { throw new Error('Text batch rollback failure is malformed'); }
      return {
        path: assertString(entry.path, 'Retained path'),
        kind: assertString(entry.kind, 'Rollback failure kind'),
        message: assertString(entry.message, 'Rollback failure message'),
      };
    }),
  };
}

export function decodeMarkdownInventory(value: unknown): readonly MarkdownInventoryEntry[] {
  if (!Array.isArray(value)) { throw new Error('Workspace file inventory must be an array'); }
  const entries: MarkdownInventoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      'string' !== typeof item.relative_path ||
      'number' !== typeof item.last_modified_ms ||
      !Number.isSafeInteger(item.last_modified_ms) ||
      item.last_modified_ms < 0
    ) { throw new Error('Workspace file inventory entry is malformed'); }
    const path = workspacePath(item.relative_path);
    if (!path.toLocaleLowerCase('en-US').endsWith('.md')) { continue; }
    if (seen.has(path)) { throw new Error(`Workspace file inventory repeats ${path}`); }
    seen.add(path);
    entries.push({ path, lastModifiedMs: item.last_modified_ms });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function markdownPath(value: string): ReturnType<typeof workspacePath> {
  const path = workspacePath(value);
  if (!path.toLocaleLowerCase('en-US').endsWith('.md')) {
    throw new Error('Plugin workspace access is limited to Markdown files');
  }
  return path;
}

function directoryPath(value: string | undefined): string | null {
  if (undefined === value || '' === value) { return null; }
  return workspacePath(value.replace(/\/$/u, ''));
}

function inventoryMap(
  entries: readonly MarkdownInventoryEntry[],
): ReadonlyMap<string, number> {
  return new Map(entries.map((entry) => [entry.path, entry.lastModifiedMs]));
}

export class DesktopPluginWorkspaceHost implements Disposable {
  readonly #bridge: DesktopBridge;
  readonly #workspaceAdapter: WorkspaceAdapter;
  readonly #window: Pick<Window, 'setTimeout' | 'clearTimeout'>;
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #watchers = new Set<OwnedWatcher>();
  readonly #textWritePlans = new Map<string, OwnedTextWritePlan>();
  readonly #textWriteRollbacks = new Map<string, OwnedTextWriteRollback>();
  readonly #textEdits = new Map<string, OwnedTextEdit>();
  #nextBatchToken = 1;
  #inventory: ReadonlyMap<string, number> | null = null;
  #timer: number | null = null;
  #polling = false;
  #disposed = false;

  public constructor(options: {
    readonly bridge: DesktopBridge;
    readonly workspaceAdapter: WorkspaceAdapter;
    readonly window: Pick<Window, 'setTimeout' | 'clearTimeout'>;
    readonly onFailure: DesktopPluginFailureHandler;
  }) {
    this.#bridge = options.bridge;
    this.#workspaceAdapter = options.workspaceAdapter;
    this.#window = options.window;
    this.#onFailure = options.onFailure;
  }

  public createService(
    pluginId: string,
    capabilities: {
      readonly read: boolean;
      readonly readText?: boolean;
      readonly watch: boolean;
      readonly writeTextBatch?: boolean;
      readonly modifyMarkdown?: boolean;
      readonly modifyText?: boolean;
    },
  ): PluginWorkspaceService {
    if (this.#disposed) { throw new Error('Plugin workspace host is disposed'); }
    return {
      ...(capabilities.read
        ? {
            readMarkdown: (path: string) => this.#readMarkdown(path),
            listMarkdown: (directory?: string) => this.#listMarkdown(directory),
            listMarkdownEntries: (directory?: string) => this.#listMarkdownEntries(directory),
          }
        : {}),
      ...(capabilities.readText
        ? { readText: (path: string) => this.#readText(path) }
        : {}),
      ...(capabilities.modifyMarkdown
        ? {
            beginMarkdownEdit: (path: string) => this.#beginMarkdownEdit(pluginId, path),
            commitMarkdownEdit: (editId: string, content: string) =>
              this.#commitMarkdownEdit(pluginId, editId, content),
          }
        : {}),
      ...(capabilities.modifyText
        ? {
            beginTextEdit: (path: string) => this.#beginTextEdit(pluginId, path),
            commitTextEdit: (editId: string, content: string) =>
              this.#commitTextEdit(pluginId, editId, content),
          }
        : {}),
      ...(capabilities.watch
        ? { watchMarkdown: (listener: (change: MarkdownWorkspaceChange) => void) =>
            this.#watch(pluginId, listener) }
        : {}),
      ...(capabilities.writeTextBatch
        ? {
            planTextWrites: (
              operations: readonly TextWriteOperation[],
              policy: TextWriteConflictPolicy,
            ) => this.#planTextWrites(pluginId, operations, policy),
            commitTextWritePlan: (planId: string) =>
              this.#commitTextWritePlan(pluginId, planId),
            rollbackTextWrites: (rollbackId: string) =>
              this.#rollbackTextWrites(pluginId, rollbackId),
          }
        : {}),
    };
  }

  public notifyWorkspaceReset(): void {
    if (this.#disposed) { return; }
    this.#inventory = null;
    this.#textWritePlans.clear();
    this.#textWriteRollbacks.clear();
    this.#textEdits.clear();
    this.#dispatch({ kind: 'reset' });
    if (0 < this.#watchers.size) { this.#schedule(0); }
  }

  public releasePlugin(pluginId: string): void {
    for (const watcher of [...this.#watchers]) {
      if (watcher.pluginId === pluginId) { this.#watchers.delete(watcher); }
    }
    if (0 === this.#watchers.size) { this.#stopPolling(); }
    for (const [planId, plan] of [...this.#textWritePlans]) {
      if (plan.pluginId === pluginId) { this.#textWritePlans.delete(planId); }
    }
    for (const [rollbackId, rollback] of [...this.#textWriteRollbacks]) {
      if (rollback.pluginId === pluginId) { this.#textWriteRollbacks.delete(rollbackId); }
    }
    for (const [editId, edit] of [...this.#textEdits]) {
      if (edit.pluginId === pluginId) { this.#textEdits.delete(editId); }
    }
  }

  public watcherCount(pluginId?: string): number {
    return [...this.#watchers]
      .filter((watcher) => undefined === pluginId || watcher.pluginId === pluginId).length;
  }

  public async pollNow(): Promise<void> {
    if (this.#disposed || this.#polling || 0 === this.#watchers.size) { return; }
    this.#polling = true;
    try {
      const next = inventoryMap(await this.#loadInventory());
      const previous = this.#inventory;
      this.#inventory = next;
      if (!previous) { return; }
      for (const path of previous.keys()) {
        if (!next.has(path)) { this.#dispatch({ path, kind: 'deleted' }); }
      }
      for (const [path, modified] of next) {
        const before = previous.get(path);
        if (undefined === before) {
          this.#dispatch({ path, kind: 'created' });
        } else if (before !== modified) {
          this.#dispatch({ path, kind: 'changed' });
        }
      }
    } finally {
      this.#polling = false;
    }
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#watchers.clear();
    this.#textWritePlans.clear();
    this.#textWriteRollbacks.clear();
    this.#textEdits.clear();
    this.#inventory = null;
    this.#stopPolling();
  }

  async #readMarkdown(value: string): Promise<string> {
    return this.#readTextPath(markdownPath(value));
  }

  async #readText(value: string): Promise<string> {
    return this.#readTextPath(textWritePath(value));
  }

  async #readTextPath(path: ReturnType<typeof workspacePath>): Promise<string> {
    const result = await this.#workspaceAdapter.read(path);
    if (!result.ok) {
      throw new Error(`${result.error.kind}: ${result.error.message}`);
    }
    if (MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(result.snapshot.content).byteLength) {
      throw new Error('Plugin text read exceeds the file limit');
    }
    return result.snapshot.content;
  }

  async #listMarkdown(directory?: string): Promise<readonly string[]> {
    const scope = directoryPath(directory);
    return (await this.#loadInventory())
      .map((entry) => entry.path)
      .filter((path) => !scope || path.startsWith(`${scope}/`));
  }

  async #listMarkdownEntries(directory?: string): Promise<readonly MarkdownInventoryEntry[]> {
    const scope = directoryPath(directory);
    return (await this.#loadInventory())
      .filter((entry) => !scope || entry.path.startsWith(`${scope}/`))
      .map((entry) => ({ ...entry }));
  }

  async #loadInventory(): Promise<readonly MarkdownInventoryEntry[]> {
    return decodeMarkdownInventory(
      await this.#bridge.invoke<unknown>('workspace_list_files', {}),
    );
  }

  async #beginMarkdownEdit(pluginId: string, value: string): Promise<MarkdownEditDraft> {
    return this.#beginTextEditKind(pluginId, value, 'markdown');
  }

  async #beginTextEdit(pluginId: string, value: string): Promise<TextEditDraft> {
    return this.#beginTextEditKind(pluginId, value, 'text');
  }

  async #beginTextEditKind(
    pluginId: string,
    value: string,
    kind: 'markdown' | 'text',
  ): Promise<TextEditDraft> {
    if (this.#disposed) { throw new Error('Plugin workspace host is disposed'); }
    const path = 'markdown' === kind ? markdownPath(value) : textWritePath(value);
    const result = await this.#workspaceAdapter.read(path);
    if (!result.ok) {
      throw new Error(`${result.error.kind}: ${result.error.message}`);
    }
    if ('read-write' !== result.snapshot.access.kind) {
      throw new Error(`read-only: ${result.snapshot.access.message}`);
    }
    if (MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(result.snapshot.content).byteLength) {
      throw new Error(`${'markdown' === kind ? 'Markdown' : 'Text'} edit content exceeds the file limit`);
    }
    this.#trimOwnedTokens(this.#textEdits, pluginId);
    return this.#storeTextEdit(pluginId, kind, result.snapshot);
  }

  async #commitMarkdownEdit(
    pluginId: string,
    editId: string,
    content: string,
  ): Promise<MarkdownEditCommitResult> {
    return this.#commitTextEditKind(pluginId, editId, content, 'markdown');
  }

  async #commitTextEdit(
    pluginId: string,
    editId: string,
    content: string,
  ): Promise<TextEditCommitResult> {
    return this.#commitTextEditKind(pluginId, editId, content, 'text');
  }

  async #commitTextEditKind(
    pluginId: string,
    editId: string,
    content: string,
    kind: 'markdown' | 'text',
  ): Promise<TextEditCommitResult> {
    const label = 'markdown' === kind ? 'Markdown' : 'Text';
    const edit = this.#textEdits.get(editId);
    if (!edit || edit.pluginId !== pluginId || edit.kind !== kind) {
      throw new Error(`${label} edit is unknown`);
    }
    if (edit.committing) { throw new Error(`${label} edit is already committing`); }
    if ('string' !== typeof content || MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(content).byteLength) {
      throw new Error(`${label} edit content exceeds the file limit`);
    }
    edit.committing = true;
    const result = await this.#workspaceAdapter.write({
      path: edit.snapshot.path,
      pathKey: edit.snapshot.pathKey,
      expectedRevision: edit.snapshot.revision,
      content,
      format: edit.snapshot.format,
    });
    if (result.ok) {
      this.#textEdits.delete(editId);
      return { status: 'written', path: result.snapshot.path, content: result.snapshot.content };
    }
    if ('conflict' === result.kind) {
      this.#textEdits.delete(editId);
      return { status: 'conflict', current: this.#storeTextEdit(pluginId, kind, result.current) };
    }
    edit.committing = false;
    throw new Error(`${result.kind}: ${result.message}`);
  }

  #storeTextEdit(
    pluginId: string,
    kind: 'markdown' | 'text',
    snapshot: DocumentSnapshot,
  ): TextEditDraft {
    const editId = this.#token(pluginId, 'edit');
    this.#textEdits.set(editId, {
      pluginId,
      editId,
      kind,
      snapshot,
      committing: false,
    });
    return { editId, path: snapshot.path, content: snapshot.content };
  }

  async #planTextWrites(
    pluginId: string,
    operations: readonly TextWriteOperation[],
    policy: TextWriteConflictPolicy,
  ): Promise<TextWritePlan> {
    if (this.#disposed) { throw new Error('Plugin workspace host is disposed'); }
    if ('fail-if-existing' !== policy && 'skip-existing' !== policy) {
      throw new Error('Text batch conflict policy is invalid');
    }
    if (
      !Array.isArray(operations) ||
      0 === operations.length ||
      MAX_TEXT_WRITE_OPERATIONS < operations.length
    ) { throw new Error('Text batch operation count is outside the allowed range'); }
    const encoder = new TextEncoder();
    const seen = new Set<string>();
    let totalBytes = 0;
    const normalized = operations.map((operation) => {
      if (!operation || 'string' !== typeof operation.content) {
        throw new Error('Text batch operation is malformed');
      }
      const path = textWritePath(operation.path);
      const identity = path.toLocaleLowerCase('en-US');
      if (seen.has(identity)) { throw new Error(`Text batch path is duplicated: ${path}`); }
      seen.add(identity);
      const bytes = encoder.encode(operation.content).byteLength;
      if (MAX_TEXT_WRITE_FILE_BYTES < bytes) {
        throw new Error(`Text batch file exceeds the per-file limit: ${path}`);
      }
      totalBytes += bytes;
      if (MAX_TEXT_WRITE_TOTAL_BYTES < totalBytes) {
        throw new Error('Text batch exceeds the total content limit');
      }
      return { path, content: operation.content, bytes };
    });
    const entries: TextWritePlanEntry[] = [];
    for (const operation of normalized) {
      const exists = await this.#bridge.invoke<boolean>('workspace_exists', {
        relativePath: operation.path,
      });
      if ('boolean' !== typeof exists) { throw new Error('Workspace existence result is malformed'); }
      entries.push({
        path: operation.path,
        bytes: operation.bytes,
        disposition: exists
          ? ('skip-existing' === policy ? 'skip' : 'conflict')
          : 'create',
      });
    }
    this.#trimOwnedTokens(this.#textWritePlans, pluginId);
    const planId = this.#token(pluginId, 'plan');
    this.#textWritePlans.set(planId, {
      pluginId,
      planId,
      policy,
      operations: normalized.map(({ path, content }) => ({ path, content })),
      entries,
      committing: false,
    });
    return { planId, policy, entries };
  }

  async #commitTextWritePlan(
    pluginId: string,
    planId: string,
  ): Promise<TextWriteCommitResult> {
    const plan = this.#textWritePlans.get(planId);
    if (!plan || plan.pluginId !== pluginId) { throw new Error('Text write plan is unknown'); }
    if (plan.committing) { throw new Error('Text write plan is already committing'); }
    if (plan.entries.some((entry) => 'conflict' === entry.disposition)) {
      throw new Error('Text write plan has unresolved conflicts');
    }
    const skipped = plan.entries
      .filter((entry) => 'skip' === entry.disposition)
      .map((entry) => entry.path);
    const createPaths = new Set(plan.entries
      .filter((entry) => 'create' === entry.disposition)
      .map((entry) => entry.path));
    const operations = plan.operations.filter((operation) => createPaths.has(operation.path));
    if (0 === operations.length) {
      this.#textWritePlans.delete(planId);
      return { status: 'complete', created: [], skipped };
    }
    plan.committing = true;
    let decoded: ReturnType<typeof decodeCommitResult>;
    try {
      decoded = decodeCommitResult(await this.#bridge.invoke<unknown>(
        'workspace_apply_text_batch',
        { request: { schemaVersion: 1, operations } },
      ));
    } catch (error) {
      plan.committing = false;
      throw error;
    }
    this.#textWritePlans.delete(planId);
    const created = decoded.created.map((receipt) => receipt.path);
    let rollbackId: string | undefined;
    if (0 < decoded.created.length) {
      this.#trimOwnedTokens(this.#textWriteRollbacks, pluginId);
      rollbackId = this.#token(pluginId, 'rollback');
      this.#textWriteRollbacks.set(rollbackId, {
        pluginId,
        rollbackId,
        receipts: decoded.created,
      });
    }
    if ('partial' === decoded.status) {
      return {
        status: 'partial',
        created,
        skipped,
        failed: decoded.failed!,
        ...(rollbackId ? { rollbackId } : {}),
      };
    }
    return {
      status: 'complete',
      created,
      skipped,
      ...(rollbackId ? { rollbackId } : {}),
    };
  }

  async #rollbackTextWrites(
    pluginId: string,
    rollbackId: string,
  ): Promise<TextWriteRollbackResult> {
    const rollback = this.#textWriteRollbacks.get(rollbackId);
    if (!rollback || rollback.pluginId !== pluginId) {
      throw new Error('Text write rollback is unknown');
    }
    const result = decodeRollbackResult(await this.#bridge.invoke<unknown>(
      'workspace_rollback_text_batch',
      { request: { schemaVersion: 1, receipts: rollback.receipts } },
    ));
    const retainedPaths = new Set(result.retained.map((entry) => entry.path));
    const retainedReceipts = rollback.receipts.filter((receipt) => retainedPaths.has(receipt.path));
    if (0 === retainedReceipts.length) {
      this.#textWriteRollbacks.delete(rollbackId);
    } else {
      this.#textWriteRollbacks.set(rollbackId, { ...rollback, receipts: retainedReceipts });
    }
    return result;
  }

  #token(pluginId: string, kind: 'plan' | 'rollback' | 'edit'): string {
    const token = `${pluginId}:${kind}:${this.#nextBatchToken}`;
    this.#nextBatchToken += 1;
    return token;
  }

  #trimOwnedTokens<TValue extends { readonly pluginId: string }>(
    values: Map<string, TValue>,
    pluginId: string,
  ): void {
    const owned = [...values].filter(([, value]) => value.pluginId === pluginId);
    while (MAX_OWNED_BATCH_TOKENS <= owned.length) {
      const oldest = owned.shift();
      if (oldest) { values.delete(oldest[0]); }
    }
  }

  #watch(
    pluginId: string,
    listener: (change: MarkdownWorkspaceChange) => void,
  ): Disposable {
    if (this.#disposed) { throw new Error('Plugin workspace host is disposed'); }
    const owned = { pluginId, listener };
    this.#watchers.add(owned);
    if (1 === this.#watchers.size) { this.#schedule(0); }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        this.#watchers.delete(owned);
        if (0 === this.#watchers.size) { this.#stopPolling(); }
      },
    };
  }

  #dispatch(change: MarkdownWorkspaceChange): void {
    for (const owned of [...this.#watchers]) {
      try {
        owned.listener(change);
      } catch (error) {
        this.#onFailure(owned.pluginId, 'provider', error);
      }
    }
  }

  #schedule(delayMs = POLL_INTERVAL_MS): void {
    if (this.#disposed || 0 === this.#watchers.size || null !== this.#timer) { return; }
    this.#timer = this.#window.setTimeout(() => {
      this.#timer = null;
      void this.pollNow().catch(() => {}).finally(() => this.#schedule());
    }, delayMs);
  }

  #stopPolling(): void {
    if (null !== this.#timer) { this.#window.clearTimeout(this.#timer); }
    this.#timer = null;
    this.#inventory = null;
  }
}
