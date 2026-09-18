import type { Disposable, DocumentSession } from '@mdular/core';
import type { LineDiffResult, UnifiedDiffLine } from '@mdular/editor';

import type { LineDiffTaskRunner } from './diff-runner.js';

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tagName);
  result.className = className;
  if (undefined !== text) { result.textContent = text; }
  return result;
}

function linePrefix(line: UnifiedDiffLine): string {
  if ('add' === line.kind) { return '+'; }
  if ('delete' === line.kind) { return '-'; }
  return ' ';
}

export class DesktopDiffView implements Disposable {
  readonly #document: Document;
  readonly #host: HTMLElement;
  readonly #runner: LineDiffTaskRunner;
  #request: Disposable | null = null;
  #session: DocumentSession | null = null;
  #open = false;
  #disposed = false;

  public constructor(document: Document, host: HTMLElement, runner: LineDiffTaskRunner) {
    this.#document = document;
    this.#host = host;
    this.#runner = runner;
    this.#host.hidden = true;
    this.#host.dataset.state = 'closed';
  }

  public get isOpen(): boolean {
    return this.#open;
  }

  public get session(): DocumentSession | null {
    return this.#session;
  }

  public open(session: DocumentSession): void {
    if (this.#disposed) { throw new Error('Cannot open a disposed diff view'); }
    this.#open = true;
    this.#session = session;
    this.#host.hidden = false;
    this.refresh(session);
  }

  public refresh(session: DocumentSession): void {
    if (!this.#open || this.#session !== session) { return; }
    this.#request?.dispose();
    const state = session.state;
    const bufferVersion = state.bufferVersion;
    this.#renderPending();
    this.#request = this.#runner.request(
      state.savedSnapshot.content,
      state.buffer,
      bufferVersion,
      (completion) => {
        if (
          !this.#open ||
          this.#session !== session ||
          completion.bufferVersion !== session.state.bufferVersion
        ) {
          return;
        }
        this.#request = null;
        this.#renderResult(completion.result);
      },
    );
  }

  public close(): void {
    this.#request?.dispose();
    this.#request = null;
    this.#session = null;
    this.#open = false;
    this.#host.hidden = true;
    this.#host.dataset.state = 'closed';
    this.#host.replaceChildren();
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.close();
    this.#runner.dispose();
  }

  #renderPending(): void {
    this.#host.dataset.state = 'pending';
    this.#host.replaceChildren(
      element(this.#document, 'p', 'v2-diff-message', 'Computing saved snapshot ↔ buffer diff…'),
    );
  }

  #renderResult(result: LineDiffResult): void {
    if ('identical' === result.kind) {
      this.#host.dataset.state = 'identical';
      this.#host.replaceChildren(
        element(this.#document, 'p', 'v2-diff-message', 'Buffer matches the saved snapshot.'),
      );
      return;
    }
    if ('changed-block' === result.kind) {
      this.#host.dataset.state = 'changed-block';
      const block = element(this.#document, 'div', 'v2-diff-block');
      block.append(
        element(
          this.#document,
          'div',
          'v2-diff-hunk-header',
          `@@ -${result.oldStart},${result.oldLines} +${result.newStart},${result.newLines} @@`,
        ),
        element(
          this.#document,
          'p',
          'v2-diff-message',
          `Bounded changed block (${result.reason}); detailed line diff was not computed.`,
        ),
      );
      this.#host.replaceChildren(block);
      return;
    }

    this.#host.dataset.state = 'hunks';
    const blocks: HTMLElement[] = [];
    for (const hunk of result.hunks) {
      const block = element(this.#document, 'div', 'v2-diff-block');
      block.append(element(
        this.#document,
        'div',
        'v2-diff-hunk-header',
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ));
      for (const line of hunk.lines) {
        const lineElement = element(
          this.#document,
          'div',
          `v2-diff-line v2-diff-${line.kind}`,
        );
        lineElement.textContent = `${linePrefix(line)}${line.text}`;
        block.append(lineElement);
      }
      blocks.push(block);
    }
    this.#host.replaceChildren(...blocks);
  }
}
