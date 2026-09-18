import type {
  PluginReaderBlock,
  PluginReaderOutlineItem,
  PluginWorkspaceImage,
} from '@mdular/plugin-sdk';

import { parseRoundTripFrontmatter } from './frontmatter-roundtrip.js';

export const DOCS_READER_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxDocuments: 16,
  maxDepth: 3,
  maxBlocks: 500,
  maxOutline: 256,
  maxParagraphLength: 64 * 1024,
});

export interface DocsDocumentSummary {
  readonly path: string;
  readonly title: string;
  readonly cover?: PluginWorkspaceImage;
}

export interface DocsReaderDocument extends DocsDocumentSummary {
  readonly blocks: readonly PluginReaderBlock[];
  readonly outline: readonly PluginReaderOutlineItem[];
  readonly status: string;
}

interface ReaderBudget {
  documents: number;
  bytes: number;
  blockId: number;
  truncated: boolean;
  readonly visited: Set<string>;
  readonly blocks: PluginReaderBlock[];
  readonly outline: PluginReaderOutlineItem[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeWorkspacePath(value: string, basePath = ''): string | null {
  if ('string' !== typeof value || '' === value || value.includes('\\')) { return null; }
  let raw = value.trim();
  if (raw.startsWith('<') && raw.endsWith('>')) { raw = raw.slice(1, -1).trim(); }
  if ('' === raw || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw) || raw.startsWith('//')) {
    return null;
  }
  const rootRelative = raw.startsWith('/');
  const segments = (rootRelative ? raw.slice(1) : `${basePath}${raw}`).split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if ('' === segment || '.' === segment) { continue; }
    if ('..' === segment) {
      if (0 === normalized.length) { return null; }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return 0 === normalized.length ? null : normalized.join('/');
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return -1 === index ? '' : path.slice(0, index + 1);
}

function filenameTitle(path: string): string {
  const basename = path.split('/').at(-1) ?? path;
  return basename.replace(/\.md$/iu, '') || 'Untitled';
}

function frontmatterBody(content: string): string {
  const bomLength = content.startsWith('\uFEFF') ? 1 : 0;
  const source = content.slice(bomLength);
  const opener = /^(---)(\r\n|\n|\r)/u.exec(source);
  if (!opener) { return source; }
  let offset = opener[0].length;
  while (offset <= source.length) {
    const end = source.slice(offset).search(/\r\n|\n|\r/u);
    const lineEnd = -1 === end ? source.length : offset + end;
    if ('---' === source.slice(offset, lineEnd)) {
      if (-1 === end) { return ''; }
      const eol = /^(?:\r\n|\n|\r)/u.exec(source.slice(lineEnd))?.[0] ?? '';
      return source.slice(lineEnd + eol.length);
    }
    if (-1 === end) { break; }
    const eol = /^(?:\r\n|\n|\r)/u.exec(source.slice(lineEnd))?.[0] ?? '';
    offset = lineEnd + eol.length;
  }
  return source;
}

function scalarFields(content: string): ReadonlyMap<string, string> {
  const parsed = parseRoundTripFrontmatter(content);
  if ('frontmatter' !== parsed.kind) { return new Map(); }
  return new Map(parsed.fields.flatMap((field) => (
    field.editable && undefined !== field.value ? [[field.key, field.value] as const] : []
  )));
}

function coverFocus(value: string | undefined): { readonly x: number; readonly y: number } {
  if (!value || 'center' === value.trim().toLocaleLowerCase('en-US')) { return { x: 50, y: 50 }; }
  const matches = value.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  return {
    x: Math.max(0, Math.min(100, matches[0] ?? 50)),
    y: Math.max(0, Math.min(100, matches[1] ?? 50)),
  };
}

function coverFromFields(
  path: string,
  fields: ReadonlyMap<string, string>,
  presentation: NonNullable<PluginWorkspaceImage['presentation']>,
): PluginWorkspaceImage | undefined {
  const raw = fields.get('cover')?.trim();
  if (!raw) { return undefined; }
  const resolved = normalizeWorkspacePath(raw, directoryOf(path));
  if (!resolved) { return undefined; }
  const focus = coverFocus(fields.get('cover_focus'));
  return {
    path: resolved,
    alt: fields.get('cover_alt') ?? fields.get('title') ?? filenameTitle(path),
    presentation,
    focusX: focus.x,
    focusY: focus.y,
  };
}

function firstHeading(content: string): string | undefined {
  let inFence = false;
  let fence = '';
  for (const line of frontmatterBody(content).split(/\r\n|\n|\r/u)) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!inFence) {
        inFence = true;
        fence = marker[0] ?? '';
      } else if (marker[0] === fence) {
        inFence = false;
      }
      continue;
    }
    if (inFence) { continue; }
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (heading?.[2]?.trim()) { return heading[2].trim(); }
  }
  return undefined;
}

