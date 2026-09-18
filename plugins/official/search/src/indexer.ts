import type { JsonValue, PluginTextHighlight } from '@mdular/plugin-sdk';

import { metadataMatches, parseSearchQuery } from './query.js';

export const SEARCH_INDEX_LIMITS = Object.freeze({
  maxDocuments: 10_000,
  maxDocumentBytes: 2 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxResults: 100,
  maxCacheBytes: 48 * 1024,
});

interface IndexedDocument {
  readonly path: string;
  readonly title: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly bytes: number;
}

export interface SearchResult {
  readonly path: string;
  readonly score: number;
  readonly title: string;
  readonly description: string;
  readonly titleHighlights?: readonly PluginTextHighlight[];
  readonly descriptionHighlights?: readonly PluginTextHighlight[];
  readonly badges?: readonly string[];
}

export interface SearchIndexUpdate {
  readonly indexed: boolean;
  readonly reason?: 'invalid-path' | 'document-limit' | 'document-size' | 'total-size';
}

const textEncoder = new TextEncoder();

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function displayTitle(path: string): string {
  const name = basename(path);
  return name.toLocaleLowerCase('en-US').endsWith('.md') ? name.slice(0, -3) : name;
}

function isCanonicalMarkdownPath(path: string): boolean {
  if (
    '' === path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    !path.toLocaleLowerCase('en-US').endsWith('.md')
  ) { return false; }
  const segments = path.split('/');
  return !segments.some((segment) => '' === segment || '.' === segment || '..' === segment);
}

function unquote(value: string): string {
  if (
    2 <= value.length &&
    (('"' === value[0] && '"' === value.at(-1)) ||
      ("'" === value[0] && "'" === value.at(-1)))
  ) { return value.slice(1, -1); }
  return value;
}

/** Bounded, deliberately shallow frontmatter extraction for search filters. */
export function parseSearchMetadata(content: string): Readonly<Record<string, string>> {
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const lines = normalized.replaceAll('\r\n', '\n').split('\n');
  if ('---' !== lines[0]) { return {}; }
  const metadata: Record<string, string> = {};
  let activeListKey: string | null = null;
  let scannedCharacters = 4;
  for (let index = 1; index < Math.min(lines.length, 512); index += 1) {
    const line = lines[index] ?? '';
    scannedCharacters += line.length + 1;
    if (64 * 1024 < scannedCharacters) { return {}; }
    if ('---' === line) { return metadata; }
    const listItem = line.match(/^\s+-\s*(.+)$/u);
    if (activeListKey && listItem?.[1]) {
      const item = unquote(listItem[1].trim());
      metadata[activeListKey] = `${metadata[activeListKey] ?? ''} ${item}`.trim();
      continue;
    }
    activeListKey = null;
    const field = line.match(/^([a-z_.-]+):\s*(.*)$/iu);
    if (!field?.[1] || undefined === field[2]) { continue; }
    const key = 'tag' === field[1].toLocaleLowerCase('en-US')
      ? 'tags'
      : field[1].toLocaleLowerCase('en-US');
    const value = unquote(field[2].trim());
    metadata[key] = value;
    if ('' === value) { activeListKey = key; }
  }
  return {};
}

function levenshtein(left: string, right: string): number {
  if (left === right) { return 0; }
  if (0 === left.length || 0 === right.length) { return left.length + right.length; }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex + 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous.at(-1) ?? Math.max(left.length, right.length);
}

function similarity(left: string, right: string): number {
  const maximum = Math.max(left.length, right.length);
  return 0 === maximum ? 100 : (1 - levenshtein(left, right) / maximum) * 100;
}

