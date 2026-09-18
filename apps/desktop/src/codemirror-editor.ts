import type { Disposable } from '@mdular/core';
import type { PaneViewState, TextEditorPort } from '@mdular/editor';
import type { PluginEditorFeature } from '@mdular/plugin-sdk';

import { DesktopEditorEnhancements } from './editor-enhancements.js';
import type {
  EditorMediaAssetLease,
  EditorMediaInput,
} from './editor-enhancements.js';

interface CodeMirrorPosition {
  readonly line: number;
  readonly ch: number;
}

interface CodeMirrorScrollInfo {
  readonly left: number;
  readonly top: number;
}

interface CodeMirrorLineWidget {
  clear(): void;
}

export interface CodeMirrorDocument {
  getValue(): string;
  linkedDoc(options: { readonly sharedHist: boolean }): CodeMirrorDocument;
  unlinkDoc(document: CodeMirrorDocument): void;
}

interface CodeMirrorEditor {
  addLineWidget(
    line: number,
    node: HTMLElement,
    options: Readonly<Record<string, unknown>>,
  ): CodeMirrorLineWidget;
  addKeyMap(map: Record<string, (editor: CodeMirrorEditor) => void>): void;
  removeKeyMap(map: Record<string, (editor: CodeMirrorEditor) => void>): void;
  focus(): void;
  coordsChar(coords: { readonly left: number; readonly top: number }): CodeMirrorPosition;
  getCursor(which: 'anchor' | 'head'): CodeMirrorPosition;
  getScrollInfo(): CodeMirrorScrollInfo;
  getDoc(): CodeMirrorDocument;
  getLine(line: number): string;
  getWrapperElement(): HTMLElement;
  getValue(): string;
  hasFocus(): boolean;
  indexFromPos(position: CodeMirrorPosition): number;
  off(event: 'change', listener: (editor: CodeMirrorEditor) => void): void;
  on(event: 'change', listener: (editor: CodeMirrorEditor) => void): void;
  posFromIndex(index: number): CodeMirrorPosition;
  refresh(): void;
  replaceRange(text: string, from: CodeMirrorPosition): void;
  scrollTo(left: number, top: number): void;
  setCursor(position: CodeMirrorPosition): void;
  setOption(name: string, value: unknown): void;
  setSelection(anchor: CodeMirrorPosition, head: CodeMirrorPosition): void;
  setSize(width: string | null, height: string | null): void;
  setValue(content: string): void;
  swapDoc(document: CodeMirrorDocument): CodeMirrorDocument;
}

export interface CodeMirrorTextEditorOptions {
  readonly onOpenWikiLink?: (target: string) => void;
  readonly onInsertMedia?: (input: EditorMediaInput) => Promise<void>;
  readonly resolveMedia?: (path: string) => Promise<EditorMediaAssetLease>;
  readonly onDiagnostic?: (message: string) => void;
}

interface CodeMirrorStatic {
  readonly Doc: new (content: string, mode: string) => CodeMirrorDocument;
  fromTextArea(
    textarea: HTMLTextAreaElement,
    options: Readonly<Record<string, unknown>>,
  ): CodeMirrorEditor;
}

function codeMirrorStatic(): CodeMirrorStatic {
  const candidate = (window as Window & { CodeMirror?: unknown }).CodeMirror;
  if (!candidate || 'object' !== typeof candidate && 'function' !== typeof candidate) {
    throw new Error('CodeMirror 5 is unavailable in the V2 runtime');
  }
  const fromTextArea = (candidate as Partial<CodeMirrorStatic>).fromTextArea;
  if ('function' !== typeof fromTextArea) {
    throw new Error('CodeMirror 5 fromTextArea is unavailable in the V2 runtime');
  }
  return candidate as CodeMirrorStatic;
}

