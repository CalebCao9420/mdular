export const FRONTMATTER_ROUNDTRIP_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * 1024 * 1024,
  maxFrontmatterBytes: 256 * 1024,
  maxFrontmatterLines: 2_048,
  maxFieldValueLength: 4_096,
  maxUpdates: 32,
});

export interface RoundTripFrontmatterField {
  readonly key: string;
  readonly value?: string;
  readonly editable: boolean;
}

export type RoundTripFrontmatterResult =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'invalid';
      readonly reason: 'document-limit' | 'frontmatter-limit' | 'missing-close' | 'duplicate-key';
      readonly duplicateKey?: string;
    }
  | {
      readonly kind: 'frontmatter';
      readonly fields: readonly RoundTripFrontmatterField[];
    };

export type RoundTripFrontmatterUpdateResult =
  | { readonly ok: true; readonly content: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

interface LogicalLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly eol: string;
}

interface ParsedField extends RoundTripFrontmatterField {
  readonly line: LogicalLine;
  readonly prefix: string;
  readonly suffix: string;
}

interface ParsedFrontmatter {
  readonly fields: readonly ParsedField[];
  readonly close: LogicalLine;
  readonly eol: string;
}

type FrontmatterParseFailure = Exclude<RoundTripFrontmatterResult, { readonly kind: 'frontmatter' }>;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function logicalLines(content: string): readonly LogicalLine[] {
  const lines: LogicalLine[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if ('\n' !== character && '\r' !== character) { continue; }
    const eol = '\r' === character && '\n' === content[index + 1] ? '\r\n' : character;
    lines.push({ text: content.slice(start, index), start, end: index, eol });
    if ('\r\n' === eol) { index += 1; }
    start = index + 1;
  }
  lines.push({ text: content.slice(start), start, end: content.length, eol: '' });
  return lines;
}

function inlineCommentIndex(value: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ('"' === quote) {
      if (escaped) {
        escaped = false;
      } else if ('\\' === character) {
        escaped = true;
      } else if ('"' === character) {
        quote = null;
      }
      continue;
    }
    if ("'" === quote) {
      if ("'" === character && "'" === value[index + 1]) {
        index += 1;
      } else if ("'" === character) {
        quote = null;
      }
      continue;
    }
    if ('"' === character || "'" === character) {
      quote = character;
      continue;
    }
    if ('#' === character && (0 === index || /[ \t]/u.test(value[index - 1] ?? ''))) {
      return index;
    }
  }
  return -1;
}

function decodeScalar(raw: string): { readonly editable: boolean; readonly value?: string } {
  const trimmed = raw.trim();
  if ('' === trimmed) { return { editable: true, value: '' }; }
  if (/^(?:[|>{\[]|-[ \t]|[&*!?][^\s]?)/u.test(trimmed)) {
    return { editable: false };
  }
  if ('"' === trimmed[0]) {
    try {
      const decoded = JSON.parse(trimmed) as unknown;
      return 'string' === typeof decoded
        ? { editable: true, value: decoded }
        : { editable: false };
    } catch {
      return { editable: false };
    }
  }
  if ("'" === trimmed[0]) {
    if (2 > trimmed.length || "'" !== trimmed.at(-1)) { return { editable: false }; }
    return { editable: true, value: trimmed.slice(1, -1).replaceAll("''", "'") };
  }
  return { editable: true, value: trimmed };
}

function parse(content: string): ParsedFrontmatter | FrontmatterParseFailure {
  if (FRONTMATTER_ROUNDTRIP_LIMITS.maxDocumentBytes < byteLength(content)) {
    return { kind: 'invalid', reason: 'document-limit' };
  }
  const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
  const source = content.slice(bomOffset);
  const lines = logicalLines(source);
  if ('---' !== lines[0]?.text) { return { kind: 'none' }; }
  let scannedBytes = byteLength(lines[0]?.text ?? '') + (lines[0]?.eol.length ?? 0);
  let close: LogicalLine | null = null;
  const fields: ParsedField[] = [];
  const seen = new Set<string>();
  let lastField: ParsedField | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_ROUNDTRIP_LIMITS.maxFrontmatterLines <= index) {
      return { kind: 'invalid', reason: 'frontmatter-limit' };
    }
    const sourceLine = lines[index]!;
    const line: LogicalLine = {
      ...sourceLine,
      start: sourceLine.start + bomOffset,
      end: sourceLine.end + bomOffset,
    };
    scannedBytes += byteLength(sourceLine.text) + sourceLine.eol.length;
    if (FRONTMATTER_ROUNDTRIP_LIMITS.maxFrontmatterBytes < scannedBytes) {
      return { kind: 'invalid', reason: 'frontmatter-limit' };
    }
    if ('---' === sourceLine.text) {
      close = line;
      break;
    }
    if ('' === sourceLine.text.trim() || sourceLine.text.trimStart().startsWith('#')) {
      continue;
    }
    if (/^[ \t]/u.test(sourceLine.text) || /^-[ \t]/u.test(sourceLine.text)) {
      if (lastField && '' === lastField.value) {
        Object.assign(lastField, { editable: false, value: undefined });
      }
      continue;
    }
    const declaration = /^([A-Za-z0-9_.-]+)(:[ \t]*)(.*)$/u.exec(sourceLine.text);
    if (!declaration) {
      lastField = null;
      continue;
    }
    const key = declaration[1] ?? '';
    if (seen.has(key)) {
      return { kind: 'invalid', reason: 'duplicate-key', duplicateKey: key };
    }
    seen.add(key);
    const raw = declaration[3] ?? '';
    const commentIndex = inlineCommentIndex(raw);
    const valuePart = -1 === commentIndex ? raw : raw.slice(0, commentIndex);
    const trailing = /[ \t]*$/u.exec(valuePart)?.[0] ?? '';
    const scalar = decodeScalar(valuePart.slice(0, valuePart.length - trailing.length));
    const field: ParsedField = {
      key,
      ...scalar,
      line,
      prefix: `${declaration[1] ?? ''}${declaration[2] ?? ':'}`,
      suffix: `${trailing}${-1 === commentIndex ? '' : raw.slice(commentIndex)}`,
    };
    fields.push(field);
    lastField = field;
  }
  if (!close) { return { kind: 'invalid', reason: 'missing-close' }; }
  return {
    fields,
    close,
    eol: lines[0]?.eol || close.eol || '\n',
  };
}