export function summarizeDocsDocument(path: string, content: string): DocsDocumentSummary {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized || !normalized.toLocaleLowerCase('en-US').endsWith('.md')) {
    throw new Error('Docs document path is invalid');
  }
  if (DOCS_READER_LIMITS.maxDocumentBytes < byteLength(content)) {
    throw new Error('Document exceeds the Docs reader limit');
  }
  const fields = scalarFields(content);
  const cover = coverFromFields(normalized, fields, 'thumbnail');
  return {
    path: normalized,
    title: fields.get('title')?.trim() || firstHeading(content) || filenameTitle(normalized),
    ...(cover ? { cover } : {}),
  };
}

function nextId(budget: ReaderBudget, prefix: string): string {
  budget.blockId += 1;
  return `${prefix}-${String(budget.blockId)}`;
}

function pushBlock(budget: ReaderBudget, block: PluginReaderBlock): boolean {
  if (DOCS_READER_LIMITS.maxBlocks <= budget.blocks.length) {
    budget.truncated = true;
    return false;
  }
  budget.blocks.push(block);
  if ('heading' === block.kind) {
    if (budget.outline.length < DOCS_READER_LIMITS.maxOutline) {
      budget.outline.push({ id: block.id, label: block.text, level: block.level });
    } else {
      budget.truncated = true;
    }
  }
  return true;
}

function markdownImage(
  line: string,
  documentPath: string,
): { readonly image: PluginWorkspaceImage; readonly caption?: string } | null {
  const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:[ \t]+["']([^"']*)["'])?\)[ \t]*$/u.exec(
    line.trim(),
  );
  if (!match) { return null; }
  const target = match[2] ?? match[3] ?? '';
  const path = normalizeWorkspacePath(target, directoryOf(documentPath));
  if (!path) { return null; }
  const alt = match[1] ?? '';
  const caption = match[4] || alt || undefined;
  return {
    image: { path, alt, presentation: 'content', focusX: 50, focusY: 50 },
    ...(caption ? { caption } : {}),
  };
}

function nestedPath(line: string, documentPath: string): string | null {
  const match = /^!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\][ \t]*$/u.exec(line.trim());
  if (!match) { return null; }
  const raw = match[1]?.trim() ?? '';
  const withExtension = raw.toLocaleLowerCase('en-US').endsWith('.md') ? raw : `${raw}.md`;
  const resolved = normalizeWorkspacePath(withExtension, directoryOf(documentPath));
  return resolved?.toLocaleLowerCase('en-US').endsWith('.md') ? resolved : null;
}

