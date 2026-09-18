import type { DocumentSession } from '@mdular/core';
import type {
  Disposable,
  PluginActiveDocumentEdit,
  PluginActiveDocumentEditResult,
  PluginDocumentListener,
  PluginDocumentSaveState,
  PluginDocumentsService,
  PluginDocumentSnapshot,
} from '@mdular/plugin-sdk';

const MAX_ACTIVE_EDIT_BYTES = 2 * 1024 * 1024;

export type DesktopPluginDocumentEvent = 'open' | 'change' | 'save' | 'activatePane';
export type DesktopPluginFailureHandler = (
  pluginId: string,
  phase: 'provider' | 'render',
  error: unknown,
) => void;

interface OwnedListener {
  readonly pluginId: string;
  readonly listener: PluginDocumentListener;
}

export type DesktopActiveDocumentEditHandler = (
  edit: PluginActiveDocumentEdit,
) => Promise<PluginActiveDocumentEditResult>;

function snapshotFromSession(session: DocumentSession): PluginDocumentSnapshot {
  const state = session.state;
  return Object.freeze({
    path: state.path,
    content: state.buffer,
    revision: String(state.savedSnapshot.revision),
    bufferVersion: state.bufferVersion,
    dirty: state.dirty,
  });
}

export class DesktopPluginDocumentHub {
  readonly #listeners: Record<DesktopPluginDocumentEvent, Set<OwnedListener>> = {
    open: new Set(),
    change: new Set(),
    save: new Set(),
    activatePane: new Set(),
  };
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #editActive: DesktopActiveDocumentEditHandler | undefined;
  readonly #listOpenSessions: (() => readonly DocumentSession[]) | undefined;
  #activeSnapshot: PluginDocumentSnapshot | null = null;

  public constructor(
    onFailure: DesktopPluginFailureHandler,
    editActive?: DesktopActiveDocumentEditHandler,
    listOpenSessions?: () => readonly DocumentSession[],
  ) {
    this.#onFailure = onFailure;
    this.#editActive = editActive;
    this.#listOpenSessions = listOpenSessions;
  }

  public createService(
    pluginId: string,
    capabilities: { readonly editActive?: boolean } = {},
  ): PluginDocumentsService {
    return {
      getActiveSnapshot: () => this.#activeSnapshot,
      listOpenSaveStates: () => this.#listOpenSaveStates(),
      ...(capabilities.editActive && this.#editActive
        ? { applyActiveEdit: (edit: PluginActiveDocumentEdit) => this.#applyEdit(edit) }
        : {}),
      onDidOpen: (listener) => this.#subscribe(pluginId, 'open', listener),
      onDidChange: (listener) => this.#subscribe(pluginId, 'change', listener),
      onDidSave: (listener) => this.#subscribe(pluginId, 'save', listener),
      onDidActivatePane: (listener) => this.#subscribe(pluginId, 'activatePane', listener),
    };
  }

  #listOpenSaveStates(): readonly PluginDocumentSaveState[] {
    const sessions = this.#listOpenSessions?.() ?? [];
    const seen = new Set<DocumentSession>();
    const states: PluginDocumentSaveState[] = [];
    for (const session of sessions) {
      if (seen.has(session)) { continue; }
      seen.add(session);
      const state = session.state;
      states.push(Object.freeze({
        path: state.path,
        revision: String(state.savedSnapshot.revision),
        bufferVersion: state.bufferVersion,
        dirty: state.dirty,
      }));
    }
    return Object.freeze(states);
  }

  async #applyEdit(edit: PluginActiveDocumentEdit): Promise<PluginActiveDocumentEditResult> {
    if (
      !edit ||
      'string' !== typeof edit.path ||
      '' === edit.path ||
      !Number.isSafeInteger(edit.expectedBufferVersion) ||
      edit.expectedBufferVersion < 0 ||
      'string' !== typeof edit.content
    ) { throw new Error('Active document edit is malformed'); }
    if (MAX_ACTIVE_EDIT_BYTES < new TextEncoder().encode(edit.content).byteLength) {
      throw new Error('Active document edit exceeds the content limit');
    }
    if (!this.#editActive) { throw new Error('Active document editing is unavailable'); }
    return this.#editActive(edit);
  }

  public setActive(session: DocumentSession | null): void {
    this.#activeSnapshot = session ? snapshotFromSession(session) : null;
  }

  public emit(event: DesktopPluginDocumentEvent, session: DocumentSession): void {
    const snapshot = snapshotFromSession(session);
    this.#activeSnapshot = snapshot;
    for (const owned of [...this.#listeners[event]]) {
      try {
        void Promise.resolve(owned.listener(snapshot)).catch((error: unknown) => {
          this.#onFailure(owned.pluginId, 'provider', error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, 'provider', error);
      }
    }
  }

  public listenerCount(pluginId?: string): number {
    return Object.values(this.#listeners).reduce(
      (total, listeners) => total + [...listeners]
        .filter((owned) => undefined === pluginId || owned.pluginId === pluginId).length,
      0,
    );
  }

  public releasePlugin(pluginId: string): void {
    for (const listeners of Object.values(this.#listeners)) {
      for (const owned of [...listeners]) {
        if (owned.pluginId === pluginId) { listeners.delete(owned); }
      }
    }
  }

  #subscribe(
    pluginId: string,
    event: DesktopPluginDocumentEvent,
    listener: PluginDocumentListener,
  ): Disposable {
    const owned = { pluginId, listener };
    this.#listeners[event].add(owned);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        this.#listeners[event].delete(owned);
      },
    };
  }
}

export { snapshotFromSession as createPluginDocumentSnapshot };