function isParsed(value: ParsedFrontmatter | FrontmatterParseFailure): value is ParsedFrontmatter {
  return !('kind' in value);
}

export function parseRoundTripFrontmatter(content: string): RoundTripFrontmatterResult {
  const parsed = parse(content);
  if (!isParsed(parsed)) { return parsed; }
  return {
    kind: 'frontmatter',
    fields: parsed.fields.map(({ key, value, editable }) => ({
      key,
      editable,
      ...(undefined === value ? {} : { value }),
    })),
  };
}

function encodedScalar(value: string): string {
  if ('' === value) { return ''; }
  if (
    value === value.trim() &&
    !/[\r\n#:[\]{},&*!|>'"%@`]/u.test(value) &&
    !/^(?:-|\?|:)[ \t]/u.test(value) &&
    !/^(?:~|null|true|false|yes|no|on|off|[-+]?(?:\d+(?:\.\d+)?|\.inf|\.nan)|\d{4}-\d{2}-\d{2})$/iu.test(value)
  ) { return value; }
  return JSON.stringify(value);
}

export function updateRoundTripFrontmatter(
  content: string,
  updates: Readonly<Record<string, string>>,
): RoundTripFrontmatterUpdateResult {
  const entries = Object.entries(updates);
  if (
    FRONTMATTER_ROUNDTRIP_LIMITS.maxUpdates < entries.length ||
    entries.some(([key, value]) => (
      !/^[A-Za-z0-9_.-]+$/u.test(key) ||
      'string' !== typeof value ||
      FRONTMATTER_ROUNDTRIP_LIMITS.maxFieldValueLength < value.length
    ))
  ) { return { ok: false, reason: 'Frontmatter updates are malformed or exceed the limit' }; }
  const parsed = parse(content);
  if (!isParsed(parsed)) {
    return {
      ok: false,
      reason: 'none' === parsed.kind
        ? 'Document has no frontmatter'
        : `Frontmatter is not safely editable: ${parsed.reason}`,
    };
  }
  const byKey = new Map(parsed.fields.map((field) => [field.key, field]));
  for (const [key] of entries) {
    const existing = byKey.get(key);
    if (existing && !existing.editable) {
      return { ok: false, reason: `Frontmatter field is complex and cannot be edited: ${key}` };
    }
  }
  const replacements = entries.flatMap(([key, value]) => {
    const existing = byKey.get(key);
    return existing
      ? [{
          start: existing.line.start,
          end: existing.line.end,
          text: `${existing.prefix}${encodedScalar(value)}${existing.suffix}`,
        }]
      : [];
  }).sort((left, right) => right.start - left.start);
  let result = content;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  const missing = entries.filter(([key]) => !byKey.has(key));
  if (0 < missing.length) {
    const shift = replacements
      .filter((replacement) => replacement.start < parsed.close.start)
      .reduce((total, replacement) => total + replacement.text.length - (replacement.end - replacement.start), 0);
    const insertionAt = parsed.close.start + shift;
    const insertion = missing
      .map(([key, value]) => `${key}: ${encodedScalar(value)}${parsed.eol}`)
      .join('');
    result = result.slice(0, insertionAt) + insertion + result.slice(insertionAt);
  }
  return { ok: true, content: result, changed: result !== content };
}