async function appendDocument(
  path: string,
  content: string,
  depth: number,
  readMarkdown: (path: string) => Promise<string>,
  budget: ReaderBudget,
): Promise<void> {
  const lines = frontmatterBody(content).split(/\r\n|\n|\r/u);
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let code: string[] | null = null;
  let codeFence = '';
  let codeLanguage = '';

  const flushParagraph = (): void => {
    if (0 === paragraph.length) { return; }
    pushBlock(budget, {
      id: nextId(budget, 'paragraph'),
      kind: 'paragraph',
      text: paragraph.join('\n').slice(0, DOCS_READER_LIMITS.maxParagraphLength),
    });
    paragraph = [];
  };
  const flushQuote = (): void => {
    if (0 === quote.length) { return; }
    pushBlock(budget, {
      id: nextId(budget, 'quote'),
      kind: 'quote',
      text: quote.join('\n').slice(0, DOCS_READER_LIMITS.maxParagraphLength),
    });
    quote = [];
  };
  const flushList = (): void => {
    if (0 === list.length) { return; }
    pushBlock(budget, {
      id: nextId(budget, 'list'),
      kind: 'list',
      items: list.slice(0, 128),
      ...(ordered ? { ordered: true } : {}),
    });
    list = [];
  };
  const flushText = (): void => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (budget.truncated && DOCS_READER_LIMITS.maxBlocks <= budget.blocks.length) { break; }
    if (code) {
      if (new RegExp(`^\\s*${codeFence}[ \\t]*$`, 'u').test(line)) {
        pushBlock(budget, {
          id: nextId(budget, 'code'),
          kind: 'code',
          text: code.join('\n').slice(0, DOCS_READER_LIMITS.maxParagraphLength),
          ...(codeLanguage ? { language: codeLanguage } : {}),
        });
        code = null;
        codeFence = '';
        codeLanguage = '';
      } else {
        code.push(line);
      }
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})[ \t]*([^\s]*)/u.exec(line);
    if (fence) {
      flushText();
      code = [];
      codeFence = fence[1] ?? '```';
      codeLanguage = (fence[2] ?? '').slice(0, 64);
      continue;
    }
    if ('' === line.trim()) {
      flushText();
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (heading) {
      flushText();
      const text = (heading[2] ?? '').replace(/\s*\[#+\]\([^)]*\)\s*$/u, '').trim();
      if (text) {
        pushBlock(budget, {
          id: nextId(budget, 'heading'),
          kind: 'heading',
          level: heading[1]?.length ?? 1,
          text,
        });
      }
      continue;
    }
    const includePath = nestedPath(line, path);
    if (includePath) {
      flushText();
      pushBlock(budget, {
        id: nextId(budget, 'nested'),
        kind: 'nested',
        text: `Included document: ${includePath}`,
      });
      if (
        depth >= DOCS_READER_LIMITS.maxDepth ||
        budget.documents >= DOCS_READER_LIMITS.maxDocuments ||
        budget.visited.has(includePath)
      ) {
        budget.truncated = true;
        continue;
      }
      try {
        const nested = await readMarkdown(includePath);
        const bytes = byteLength(nested);
        if (
          DOCS_READER_LIMITS.maxDocumentBytes < bytes ||
          DOCS_READER_LIMITS.maxTotalBytes < budget.bytes + bytes
        ) {
          budget.truncated = true;
          continue;
        }
        budget.documents += 1;
        budget.bytes += bytes;
        budget.visited.add(includePath);
        await appendDocument(includePath, nested, depth + 1, readMarkdown, budget);
        budget.visited.delete(includePath);
      } catch {
        pushBlock(budget, {
          id: nextId(budget, 'nested-error'),
          kind: 'nested',
          text: `Nested document unavailable: ${includePath}`,
        });
      }
      continue;
    }
    const image = markdownImage(line, path);
    if (image) {
      flushText();
      pushBlock(budget, {
        id: nextId(budget, 'image'),
        kind: 'image',
        ...image,
      });
      continue;
    }
    const quoteMatch = /^[ \t]*>[ \t]?(.*)$/u.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1] ?? '');
      continue;
    }
    const listMatch = /^[ \t]*(?:(-)|\d+\.)[ \t]+(.+)$/u.exec(line);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      const nextOrdered = undefined === listMatch[1];
      if (0 < list.length && ordered !== nextOrdered) { flushList(); }
      ordered = nextOrdered;
      list.push((listMatch[2] ?? '').slice(0, 4_096));
      if (128 <= list.length) { flushList(); }
      continue;
    }
    flushQuote();
    flushList();
    paragraph.push(line);
  }
  if (code) {
    pushBlock(budget, {
      id: nextId(budget, 'code'),
      kind: 'code',
      text: code.join('\n').slice(0, DOCS_READER_LIMITS.maxParagraphLength),
      ...(codeLanguage ? { language: codeLanguage } : {}),
    });
  }
  flushText();
}

export async function buildDocsReaderDocument(
  path: string,
  content: string,
  readMarkdown: (path: string) => Promise<string>,
): Promise<DocsReaderDocument> {
  const summary = summarizeDocsDocument(path, content);
  const rootBytes = byteLength(content);
  if (DOCS_READER_LIMITS.maxDocumentBytes < rootBytes) {
    throw new Error('Document exceeds the Docs reader limit');
  }
  const budget: ReaderBudget = {
    documents: 1,
    bytes: rootBytes,
    blockId: 0,
    truncated: false,
    visited: new Set([summary.path]),
    blocks: [],
    outline: [],
  };
  await appendDocument(summary.path, content, 0, readMarkdown, budget);
  return {
    ...summary,
    ...(summary.cover ? {
      cover: { ...summary.cover, presentation: 'cover' as const },
    } : {}),
    blocks: budget.blocks,
    outline: budget.outline,
    status: budget.truncated
      ? `${String(budget.documents)} document(s) · bounded preview truncated`
      : `${String(budget.documents)} document(s) · ${String(budget.blocks.length)} block(s)`,
  };
}
