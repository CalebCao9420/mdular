import type {
  Disposable,
  DocumentSnapshot,
  OpaqueRevision,
  WorkspaceAdapter,
  WorkspaceChangeHint,
  WorkspacePath,
  WorkspacePathKey,
  WorkspaceReadError,
  WorkspaceReadResult,
  WorkspaceWriteResult,
} from '@mdular/platform';

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving'; readonly bufferVersion: number }
  | { readonly kind: 'error'; readonly message: string };

export type DocumentConflict =
  | { readonly kind: 'external-change'; readonly diskSnapshot: DocumentSnapshot }
  | { readonly kind: 'missing' };

export type RecoveryState =
  | { readonly kind: 'clean' }
  | { readonly kind: 'pending'; readonly bufferVersion: number }
  | {
      readonly kind: 'persisted';
      readonly bufferVersion: number;
      readonly capturedAt: number;
    }
  | { readonly kind: 'error'; readonly message: string };

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly snapshot: DocumentSnapshot }
  | { readonly kind: 'still-dirty'; readonly snapshot: DocumentSnapshot }
  | { readonly kind: 'conflict'; readonly conflict: DocumentConflict }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'unchanged'; readonly snapshot: DocumentSnapshot };

export type ExternalRefreshOutcome =
  | { readonly kind: 'unchanged'; readonly snapshot: DocumentSnapshot }
  | { readonly kind: 'reloaded'; readonly snapshot: DocumentSnapshot }
  | { readonly kind: 'conflict'; readonly conflict: DocumentConflict }
  | { readonly kind: 'missing'; readonly conflict: DocumentConflict }
  | { readonly kind: 'error'; readonly error: WorkspaceReadError };

export interface DocumentSessionState {
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  readonly savedSnapshot: DocumentSnapshot;
  readonly buffer: string;
  readonly bufferVersion: number;
  readonly dirty: boolean;
  readonly saveState: SaveState;
  readonly conflict: DocumentConflict | null;
  readonly recoveryState: RecoveryState;
  readonly paneIds: readonly string[];
}

export interface RecoveryRecord {
  readonly schemaVersion: 1;
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  readonly savedRevision: OpaqueRevision;
  readonly buffer: string;
  readonly bufferVersion: number;
  readonly capturedAt: number;
}

export interface RecoveryStore {
  /** The host store owns checksum, current/previous generation, quota and permissions. */
  write(record: RecoveryRecord): Promise<void>;
  remove(pathKey: WorkspacePathKey): Promise<void>;
}

export type RecoveryRestoreOutcome =
  | { readonly kind: 'restored' }
  | { readonly kind: 'conflict'; readonly conflict: DocumentConflict }
  | { readonly kind: 'stale' };

export type RecoveryPersistOutcome =
  | { readonly kind: 'clean' }
  | {
      readonly kind: 'persisted';
      readonly bufferVersion: number;
      readonly capturedAt: number;
    }
  | {
      readonly kind: 'superseded';
      readonly persistedBufferVersion: number;
      readonly currentBufferVersion: number;
    }
  | { readonly kind: 'error'; readonly message: string };

export class DocumentReadOnlyError extends Error {
  public readonly reason: 'unsupported-encoding';

