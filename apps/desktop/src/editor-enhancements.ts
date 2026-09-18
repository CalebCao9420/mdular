import type { PluginEditorFeature } from '@mdular/plugin-sdk';

interface CodeMirrorPosition {
  readonly line: number;
  readonly ch: number;
}

interface CodeMirrorLineWidget {
  clear(): void;
}

export interface EditorEnhancementPort {
  addLineWidget(
    line: number,
    node: HTMLElement,
    options: Readonly<Record<string, unknown>>,
  ): CodeMirrorLineWidget;
  coordsChar(coords: { readonly left: number; readonly top: number }): CodeMirrorPosition;
  getCursor(which: 'anchor' | 'head'): CodeMirrorPosition;
  getLine(line: number): string;
  getValue(): string;
  getWrapperElement(): HTMLElement;
  indexFromPos(position: CodeMirrorPosition): number;
  setOption(name: string, value: unknown): void;
  refresh(): void;
}

export interface EditorEnhancementOptions {
  readonly document: Document;
  readonly window: Window;
  readonly onOpenWikiLink?: (target: string) => void;
  readonly onInsertMedia?: (input: EditorMediaInput) => Promise<void>;
  readonly resolveMedia?: (path: string) => Promise<EditorMediaAssetLease>;
  readonly onDiagnostic?: (message: string) => void;
}

export interface EditorMediaInput {
  readonly file: File;
  readonly selectionAnchor: number;
  readonly selectionHead: number;
  readonly source: 'drop' | 'paste';
}

export interface EditorMediaAssetLease {
  readonly url: string;
  release(): void;
}

export interface EditorMediaPreview {
  readonly alt: string;
  readonly kind: 'audio' | 'image' | 'video';
  readonly line: number;
  readonly path: string;
}

export interface EditorPreviewBlock {
  readonly kind: 'math' | 'mermaid';
  readonly line: number;
  readonly source: string;
}

export const EDITOR_ENHANCEMENT_LIMITS = Object.freeze({
  maxDocumentCharacters: 2 * 1024 * 1024,
  maxLines: 20_000,
  maxPreviews: 32,
  maxPreviewCharacters: 64 * 1024,
  maxTotalPreviewCharacters: 256 * 1024,
  maxMediaFileBytes: 16 * 1024 * 1024,
  maxMediaPreviews: 32,
});

const MEDIA_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const CODE_MODE_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  bash: 'lib/codemirror-shell.js',
  go: 'lib/codemirror-go.js',
  javascript: 'lib/codemirror-javascript.js',
  js: 'lib/codemirror-javascript.js',
  php: 'lib/codemirror-php.js',
  py: 'lib/codemirror-python.js',
  python: 'lib/codemirror-python.js',
  sh: 'lib/codemirror-shell.js',
  shell: 'lib/codemirror-shell.js',
  typescript: 'lib/codemirror-javascript.js',
  ts: 'lib/codemirror-javascript.js',
});

const scriptLoads = new WeakMap<Document, Map<string, Promise<void>>>();
const initializedMermaidWindows = new WeakSet<object>();
let mermaidCounter = 0;
let mermaidQueue: Promise<void> = Promise.resolve();

function normalizedLines(content: string): readonly string[] {
  return content.replace(/\r\n?/gu, '\n').split('\n');
}

