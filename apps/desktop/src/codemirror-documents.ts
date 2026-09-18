import type { DocumentSession } from '@mdular/core';
import type { PaneId } from '@mdular/editor';

import type {
  CodeMirrorDocument,
  CodeMirrorTextEditor,
} from './codemirror-editor.js';

interface PaneDocumentAttachment {
  readonly session: DocumentSession;
  readonly document: CodeMirrorDocument;
  readonly master: CodeMirrorDocument;
}
/** Keeps CodeMirror documents host-local while DocumentSession remains the content authority. */
export class CodeMirrorDocumentPool {
  readonly #masters = new WeakMap<DocumentSession, CodeMirrorDocument>();
  readonly #attachments = new Map<PaneId, PaneDocumentAttachment>();

  public attach(
    paneId: PaneId,
    editor: CodeMirrorTextEditor,
    session: DocumentSession,
  ): void {
    const current = this.#attachments.get(paneId);
    if (current?.session === session) { return; }
    this.#unlink(paneId);

    let master = this.#masters.get(session);
    if (!master) {
      master = editor.createDocument(session.state.buffer);
      this.#masters.set(session, master);
    }
    const masterAttachedElsewhere = [...this.#attachments.entries()].some(
      ([attachedPaneId, attachment]) =>
        attachedPaneId !== paneId && attachment.session === session,
    );
    const document = masterAttachedElsewhere
      ? master.linkedDoc({ sharedHist: true })
      : master;
    editor.swapDocument(document);
    this.#attachments.set(paneId, { session, document, master });
  }

  public detach(paneId: PaneId, editor: CodeMirrorTextEditor): void {
    this.#unlink(paneId);
    editor.swapDocument(editor.createDocument(''));
  }

  public release(session: DocumentSession): void {
    const stillAttached = [...this.#attachments.values()].some(
      (attachment) => attachment.session === session,
    );
    if (!stillAttached) { this.#masters.delete(session); }
  }

  public dispose(): void {
    for (const paneId of [...this.#attachments.keys()]) { this.#unlink(paneId); }
  }

  #unlink(paneId: PaneId): void {
    const attachment = this.#attachments.get(paneId);
    if (!attachment) { return; }
    if (attachment.document !== attachment.master) {
      attachment.master.unlinkDoc(attachment.document);
    }
    this.#attachments.delete(paneId);
  }
}