  public constructor(snapshot: DocumentSnapshot) {
    if ('read-write' === snapshot.access.kind) {
      throw new Error('DocumentReadOnlyError requires a read-only snapshot');
    }
    super(snapshot.access.message);
    this.name = 'DocumentReadOnlyError';
    this.reason = snapshot.access.reason;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiresRecovery(state: DocumentSessionState): boolean {
  return state.dirty || null !== state.conflict;
}

export class DocumentSession {
  readonly #adapter: WorkspaceAdapter;
  readonly #paneIds = new Set<string>();
  #savedSnapshot: DocumentSnapshot;
  #buffer: string;
  #bufferVersion = 0;
  #saveState: SaveState = { kind: 'idle' };
  #conflict: DocumentConflict | null = null;
  #recoveryState: RecoveryState = { kind: 'clean' };
  #saveRequested = false;
  #saveLoop: Promise<SaveOutcome> | null = null;
  #refreshRequested = false;
  #refreshLoop: Promise<ExternalRefreshOutcome> | null = null;
  #recoveryRequested = false;
  #recoveryLoop: Promise<RecoveryPersistOutcome> | null = null;
  #recoveryNow: () => number = Date.now;

  public constructor(snapshot: DocumentSnapshot, adapter: WorkspaceAdapter) {
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#adapter = adapter;
  }

  public get state(): DocumentSessionState {
    return {
      path: this.#savedSnapshot.path,
      pathKey: this.#savedSnapshot.pathKey,
      savedSnapshot: this.#savedSnapshot,
      buffer: this.#buffer,
      bufferVersion: this.#bufferVersion,
      dirty: this.#buffer !== this.#savedSnapshot.content,
      saveState: this.#saveState,
      conflict: this.#conflict,
      recoveryState: this.#recoveryState,
      paneIds: [...this.#paneIds],
    };
  }

  public edit(content: string): void {
    if ('read-only' === this.#savedSnapshot.access.kind) {
      throw new DocumentReadOnlyError(this.#savedSnapshot);
    }
    if (content === this.#buffer) { return; }
    this.#buffer = content;
    this.#bufferVersion += 1;
    this.#recoveryState = { kind: 'pending', bufferVersion: this.#bufferVersion };
    if ('error' === this.#saveState.kind) { this.#saveState = { kind: 'idle' }; }
  }

  public attachPane(paneId: string): void {
    if ('' === paneId) { throw new Error('Pane ID must not be empty'); }
    this.#paneIds.add(paneId);
  }

  public detachPane(paneId: string): void {
    this.#paneIds.delete(paneId);
  }

  public usesAdapter(adapter: WorkspaceAdapter): boolean {
    return this.#adapter === adapter;
  }

  public async save(): Promise<SaveOutcome> {
    if (this.#conflict) { return { kind: 'conflict', conflict: this.#conflict }; }
    if (!this.state.dirty) { return { kind: 'unchanged', snapshot: this.#savedSnapshot }; }
    if ('read-only' === this.#savedSnapshot.access.kind) {
      const message = this.#savedSnapshot.access.message;
      this.#saveState = { kind: 'error', message };
      return { kind: 'error', message };
    }

    this.#saveRequested = true;
    this.#saveLoop ??= this.#drainSaveQueue().finally(() => {
      this.#saveLoop = null;
    });
    return this.#saveLoop;
  }

  async #drainSaveQueue(): Promise<SaveOutcome> {
    let outcome: SaveOutcome = { kind: 'unchanged', snapshot: this.#savedSnapshot };
    while (this.#saveRequested) {
      this.#saveRequested = false;
      if (this.#conflict) { return { kind: 'conflict', conflict: this.#conflict }; }
      if (!this.state.dirty) {
        outcome = { kind: 'unchanged', snapshot: this.#savedSnapshot };
        continue;
      }

      const content = this.#buffer;
      const bufferVersion = this.#bufferVersion;
      this.#saveState = { kind: 'saving', bufferVersion };
      const result = await this.#adapter.write({
        path: this.#savedSnapshot.path,
        pathKey: this.#savedSnapshot.pathKey,
        expectedRevision: this.#savedSnapshot.revision,
        content,
        format: this.#savedSnapshot.format,
      });
      outcome = this.#applyWriteResult(result, content, bufferVersion);
      if ('conflict' === outcome.kind || 'error' === outcome.kind) { return outcome; }
    }
    return outcome;
  }

  #applyWriteResult(
    result: WorkspaceWriteResult,
    savedContent: string,
    savedBufferVersion: number,
  ): SaveOutcome {
    if (!result.ok) {
      if ('conflict' === result.kind) {
        this.#conflict = { kind: 'external-change', diskSnapshot: result.current };
        this.#saveState = { kind: 'idle' };
        return { kind: 'conflict', conflict: this.#conflict };
      }
      this.#saveState = { kind: 'error', message: result.message };
      return { kind: 'error', message: result.message };
    }
    if (result.snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      const message = 'Workspace adapter changed the document identity during save';
      this.#saveState = { kind: 'error', message };
      return { kind: 'error', message };
    }
    if ('read-only' === result.snapshot.access.kind) {
      const message = 'Workspace adapter returned a read-only snapshot after a successful write';
      this.#saveState = { kind: 'error', message };
      return { kind: 'error', message };
    }

    this.#savedSnapshot = result.snapshot;
    this.#saveState = { kind: 'idle' };
    if (this.#bufferVersion === savedBufferVersion) {
      this.#buffer = result.snapshot.content;
      this.#recoveryState = { kind: 'clean' };
      return { kind: 'saved', snapshot: result.snapshot };
    }
    if (this.#buffer === savedContent) { this.#buffer = result.snapshot.content; }
    return { kind: 'still-dirty', snapshot: result.snapshot };
  }

  public applyExternalSnapshot(snapshot: DocumentSnapshot): void {
    if (snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      throw new Error('External snapshot belongs to a different document');
    }
    if (this.state.dirty || 'saving' === this.#saveState.kind || this.#conflict) {
      this.#conflict = { kind: 'external-change', diskSnapshot: snapshot };
      return;
    }
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#bufferVersion += 1;
    this.#conflict = null;
    this.#recoveryState = { kind: 'clean' };
  }

  public markMissing(): void {
    this.#conflict = { kind: 'missing' };
  }

  /** Watch events are hints: every call re-reads, and overlapping hints coalesce serially. */
  public refreshFromHost(): Promise<ExternalRefreshOutcome> {
    this.#refreshRequested = true;
    this.#refreshLoop ??= this.#drainExternalRefreshQueue().finally(() => {
      this.#refreshLoop = null;
    });
    return this.#refreshLoop;
  }

  async #drainExternalRefreshQueue(): Promise<ExternalRefreshOutcome> {
    let outcome: ExternalRefreshOutcome = {
      kind: 'unchanged',
      snapshot: this.#savedSnapshot,
    };
    while (this.#refreshRequested) {
      this.#refreshRequested = false;
      if (this.#saveLoop) { await this.#saveLoop; }

      const requestedPath = this.#savedSnapshot.path;
      const requestedPathKey = this.#savedSnapshot.pathKey;
      let result: WorkspaceReadResult;
      try {
        result = await this.#adapter.read(requestedPath);
      } catch (error) {
        outcome = {
          kind: 'error',
          error: { kind: 'io-error', message: errorMessage(error) },
        };
        continue;
      }

      if (
        requestedPath !== this.#savedSnapshot.path ||
        requestedPathKey !== this.#savedSnapshot.pathKey
      ) {
        // An application rename won the race. Ignore the stale read and confirm the new route.
        this.#refreshRequested = true;
        continue;
      }

      if (!result.ok) {
        if ('not-found' === result.error.kind) {
          this.markMissing();
          outcome = { kind: 'missing', conflict: this.#conflict as DocumentConflict };
        } else {
          outcome = { kind: 'error', error: result.error };
        }
        continue;
      }

      const snapshot = result.snapshot;
      if (snapshot.pathKey !== requestedPathKey) {
        outcome = {
          kind: 'error',
          error: {
            kind: 'io-error',
            message: 'Workspace adapter changed document identity while refreshing a watch hint',
          },
        };
        continue;
      }
      if (snapshot.revision === this.#savedSnapshot.revision) {
        if (
          snapshot.byteHash !== this.#savedSnapshot.byteHash ||
          snapshot.content !== this.#savedSnapshot.content
        ) {
          outcome = {
            kind: 'error',
            error: {
              kind: 'io-error',
              message: 'Workspace adapter returned different bytes for the same opaque revision',
            },
          };
        } else {
          outcome = this.#conflict
            ? { kind: 'conflict', conflict: this.#conflict }
            : { kind: 'unchanged', snapshot: this.#savedSnapshot };
        }
        continue;
      }

      const wasClean = !this.state.dirty && 'saving' !== this.#saveState.kind && !this.#conflict;
      this.applyExternalSnapshot(snapshot);
      outcome = wasClean
        ? { kind: 'reloaded', snapshot }
        : { kind: 'conflict', conflict: this.#conflict as DocumentConflict };
    }
    return outcome;
  }

  public reloadFromDisk(snapshot: DocumentSnapshot): void {
    if (snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      throw new Error('Reload snapshot belongs to a different document');
    }
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#bufferVersion += 1;
    this.#conflict = null;
    this.#saveState = { kind: 'idle' };
    this.#recoveryState = { kind: 'clean' };
  }

  public rebindAfterHostRename(snapshot: DocumentSnapshot): void {
    if (
      snapshot.content !== this.#savedSnapshot.content ||
      snapshot.revision !== this.#savedSnapshot.revision
    ) {
      throw new Error('Rename snapshot must preserve the saved document revision and content');
    }
    this.#savedSnapshot = snapshot;
  }

  public restoreRecovery(record: RecoveryRecord): RecoveryRestoreOutcome {
    if (1 !== record.schemaVersion) { throw new Error('Recovery record schema is unsupported'); }
    if (
      record.path !== this.#savedSnapshot.path ||
      record.pathKey !== this.#savedSnapshot.pathKey
    ) {
      throw new Error('Recovery record belongs to a different document');
    }
    if (
      !Number.isSafeInteger(record.bufferVersion) || 0 > record.bufferVersion ||
      !Number.isSafeInteger(record.capturedAt) || 0 > record.capturedAt
    ) {
      throw new Error('Recovery record counters must be non-negative safe integers');
    }
    if (
      0 !== this.#bufferVersion ||
      this.#buffer !== this.#savedSnapshot.content ||
      null !== this.#conflict ||
      'idle' !== this.#saveState.kind ||
      'clean' !== this.#recoveryState.kind
    ) {
      throw new Error('Recovery can only be restored into a fresh document session');
    }
    if (
      record.savedRevision === this.#savedSnapshot.revision &&
      record.buffer === this.#savedSnapshot.content
    ) {
      this.#buffer = this.#savedSnapshot.content;
      this.#conflict = null;
      this.#saveState = { kind: 'idle' };
      this.#recoveryState = { kind: 'clean' };
      return { kind: 'stale' };
    }

    this.#buffer = record.buffer;
    this.#bufferVersion = record.bufferVersion;
    this.#saveState = { kind: 'idle' };
    this.#recoveryState = {
      kind: 'persisted',
      bufferVersion: this.#bufferVersion,
      capturedAt: record.capturedAt,
    };
    if (record.savedRevision !== this.#savedSnapshot.revision) {
      this.#conflict = {
        kind: 'external-change',
        diskSnapshot: this.#savedSnapshot,
      };
      return { kind: 'conflict', conflict: this.#conflict };
    }
    this.#conflict = null;
    return { kind: 'restored' };
  }

  public persistRecovery(
    store: RecoveryStore,
    now: () => number = Date.now,
  ): Promise<RecoveryPersistOutcome> {
    this.#recoveryNow = now;
    this.#recoveryRequested = true;
    this.#recoveryLoop ??= this.#drainRecoveryQueue(store).finally(() => {
      this.#recoveryLoop = null;
    });
    return this.#recoveryLoop;
  }

  async #drainRecoveryQueue(store: RecoveryStore): Promise<RecoveryPersistOutcome> {
    let outcome: RecoveryPersistOutcome = { kind: 'clean' };
    while (this.#recoveryRequested) {
      this.#recoveryRequested = false;
      const state = this.state;
      if (!requiresRecovery(state)) {
        try {
          await store.remove(state.pathKey);
          this.#recoveryState = { kind: 'clean' };
          outcome = { kind: 'clean' };
          continue;
        } catch (error) {
          const message = errorMessage(error);
          this.#recoveryState = { kind: 'error', message };
          return { kind: 'error', message };
        }
      }

      const capturedAt = this.#recoveryNow();
      const bufferVersion = this.#bufferVersion;
      const record: RecoveryRecord = {
        schemaVersion: 1,
        path: this.#savedSnapshot.path,
        pathKey: this.#savedSnapshot.pathKey,
        savedRevision: this.#savedSnapshot.revision,
        buffer: this.#buffer,
        bufferVersion,
        capturedAt,
      };
      try {
        await store.write(record);
      } catch (error) {
        const message = errorMessage(error);
        this.#recoveryState = { kind: 'error', message };
        return { kind: 'error', message };
      }

      const currentState = this.state;
      if (!requiresRecovery(currentState)) {
        // A save may have completed while this write was in flight. Remove the stale recovery
        // in the same serialized queue so it cannot reappear after the clean state.
        this.#recoveryRequested = true;
        continue;
      }
      if (bufferVersion === this.#bufferVersion) {
        this.#recoveryState = { kind: 'persisted', bufferVersion, capturedAt };
        outcome = { kind: 'persisted', bufferVersion, capturedAt };
      } else {
        this.#recoveryState = { kind: 'pending', bufferVersion: this.#bufferVersion };
        outcome = {
          kind: 'superseded',
          persistedBufferVersion: bufferVersion,
          currentBufferVersion: this.#bufferVersion,
        };
      }
    }
    return outcome;
  }
}

export type RecoveryTimer = unknown;

export interface RecoveryScheduler {
  schedule(delayMs: number, task: () => void): RecoveryTimer;
  cancel(timer: RecoveryTimer): void;
}

export interface RecoveryClock {
  now(): number;
}

export type RecoveryFlushReason =
  | 'debounce'
  | 'periodic'
  | 'blur'
  | 'close'
  | 'prepare-for-restart'
  | 'manual';

export interface RecoveryCoordinatorOptions {
  readonly store: RecoveryStore;
  readonly scheduler: RecoveryScheduler;
  readonly clock: RecoveryClock;
  readonly debounceMs?: number;
  readonly periodicMs?: number;
}

export type RestartBlockReason =
  | { readonly kind: 'conflict'; readonly pathKey: WorkspacePathKey }
  | { readonly kind: 'save-in-progress'; readonly pathKey: WorkspacePathKey }
  | {
      readonly kind: 'save-error';
      readonly pathKey: WorkspacePathKey;
      readonly message: string;
    }
  | {
      readonly kind: 'recovery-error';
      readonly pathKey: WorkspacePathKey;
      readonly message: string;
    }
  | {
      readonly kind: 'recovery-not-current';
      readonly pathKey: WorkspacePathKey;
      readonly bufferVersion: number;
    };

export type PrepareForRestartResult =
  | { readonly kind: 'ready' }
  | { readonly kind: 'blocked'; readonly reasons: readonly RestartBlockReason[] };

interface RecoveryEntry {
  readonly session: DocumentSession;
  debounceTimer?: RecoveryTimer;
  periodicTimer?: RecoveryTimer;
}

export class RecoveryCoordinator {
  readonly #store: RecoveryStore;
  readonly #scheduler: RecoveryScheduler;
  readonly #clock: RecoveryClock;
  readonly #debounceMs: number;
  readonly #periodicMs: number;
  readonly #entries = new Map<DocumentSession, RecoveryEntry>();

  public constructor(options: RecoveryCoordinatorOptions) {
    this.#store = options.store;
    this.#scheduler = options.scheduler;
    this.#clock = options.clock;
    this.#debounceMs = options.debounceMs ?? 2_000;
    this.#periodicMs = options.periodicMs ?? 30_000;
    if (0 > this.#debounceMs || 0 >= this.#periodicMs) {
      throw new Error('Recovery timing values must be non-negative and periodicMs must be positive');
    }
  }

  public track(session: DocumentSession): Disposable {
    if (this.#entries.has(session)) {
      throw new Error('Document session is already tracked for recovery');
    }
    const entry: RecoveryEntry = { session };
    this.#entries.set(session, entry);
    if (requiresRecovery(session.state)) { this.#armForDirtyState(entry); }
    return {
      dispose: () => {
        if (this.#entries.get(session) !== entry) { return; }
        this.#cancelTimers(entry);
        this.#entries.delete(session);
      },
    };
  }

  /** Call after edits, save/reload completion, conflict changes and app rename rebinds. */
  public notifyChanged(session: DocumentSession): Promise<RecoveryPersistOutcome | null> {
    const entry = this.#requireEntry(session);
    if (requiresRecovery(session.state)) {
      this.#armForDirtyState(entry);
      return Promise.resolve(null);
    }
    this.#cancelTimers(entry);
    return this.#flushEntry(entry, 'manual');
  }

  public flush(
    session: DocumentSession,
    reason: RecoveryFlushReason,
  ): Promise<RecoveryPersistOutcome> {
    const entry = this.#requireEntry(session);
    if (undefined !== entry.debounceTimer) {
      this.#scheduler.cancel(entry.debounceTimer);
      entry.debounceTimer = undefined;
    }
    return this.#flushEntry(entry, reason);
  }

  public async flushAll(
    reason: RecoveryFlushReason,
  ): Promise<readonly RecoveryPersistOutcome[]> {
    return Promise.all([...this.#entries.values()].map((entry) => {
      if (undefined !== entry.debounceTimer) {
        this.#scheduler.cancel(entry.debounceTimer);
        entry.debounceTimer = undefined;
      }
      return this.#flushEntry(entry, reason);
    }));
  }

  public async prepareForRestart(): Promise<PrepareForRestartResult> {
    await this.flushAll('prepare-for-restart');
    const reasons: RestartBlockReason[] = [];
    for (const entry of this.#entries.values()) {
      const state = entry.session.state;
      if (state.conflict) {
        reasons.push({ kind: 'conflict', pathKey: state.pathKey });
        continue;
      }
      if ('saving' === state.saveState.kind) {
        reasons.push({ kind: 'save-in-progress', pathKey: state.pathKey });
        continue;
      }
      if ('error' === state.saveState.kind) {
        reasons.push({
          kind: 'save-error',
          pathKey: state.pathKey,
          message: state.saveState.message,
        });
        continue;
      }
      if ('error' === state.recoveryState.kind) {
        reasons.push({
          kind: 'recovery-error',
          pathKey: state.pathKey,
          message: state.recoveryState.message,
        });
        continue;
      }
      if (
        state.dirty &&
        !(
          'persisted' === state.recoveryState.kind &&
          state.bufferVersion === state.recoveryState.bufferVersion
        )
      ) {
        reasons.push({
          kind: 'recovery-not-current',
          pathKey: state.pathKey,
          bufferVersion: state.bufferVersion,
        });
      }
    }
    return 0 === reasons.length ? { kind: 'ready' } : { kind: 'blocked', reasons };
  }

  public dispose(): void {
    for (const entry of this.#entries.values()) { this.#cancelTimers(entry); }
    this.#entries.clear();
  }

  #requireEntry(session: DocumentSession): RecoveryEntry {
    const entry = this.#entries.get(session);
    if (!entry) { throw new Error('Document session is not tracked for recovery'); }
    return entry;
  }

  #armForDirtyState(entry: RecoveryEntry): void {
    if (undefined !== entry.debounceTimer) { this.#scheduler.cancel(entry.debounceTimer); }
    entry.debounceTimer = this.#scheduler.schedule(this.#debounceMs, () => {
      entry.debounceTimer = undefined;
      void this.#flushEntry(entry, 'debounce');
    });
    if (undefined === entry.periodicTimer) {
      entry.periodicTimer = this.#scheduler.schedule(this.#periodicMs, () => {
        entry.periodicTimer = undefined;
        void this.#flushEntry(entry, 'periodic');
      });
    }
  }

  async #flushEntry(
    entry: RecoveryEntry,
    _reason: RecoveryFlushReason,
  ): Promise<RecoveryPersistOutcome> {
    const outcome = await entry.session.persistRecovery(
      this.#store,
      () => this.#clock.now(),
    );
    if (undefined !== entry.periodicTimer) {
      this.#scheduler.cancel(entry.periodicTimer);
      entry.periodicTimer = undefined;
    }
    if (requiresRecovery(entry.session.state)) {
      entry.periodicTimer = this.#scheduler.schedule(this.#periodicMs, () => {
        entry.periodicTimer = undefined;
        void this.#flushEntry(entry, 'periodic');
      });
    }
    return outcome;
  }