/** Parses only the bounded preview syntax owned by the host. Source text is never consumed. */
export function parseEditorPreviewBlocks(content: string): readonly EditorPreviewBlock[] {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) { return []; }
  const lines = normalizedLines(content);
  if (EDITOR_ENHANCEMENT_LIMITS.maxLines < lines.length) { return []; }
  const result: EditorPreviewBlock[] = [];
  let totalCharacters = 0;
  let fence: { readonly line: number; readonly language: string; readonly body: string[] } | null = null;
  let displayMath: { readonly line: number; readonly body: string[] } | null = null;

  const append = (block: EditorPreviewBlock): void => {
    if (
      EDITOR_ENHANCEMENT_LIMITS.maxPreviews <= result.length ||
      EDITOR_ENHANCEMENT_LIMITS.maxPreviewCharacters < block.source.length ||
      EDITOR_ENHANCEMENT_LIMITS.maxTotalPreviewCharacters < totalCharacters + block.source.length
    ) { return; }
    totalCharacters += block.source.length;
    result.push(block);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fence) {
      if (/^ {0,3}```\s*$/u.test(line)) {
        if ('mermaid' === fence.language) {
          append({ kind: 'mermaid', line: index, source: fence.body.join('\n') });
        }
        fence = null;
      } else if (EDITOR_ENHANCEMENT_LIMITS.maxPreviewCharacters >= fence.body.join('\n').length) {
        fence.body.push(line);
      }
      continue;
    }
    const fenceStart = /^ {0,3}```\s*([A-Za-z0-9_-]+)?\s*$/u.exec(line);
    if (fenceStart) {
      fence = {
        line: index,
        language: (fenceStart[1] ?? '').toLocaleLowerCase('en-US'),
        body: [],
      };
      continue;
    }
    if (displayMath) {
      if (/^\s*\$\$\s*$/u.test(line)) {
        append({ kind: 'math', line: index, source: displayMath.body.join('\n') });
        displayMath = null;
      } else {
        displayMath.body.push(line);
      }
      continue;
    }
    if (/^\s*\$\$\s*$/u.test(line)) {
      displayMath = { line: index, body: [] };
      continue;
    }
    const singleDisplay = /^\s*\$\$([^$]+)\$\$\s*$/u.exec(line);
    if (singleDisplay) {
      append({ kind: 'math', line: index, source: singleDisplay[1] ?? '' });
      continue;
    }
    const standaloneInline = /^\s*\$([^$\n]+)\$\s*$/u.exec(line);
    if (standaloneInline) {
      append({ kind: 'math', line: index, source: standaloneInline[1] ?? '' });
    }
  }
  return result;
}

export function fencedCodeLanguages(content: string): ReadonlySet<string> {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) { return new Set(); }
  const result = new Set<string>();
  for (const line of normalizedLines(content).slice(0, EDITOR_ENHANCEMENT_LIMITS.maxLines)) {
    const match = /^ {0,3}```\s*([A-Za-z0-9_-]+)\s*$/u.exec(line);
    if (match?.[1]) { result.add(match[1].toLocaleLowerCase('en-US')); }
    if (Object.keys(CODE_MODE_ASSETS).length <= result.size) { break; }
  }
  return result;
}

export function wikiLinkAt(line: string, character: number): string | null {
  if (1024 < line.length || character < 0 || line.length < character) { return null; }
  const matcher = /\[\[([^\]|\n]{1,512})(?:\|[^\]\n]{0,512})?\]\]/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line))) {
    if (match.index <= character && character <= match.index + match[0].length) {
      return (match[1] ?? '').trim() || null;
    }
  }
  return null;
}

function mediaKind(path: string): EditorMediaPreview['kind'] | null {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? '';
  if (['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension)) {
    return 'image';
  }
  if (['mov', 'mp4', 'webm'].includes(extension)) { return 'video'; }
  if (['mp3', 'oga', 'ogg', 'wav', 'weba'].includes(extension)) { return 'audio'; }
  return null;
}

function safeMediaPath(value: string): string | null {
  const path = value.trim().replace(/%20/gu, ' ');
  if (
    '' === path ||
    1024 < path.length ||
    !path.startsWith('media/') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[?#]/u.test(path)
  ) { return null; }
  const segments = path.split('/');
  if (segments.some((segment) => '' === segment || '.' === segment || '..' === segment)) {
    return null;
  }
  return mediaKind(path) ? path : null;
}

export function parseEditorMediaPreviews(content: string): readonly EditorMediaPreview[] {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) { return []; }
  const lines = normalizedLines(content);
  if (EDITOR_ENHANCEMENT_LIMITS.maxLines < lines.length) { return []; }
  const previews: EditorMediaPreview[] = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^ {0,3}```/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) { continue; }
    const markdown = /!\[([^\]\n]{0,512})\]\(([^)\n]{1,1024})\)/u.exec(line);
    const wiki = /!\[\[([^\]|\n]{1,1024})(?:\|([^\]\n]{0,512}))?\]\]/u.exec(line);
    const rawPath = markdown?.[2] ?? wiki?.[1];
    if (!rawPath) { continue; }
    const path = safeMediaPath(rawPath);
    const kind = path ? mediaKind(path) : null;
    if (!path || !kind) { continue; }
    previews.push({
      alt: (markdown?.[1] ?? wiki?.[2] ?? '').trim(),
      kind,
      line: index,
      path,
    });
    if (EDITOR_ENHANCEMENT_LIMITS.maxMediaPreviews <= previews.length) { break; }
  }
  return previews;
}