export class CodeMirrorTextEditor implements TextEditorPort, Disposable {
  readonly #editor: CodeMirrorEditor;
  readonly #listeners = new Set<() => void>();
  readonly #handleChange = (): void => {
    for (const listener of this.#listeners) { listener(); }
    this.#enhancements?.schedule();
  };
  readonly #tableKeyMap = {
    'Cmd-Shift-T': (editor: CodeMirrorEditor): void => this.#insertTable(editor),
    'Ctrl-Shift-T': (editor: CodeMirrorEditor): void => this.#insertTable(editor),
  };
  #disposed = false;
  #enhancements: DesktopEditorEnhancements | null = null;
  #pluginFeatures: ReadonlySet<PluginEditorFeature> = new Set();

  public constructor(textarea: HTMLTextAreaElement, options: CodeMirrorTextEditorOptions = {}) {
    this.#editor = codeMirrorStatic().fromTextArea(textarea, {
      lineNumbers: false,
      lineWrapping: true,
      mode: 'markdown',
      viewportMargin: 20,
    });
    this.#editor.setSize('100%', '100%');
    this.#editor.on('change', this.#handleChange);
    const document = textarea.ownerDocument;
    const window = document?.defaultView;
    if (document && window) {
      this.#enhancements = new DesktopEditorEnhancements(this.#editor, {
        document,
        window,
        ...(options.onOpenWikiLink ? { onOpenWikiLink: options.onOpenWikiLink } : {}),
        ...(options.onInsertMedia ? { onInsertMedia: options.onInsertMedia } : {}),
        ...(options.resolveMedia ? { resolveMedia: options.resolveMedia } : {}),
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      });
    }
  }

  public getValue(): string {
    return this.#editor.getValue();
  }

  public setValue(content: string): void {
    this.#editor.setValue(content);
  }

  public setReadOnly(readOnly: boolean): void {
    this.#editor.setOption('readOnly', readOnly);
  }

  public subscribe(listener: () => void): Disposable {
    if (this.#disposed) { throw new Error('Cannot subscribe to a disposed editor'); }
    this.#listeners.add(listener);
    return { dispose: () => { this.#listeners.delete(listener); } };
  }

  public bindSave(handler: () => void): Disposable {
    const map = {
      'Cmd-S': (): void => handler(),
      'Ctrl-S': (): void => handler(),
    };
    this.#editor.addKeyMap(map);
    return { dispose: () => this.#editor.removeKeyMap(map) };
  }

  public setPluginFeatures(features: ReadonlySet<PluginEditorFeature>): void {
    if (this.#disposed) { return; }
    const hadTables = this.#pluginFeatures.has('tables');
    const next = new Set(features);
    this.#pluginFeatures = next;
    this.#editor.setOption('mode', 0 === next.size ? 'markdown' : {
      name: 'markdown',
      emoji: next.has('emoji'),
      fencedCodeBlockHighlighting: next.has('code-languages'),
      strikethrough: true,
      taskLists: true,
    });
    this.#enhancements?.setFeatures(next);
    if (hadTables && !next.has('tables')) {
      this.#editor.removeKeyMap(this.#tableKeyMap);
    } else if (!hadTables && next.has('tables')) {
      this.#editor.addKeyMap(this.#tableKeyMap);
    }
    this.#editor.refresh();
  }

  public createDocument(content: string): CodeMirrorDocument {
    return new (codeMirrorStatic().Doc)(content, 'markdown');
  }

  public getDocument(): CodeMirrorDocument {
    return this.#editor.getDoc();
  }

  public swapDocument(document: CodeMirrorDocument): CodeMirrorDocument {
    const previous = this.#editor.swapDoc(document);
    this.#enhancements?.schedule();
    return previous;
  }

  public captureView(): PaneViewState {
    const scroll = this.#editor.getScrollInfo();
    return {
      selectionAnchor: this.#editor.indexFromPos(this.#editor.getCursor('anchor')),
      selectionHead: this.#editor.indexFromPos(this.#editor.getCursor('head')),
      scrollLeft: Math.max(0, scroll.left),
      scrollTop: Math.max(0, scroll.top),
      focused: this.#editor.hasFocus(),
    };
  }

  public restoreView(view: PaneViewState): void {
    const valueLength = this.#editor.getValue().length;
    const anchor = Math.min(view.selectionAnchor, valueLength);
    const head = Math.min(view.selectionHead, valueLength);
    this.#editor.setSelection(
      this.#editor.posFromIndex(anchor),
      this.#editor.posFromIndex(head),
    );
    this.#editor.scrollTo(view.scrollLeft, view.scrollTop);
    if (view.focused) { this.#editor.focus(); }
    this.#editor.refresh();
  }

  public focus(): void {
    this.#editor.focus();
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#listeners.clear();
    this.#enhancements?.dispose();
    this.#enhancements = null;
    if (this.#pluginFeatures.has('tables')) { this.#editor.removeKeyMap(this.#tableKeyMap); }
    this.#pluginFeatures = new Set();
    this.#editor.off('change', this.#handleChange);
  }

  #insertTable(editor: CodeMirrorEditor): void {
    const cursor = editor.getCursor('head');
    editor.replaceRange([
      '| Column | Column |',
      '| ------ | ------ |',
      '|        |        |',
      '',
    ].join('\n'), cursor);
    editor.setCursor({ line: cursor.line + 2, ch: 2 });
    editor.focus();
  }
}
