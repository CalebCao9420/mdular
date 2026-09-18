import type {
  Disposable,
  DocumentReadOnlyError,
  DocumentSession,
} from '@mdular/core';

export interface TextEditorPort {
  getValue(): string;
  setValue(content: string): void;
  setReadOnly(readOnly: boolean): void;
  subscribe(listener: () => void): Disposable;
}

export interface SessionEditorBindingOptions {
  readonly onEdited?: (session: DocumentSession) => void;
  readonly onReadOnlyEdit?: (error: DocumentReadOnlyError) => void;
}

function isDocumentReadOnlyError(error: unknown): error is DocumentReadOnlyError {
  return (
    error instanceof Error &&
    'DocumentReadOnlyError' === error.name &&
    'unsupported-encoding' === (error as Partial<DocumentReadOnlyError>).reason
  );
}

export class SessionEditorBinding implements Disposable {
  readonly #session: DocumentSession;
  readonly #editor: TextEditorPort;
  readonly #subscription: Disposable;
  readonly #onEdited: (session: DocumentSession) => void;
  readonly #onReadOnlyEdit: (error: DocumentReadOnlyError) => void;
  #synchronizing = false;
  #disposed = false;

  public constructor(
    session: DocumentSession,
    editor: TextEditorPort,
    options: SessionEditorBindingOptions = {},
  ) {
    this.#session = session;
    this.#editor = editor;
    this.#onEdited = options.onEdited ?? (() => {});
    this.#onReadOnlyEdit = options.onReadOnlyEdit ?? (() => {});
    this.syncFromSession();
    this.#subscription = editor.subscribe(() => this.#handleEditorChange());
  }

  public get session(): DocumentSession {
    return this.#session;
  }

  public syncFromSession(): void {
    if (this.#disposed) { return; }
    const state = this.#session.state;
    this.#editor.setReadOnly('read-only' === state.savedSnapshot.access.kind);
    if (this.#editor.getValue() === state.buffer) { return; }
    this.#synchronizing = true;
    try {
      this.#editor.setValue(state.buffer);
    } finally {
      this.#synchronizing = false;
    }
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#subscription.dispose();
  }

  #handleEditorChange(): void {
    if (this.#disposed || this.#synchronizing) { return; }
    try {
      const previousBufferVersion = this.#session.state.bufferVersion;
      this.#session.edit(this.#editor.getValue());
      if (previousBufferVersion !== this.#session.state.bufferVersion) {
        this.#onEdited(this.#session);
      }
    } catch (error) {
      if (!isDocumentReadOnlyError(error)) { throw error; }
      this.#onReadOnlyEdit(error);
      this.syncFromSession();
    }
  }
}