export function isSafeSvgReference(value: string): boolean {
  const normalized = value.trim();
  return '' === normalized || /^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(normalized);
}

export function sanitizeSvgStyle(value: string): string | null {
  if (
    4096 < value.length ||
    /(?:javascript\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding)/iu.test(value) ||
    /url\s*\((?!\s*['"]?#[A-Za-z_][A-Za-z0-9_.:-]*['"]?\s*\))/iu.test(value)
  ) { return null; }
  return value;
}

/** Parses Mermaid output as inert SVG and removes active/foreign content before adoption. */
export function sanitizeMermaidSvg(document: Document, markup: string): SVGElement {
  if (1024 * 1024 < markup.length) { throw new Error('Mermaid SVG exceeds the output limit'); }
  const Parser = (document.defaultView as (Window & { DOMParser?: typeof DOMParser }) | null)
    ?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if ('svg' !== root.localName || parsed.querySelector('parsererror')) {
    throw new Error('Mermaid returned invalid SVG');
  }
  const forbidden = new Set([
    'audio', 'canvas', 'embed', 'foreignobject', 'iframe', 'object', 'script', 'video',
  ]);
  for (const element of [root, ...parsed.querySelectorAll('*')]) {
    const localName = element.localName.toLocaleLowerCase('en-US');
    if (forbidden.has(localName)) {
      element.remove();
      continue;
    }
    if ('style' === localName) {
      const safe = sanitizeSvgStyle(element.textContent ?? '');
      if (null === safe) { element.remove(); } else { element.textContent = safe; }
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase('en-US');
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if ('href' === name || 'xlink:href' === name || 'src' === name) {
        if (!isSafeSvgReference(attribute.value)) { element.removeAttribute(attribute.name); }
      } else if ('style' === name) {
        const safe = sanitizeSvgStyle(attribute.value);
        if (null === safe) { element.removeAttribute(attribute.name); }
      }
    }
  }
  return document.importNode(root, true) as unknown as SVGElement;
}

function loadScript(
  document: Document,
  window: Window,
  path: string,
  ready?: () => boolean,
): Promise<void> {
  if (ready?.()) { return Promise.resolve(); }
  let loads = scriptLoads.get(document);
  if (!loads) {
    loads = new Map();
    scriptLoads.set(document, loads);
  }
  const existing = loads.get(path);
  if (existing) { return existing; }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const stamp = (window as Window & { COMMIT_HASH?: string }).COMMIT_HASH ?? '';
    script.src = `${path}${stamp}`;
    script.async = true;
    script.addEventListener('load', () => {
      if (!ready || ready()) { resolve(); } else { reject(new Error(`${path} did not register`)); }
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`${path} failed to load`)), {
      once: true,
    });
    document.head.append(script);
  }).catch((error: unknown) => {
    loads?.delete(path);
    throw error;
  });
  loads.set(path, promise);
  return promise;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DesktopEditorEnhancements {
  readonly #editor: EditorEnhancementPort;
  readonly #document: Document;
  readonly #window: Window;
  readonly #onOpenWikiLink: ((target: string) => void) | undefined;
  readonly #onInsertMedia: ((input: EditorMediaInput) => Promise<void>) | undefined;
  readonly #resolveMedia: ((path: string) => Promise<EditorMediaAssetLease>) | undefined;
  readonly #onDiagnostic: (message: string) => void;
  readonly #widgets: CodeMirrorLineWidget[] = [];
  readonly #mediaLeases: EditorMediaAssetLease[] = [];
  readonly #onClick = (event: MouseEvent): void => {
    if (!this.#features.has('wiki-links') || 0 !== event.button) { return; }
    const position = this.#editor.coordsChar({ left: event.clientX, top: event.clientY });
    const target = wikiLinkAt(this.#editor.getLine(position.line), position.ch);
    if (!target) { return; }
    event.preventDefault();
    event.stopPropagation();
    this.#onOpenWikiLink?.(target);
  };
  readonly #onPaste = (event: ClipboardEvent): void => {
    if (!this.#features.has('media')) { return; }
    const file = this.#firstSupportedMedia(event.clipboardData?.files);
    if (!file) { return; }
    event.preventDefault();
    const anchor = this.#editor.indexFromPos(this.#editor.getCursor('anchor'));
    const head = this.#editor.indexFromPos(this.#editor.getCursor('head'));
    void this.#submitMedia({
      file,
      selectionAnchor: anchor,
      selectionHead: head,
      source: 'paste',
    });
  };
  readonly #onDragOver = (event: DragEvent): void => {
    if (!this.#features.has('media') || !this.#firstSupportedMedia(event.dataTransfer?.files)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) { event.dataTransfer.dropEffect = 'copy'; }
  };
  readonly #onDrop = (event: DragEvent): void => {
    if (!this.#features.has('media')) { return; }
    const file = this.#firstSupportedMedia(event.dataTransfer?.files);
    if (!file) { return; }
    event.preventDefault();
    const position = this.#editor.coordsChar({ left: event.clientX, top: event.clientY });
    const offset = this.#editor.indexFromPos(position);
    void this.#submitMedia({
      file,
      selectionAnchor: offset,
      selectionHead: offset,
      source: 'drop',
    });
  };
  #features: ReadonlySet<PluginEditorFeature> = new Set();
  #generation = 0;
  #timer: number | null = null;
  #lightbox: HTMLElement | null = null;
  #lightboxCleanup: (() => void) | null = null;
  #lightboxReturnFocus: HTMLElement | null = null;
  #disposed = false;

  public constructor(editor: EditorEnhancementPort, options: EditorEnhancementOptions) {
    this.#editor = editor;
    this.#document = options.document;
    this.#window = options.window;
    this.#onOpenWikiLink = options.onOpenWikiLink;
    this.#onInsertMedia = options.onInsertMedia;
    this.#resolveMedia = options.resolveMedia;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
    const wrapper = this.#editor.getWrapperElement();
    wrapper.addEventListener('click', this.#onClick, true);
    wrapper.addEventListener('paste', this.#onPaste, true);
    wrapper.addEventListener('dragover', this.#onDragOver, true);
    wrapper.addEventListener('drop', this.#onDrop, true);
  }

  public setFeatures(features: ReadonlySet<PluginEditorFeature>): void {
    this.#features = new Set(features);
    this.schedule();
  }

  public schedule(): void {
    if (this.#disposed) { return; }
    if (null !== this.#timer) { this.#window.clearTimeout(this.#timer); }
    this.#timer = this.#window.setTimeout(() => {
      this.#timer = null;
      void this.#render();
    }, 80);
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#generation += 1;
    if (null !== this.#timer) { this.#window.clearTimeout(this.#timer); }
    this.#timer = null;
    this.#clearWidgets();
    this.#closeLightbox();
    const wrapper = this.#editor.getWrapperElement();
    wrapper.removeEventListener('click', this.#onClick, true);
    wrapper.removeEventListener('paste', this.#onPaste, true);
    wrapper.removeEventListener('dragover', this.#onDragOver, true);
    wrapper.removeEventListener('drop', this.#onDrop, true);
  }

  #firstSupportedMedia(files: FileList | undefined | null): File | null {
    if (!files) { return null; }
    for (const file of files) {
      if (
        MEDIA_MIME_TYPES.has(file.type.toLocaleLowerCase('en-US')) &&
        0 < file.size &&
        file.size <= EDITOR_ENHANCEMENT_LIMITS.maxMediaFileBytes
      ) { return file; }
    }
    return null;
  }

  async #submitMedia(input: EditorMediaInput): Promise<void> {
    if (!this.#onInsertMedia) {
      this.#onDiagnostic('Media insertion is unavailable');
      return;
    }
    try {
      await this.#onInsertMedia(input);
    } catch (error) {
      this.#onDiagnostic(`Media insertion failed: ${messageFrom(error)}`);
    }
  }

  async #render(): Promise<void> {
    const generation = ++this.#generation;
    this.#clearWidgets();
    const content = this.#editor.getValue();
    if (this.#features.has('code-languages')) {
      void this.#loadCodeModes(content, generation);
    }
    const blocks = parseEditorPreviewBlocks(content).filter((block) =>
      'math' === block.kind ? this.#features.has('math') : this.#features.has('mermaid'));
    for (const block of blocks) {
      if (generation !== this.#generation || this.#disposed) { return; }
      const host = this.#document.createElement('div');
      host.className = `v2-editor-render-widget v2-editor-render-${block.kind}`;
      host.setAttribute('role', 'img');
      host.setAttribute('aria-label', `${'math' === block.kind ? 'Math' : 'Mermaid'} preview`);
      host.textContent = `Loading ${block.kind} preview…`;
      this.#widgets.push(this.#editor.addLineWidget(block.line, host, {
        above: false,
        coverGutter: false,
        noHScroll: true,
      }));
      void ('math' === block.kind
        ? this.#renderMath(host, block.source, generation)
        : this.#renderMermaid(host, block.source, generation));
    }
    if (this.#features.has('media')) {
      for (const media of parseEditorMediaPreviews(content)) {
        if (generation !== this.#generation || this.#disposed) { return; }
        const host = this.#document.createElement('div');
        host.className = 'v2-editor-render-widget v2-editor-render-media';
        host.setAttribute('aria-label', `${media.kind} preview`);
        host.textContent = `Loading ${media.kind} preview…`;
        this.#widgets.push(this.#editor.addLineWidget(media.line, host, {
          above: false,
          coverGutter: false,
          noHScroll: true,
        }));
        void this.#renderMedia(host, media, generation);
      }
    }
  }

  async #loadCodeModes(content: string, generation: number): Promise<void> {
    const assets = new Set<string>();
    for (const language of fencedCodeLanguages(content)) {
      const asset = CODE_MODE_ASSETS[language];
      if (asset) { assets.add(asset); }
    }
    if (0 === assets.size) { return; }
    try {
      await Promise.all([...assets].map((asset) => loadScript(
        this.#document,
        this.#window,
        asset,
      )));
      if (generation === this.#generation && !this.#disposed) {
        this.#editor.setOption('mode', {
          name: 'markdown',
          emoji: this.#features.has('emoji'),
          fencedCodeBlockHighlighting: true,
          strikethrough: true,
          taskLists: true,
        });
        this.#editor.refresh();
      }
    } catch (error) {
      this.#onDiagnostic(`Code language support unavailable: ${messageFrom(error)}`);
    }
  }

  async #renderMath(host: HTMLElement, expression: string, generation: number): Promise<void> {
    try {
      await loadScript(this.#document, this.#window, 'lib/latex/katex.min.js', () =>
        'function' === typeof (this.#window as Window & { katex?: { render?: unknown } }).katex?.render);
      if (generation !== this.#generation || this.#disposed || !host.isConnected) { return; }
      const katex = (this.#window as Window & {
        katex?: { render: (source: string, target: HTMLElement, options: object) => void };
      }).katex;
      if (!katex) { throw new Error('KaTeX is unavailable'); }
      host.replaceChildren();
      katex.render(expression, host, {
        displayMode: true,
        maxExpand: 1000,
        maxSize: 20,
        strict: 'warn',
        throwOnError: false,
        trust: false,
      });
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) { return; }
      host.textContent = 'Math preview unavailable; source remains editable.';
      this.#onDiagnostic(`KaTeX render unavailable: ${messageFrom(error)}`);
    }
  }

  async #renderMermaid(host: HTMLElement, source: string, generation: number): Promise<void> {
    const task = async (): Promise<void> => {
      try {
        await loadScript(this.#document, this.#window, 'lib/mermaid.min.js', () =>
          'function' === typeof (this.#window as Window & {
            mermaid?: { render?: unknown };
          }).mermaid?.render);
        if (generation !== this.#generation || this.#disposed || !host.isConnected) { return; }
        const mermaid = (this.#window as Window & {
          mermaid?: {
            initialize?: (options: object) => void;
            render: (id: string, input: string) => unknown;
          };
        }).mermaid;
        if (!mermaid) { throw new Error('Mermaid is unavailable'); }
        if (!initializedMermaidWindows.has(this.#window)) {
          mermaid.initialize?.({
            flowchart: { htmlLabels: false },
            securityLevel: 'strict',
            startOnLoad: false,
            suppressErrorRendering: true,
          });
          initializedMermaidWindows.add(this.#window);
        }
        const output = await mermaid.render(`mdular-mermaid-${++mermaidCounter}`, source);
        if (generation !== this.#generation || this.#disposed || !host.isConnected) { return; }
        const markup = 'string' === typeof output
          ? output
          : (output as { readonly svg?: unknown } | null)?.svg;
        if ('string' !== typeof markup) { throw new Error('Mermaid returned no SVG'); }
        host.replaceChildren(sanitizeMermaidSvg(this.#document, markup));
      } catch (error) {
        if (generation !== this.#generation || this.#disposed) { return; }
        host.textContent = 'Mermaid preview unavailable; source remains editable.';
        this.#onDiagnostic(`Mermaid render unavailable: ${messageFrom(error)}`);
      }
    };
    mermaidQueue = mermaidQueue.then(task, task);
    await mermaidQueue;
  }

  async #renderMedia(
    host: HTMLElement,
    preview: EditorMediaPreview,
    generation: number,
  ): Promise<void> {
    if (!this.#resolveMedia) {
      host.textContent = 'Media preview unavailable.';
      return;
    }
    try {
      const lease = await this.#resolveMedia(preview.path);
      if (generation !== this.#generation || this.#disposed || !host.isConnected) {
        lease.release();
        return;
      }
      this.#mediaLeases.push(lease);
      host.replaceChildren();
      if ('image' === preview.kind) {
        const trigger = this.#document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'v2-editor-media-trigger';
        trigger.setAttribute('aria-label', `Open image preview${preview.alt ? `: ${preview.alt}` : ''}`);
        const image = this.#document.createElement('img');
        image.src = lease.url;
        image.alt = preview.alt;
        image.loading = 'lazy';
        image.decoding = 'async';
        trigger.append(image);
        trigger.addEventListener('click', () => {
          this.#openLightbox(lease.url, preview.alt, trigger);
        });
        host.append(trigger);
      } else if ('video' === preview.kind) {
        const video = this.#document.createElement('video');
        video.src = lease.url;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', preview.alt || 'Video preview');
        host.append(video);
      } else {
        const audio = this.#document.createElement('audio');
        audio.src = lease.url;
        audio.controls = true;
        audio.preload = 'metadata';
        audio.setAttribute('aria-label', preview.alt || 'Audio preview');
        host.append(audio);
      }
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) { return; }
      host.textContent = 'Media unavailable; Markdown source remains editable.';
      this.#onDiagnostic(`Media preview unavailable: ${messageFrom(error)}`);
    }
  }

  #openLightbox(url: string, alt: string, returnFocus: HTMLElement): void {
    this.#closeLightbox();
    const modal = this.#document.createElement('div');
    modal.className = 'v2-editor-media-lightbox';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', alt ? `Image preview: ${alt}` : 'Image preview');
    const close = this.#document.createElement('button');
    close.type = 'button';
    close.className = 'v2-editor-media-lightbox-close';
    close.textContent = 'Close';
    const image = this.#document.createElement('img');
    image.className = 'v2-editor-media-lightbox-image';
    image.src = url;
    image.alt = alt;
    modal.append(close, image);
    this.#document.body.append(modal);
    this.#lightbox = modal;
    this.#lightboxReturnFocus = returnFocus;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ('Escape' === event.key) {
        event.preventDefault();
        event.stopPropagation();
        this.#closeLightbox();
      } else if ('Tab' === event.key) {
        event.preventDefault();
        close.focus({ preventScroll: true });
      }
    };
    const cleanup = (): void => {
      this.#document.removeEventListener('keydown', onKeyDown, true);
      modal.remove();
      this.#lightbox = null;
      this.#lightboxCleanup = null;
      const focus = this.#lightboxReturnFocus;
      this.#lightboxReturnFocus = null;
      focus?.focus({ preventScroll: true });
    };
    this.#lightboxCleanup = cleanup;
    close.addEventListener('click', () => this.#closeLightbox());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) { this.#closeLightbox(); }
    });
    this.#document.addEventListener('keydown', onKeyDown, true);
    close.focus({ preventScroll: true });
  }

  #closeLightbox(): void {
    this.#lightboxCleanup?.();
  }

  #clearWidgets(): void {
    this.#closeLightbox();
    for (const lease of this.#mediaLeases.splice(0)) { lease.release(); }
    for (const widget of this.#widgets.splice(0)) { widget.clear(); }
  }
}