function matchingRanges(text: string, terms: readonly string[]): readonly PluginTextHighlight[] {
  const lower = text.toLocaleLowerCase('en-US');
  const ranges: PluginTextHighlight[] = [];
  for (const term of terms) {
    if ('' === term) { continue; }
    let start = lower.indexOf(term);
    while (-1 !== start && ranges.length < 32) {
      ranges.push({ start, end: start + term.length });
      start = lower.indexOf(term, start + term.length);
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: PluginTextHighlight[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function bodySnippet(content: string, terms: readonly string[]): {
  readonly text: string;
  readonly highlights: readonly PluginTextHighlight[];
} | null {
  const lower = content.toLocaleLowerCase('en-US');
  let match = -1;
  for (const term of terms) {
    const candidate = lower.indexOf(term);
    if (-1 !== candidate && (-1 === match || candidate < match)) { match = candidate; }
  }
  if (-1 === match) { return null; }
  const lineStart = Math.max(content.lastIndexOf('\n', match - 1) + 1, match - 70);
  const newline = content.indexOf('\n', match);
  const lineEnd = Math.min(-1 === newline ? content.length : newline, lineStart + 240);
  const prefix = 0 < lineStart ? '…' : '';
  const suffix = lineEnd < content.length ? '…' : '';
  const text = `${prefix}${content.slice(lineStart, lineEnd).trim()}${suffix}`;
  return { text, highlights: matchingRanges(text, terms) };
}

function pathInFolder(path: string, folder: string | null): boolean {
  return !folder || path.startsWith(`${folder}/`);
}

function directChild(path: string, folder: string): boolean {
  if (!path.startsWith(`${folder}/`)) { return false; }
  return !path.slice(folder.length + 1).includes('/');
}

function scoreDocument(entry: IndexedDocument, text: string): number | null {
  if ('' === text) { return 50; }
  const title = entry.title.toLocaleLowerCase('en-US');
  const path = entry.path.toLocaleLowerCase('en-US');
  const body = entry.content.toLocaleLowerCase('en-US');
  const terms = text.split(/\s+/u).filter(Boolean).slice(0, 16);
  let score = 0;
  for (const term of terms) {
    if (title === term) { score += 160; continue; }
    if (title.startsWith(term)) { score += 135; continue; }
    if (title.includes(term)) { score += 115; continue; }
    const fuzzy = 128 >= term.length && 256 >= title.length ? similarity(term, title) : 0;
    if (70 <= fuzzy) { score += fuzzy; continue; }
    if (path.includes(term)) { score += 90; continue; }
    if (body.includes(term)) { score += 60; continue; }
    return null;
  }
  const root = entry.path.split('/')[0]?.toLocaleLowerCase('en-US');
  if (['archive', 'habits', 'triggers'].includes(root ?? '')) { score -= 60; }
  return Math.round(score / Math.max(1, terms.length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

export class SearchIndex {
  readonly #documents = new Map<string, IndexedDocument>();
  #totalBytes = 0;

  public get size(): number { return this.#documents.size; }
  public get totalBytes(): number { return this.#totalBytes; }

  public clear(): void {
    this.#documents.clear();
    this.#totalBytes = 0;
  }

  public remove(path: string): void {
    const previous = this.#documents.get(path);
    if (!previous) { return; }
    this.#documents.delete(path);
    this.#totalBytes -= previous.bytes;
  }

  public upsert(path: string, content: string): SearchIndexUpdate {
    this.remove(path);
    if (!isCanonicalMarkdownPath(path)) { return { indexed: false, reason: 'invalid-path' }; }
    const bytes = byteLength(path) + byteLength(content);
    if (SEARCH_INDEX_LIMITS.maxDocumentBytes < bytes) {
      return { indexed: false, reason: 'document-size' };
    }
    if (SEARCH_INDEX_LIMITS.maxDocuments <= this.#documents.size) {
      return { indexed: false, reason: 'document-limit' };
    }
    if (SEARCH_INDEX_LIMITS.maxTotalBytes < this.#totalBytes + bytes) {
      return { indexed: false, reason: 'total-size' };
    }
    this.#documents.set(path, {
      path,
      title: displayTitle(path),
      content,
      metadata: parseSearchMetadata(content),
      bytes,
    });
    this.#totalBytes += bytes;
    return { indexed: true };
  }

  public directories(): ReadonlySet<string> {
    const directories = new Set<string>();
    for (const path of this.#documents.keys()) {
      const parts = path.split('/');
      parts.pop();
      for (let index = 1; index <= parts.length; index += 1) {
        directories.add(parts.slice(0, index).join('/'));
      }
    }
    return directories;
  }

  public search(raw: string): readonly SearchResult[] {
    const query = parseSearchQuery(raw.slice(0, 512), this.directories());
    const terms = query.text.split(/\s+/u).filter(Boolean).slice(0, 16);
    const results: SearchResult[] = [];
    for (const entry of this.#documents.values()) {
      if (query.browseFolder && !directChild(entry.path, query.browseFolder)) { continue; }
      if (!pathInFolder(entry.path, query.folderPath)) { continue; }
      if (!metadataMatches(entry.metadata, query.filters)) { continue; }
      const score = query.browseFolder ? 100 : scoreDocument(entry, query.text);
      if (null === score) { continue; }
      const snippet = bodySnippet(entry.content, terms);
      const description = snippet?.text ?? entry.path;
      const badges = Object.entries(query.filters)
        .slice(0, 3)
        .map(([key]) => `${key}: ${entry.metadata[key] ?? ''}`);
      results.push({
        path: entry.path,
        score: score + (0 < Object.keys(query.filters).length ? 10 : 0),
        title: entry.title,
        description,
        ...(0 < terms.length && 0 < matchingRanges(entry.title, terms).length
          ? { titleHighlights: matchingRanges(entry.title, terms) }
          : {}),
        ...(snippet && 0 < snippet.highlights.length
          ? { descriptionHighlights: snippet.highlights }
          : 0 < terms.length && 0 < matchingRanges(description, terms).length
            ? { descriptionHighlights: matchingRanges(description, terms) }
            : {}),
        ...(0 < badges.length ? { badges } : {}),
      });
    }
    return results
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, SEARCH_INDEX_LIMITS.maxResults);
  }

  public exportCache(): JsonValue {
    const documents: JsonValue[] = [];
    let bytes = byteLength('{"documents":[]}');
    for (const entry of [...this.#documents.values()]
      .sort((left, right) => left.path.localeCompare(right.path))) {
      const value = { path: entry.path, content: entry.content };
      const encodedBytes = byteLength(JSON.stringify(value)) + 1;
      if (SEARCH_INDEX_LIMITS.maxCacheBytes < bytes + encodedBytes) { break; }
      documents.push(value);
      bytes += encodedBytes;
    }
    return { documents, complete: documents.length === this.#documents.size };
  }

  public importCache(value: JsonValue): boolean {
    if (!isRecord(value) || !Array.isArray(value.documents)) { return false; }
    const restored = new SearchIndex();
    for (const entry of value.documents) {
      if (
        !isRecord(entry) ||
        'string' !== typeof entry.path ||
        'string' !== typeof entry.content ||
        !restored.upsert(entry.path, entry.content).indexed
      ) { return false; }
    }
    this.clear();
    for (const entry of restored.#documents.values()) {
      this.#documents.set(entry.path, entry);
    }
    this.#totalBytes = restored.#totalBytes;
    return true;
  }
}