  #cancelTimers(entry: RecoveryEntry): void {
    if (undefined !== entry.debounceTimer) {
      this.#scheduler.cancel(entry.debounceTimer);
      entry.debounceTimer = undefined;
    }
    if (undefined !== entry.periodicTimer) {
      this.#scheduler.cancel(entry.periodicTimer);
      entry.periodicTimer = undefined;
    }
  }
}

export interface WorkspaceWatchRefresh {
  readonly hint: WorkspaceChangeHint;
  readonly session: DocumentSession;
  readonly outcome: ExternalRefreshOutcome;
}

export class SessionRegistry {
  readonly #sessions = new Map<WorkspacePathKey, DocumentSession>();

  public open(snapshot: DocumentSnapshot, adapter: WorkspaceAdapter): DocumentSession {
    const existing = this.#sessions.get(snapshot.pathKey);
    if (existing) { return existing; }
    const session = new DocumentSession(snapshot, adapter);
    this.#sessions.set(snapshot.pathKey, session);
    return session;
  }

  public get(pathKey: WorkspacePathKey): DocumentSession | undefined {
    return this.#sessions.get(pathKey);
  }

  public bindWorkspaceWatch(
    adapter: WorkspaceAdapter,
    listener?: (refresh: WorkspaceWatchRefresh) => void,
  ): Disposable {
    return adapter.watch((hint) => {
      const session = hint.pathKey
        ? this.#sessions.get(hint.pathKey)
        : [...this.#sessions.values()].find(
            (candidate) => candidate.usesAdapter(adapter) && candidate.state.path === hint.path,
          );
      if (!session || !session.usesAdapter(adapter)) { return; }
      void session.refreshFromHost().then((outcome) => {
        listener?.({ hint, session, outcome });
      });
    });
  }

  public rekeyAfterHostRename(
    oldPathKey: WorkspacePathKey,
    snapshot: DocumentSnapshot,
  ): DocumentSession {
    const session = this.#sessions.get(oldPathKey);
    if (!session) { throw new Error('Cannot rename a document without an open session'); }
    const collision = this.#sessions.get(snapshot.pathKey);
    if (collision && collision !== session) {
      throw new Error('Cannot rename onto another open document session');
    }
    session.rebindAfterHostRename(snapshot);
    this.#sessions.delete(oldPathKey);
    this.#sessions.set(snapshot.pathKey, session);
    return session;
  }

  public release(pathKey: WorkspacePathKey): boolean {
    const session = this.#sessions.get(pathKey);
    if (!session) { return false; }
    const state = session.state;
    if (state.dirty || state.conflict || 'clean' !== state.recoveryState.kind) { return false; }
    if (0 < state.paneIds.length) { return false; }
    return this.#sessions.delete(pathKey);
  }

  public list(): readonly DocumentSession[] {
    return [...this.#sessions.values()];
  }
}
