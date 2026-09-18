export const METADATA_SCAN_LIMITS = Object.freeze({
  maxLines: 512,
  maxBytes: 64 * 1024,
});

export type MetadataInvalidReason =
  | 'missing-close'
  | 'duplicate-key'
  | 'line-limit'
  | 'byte-limit';

export type MetadataFieldKind = 'scalar' | 'nested' | 'complex' | 'empty';

export interface MetadataField {
  readonly key: string;
  readonly kind: MetadataFieldKind;
  readonly value?: string;
}

export type MetadataParseResult =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'invalid';
      readonly reason: MetadataInvalidReason;
      readonly duplicateKey?: string;
    }
  | {
      readonly kind: 'metadata';
      readonly fields: readonly MetadataField[];
      readonly status?: string;
      readonly updated?: string;
    };

function logicalLines(content: string): readonly string[] {
  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return withoutBom.split(/\r\n|\n|\r/u);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function scalarValue(value: string): { readonly kind: 'scalar'; readonly value: string } |
  { readonly kind: 'complex' } |
  { readonly kind: 'empty' } {
  const trimmed = value.trim();
  if ('' === trimmed) { return { kind: 'empty' }; }
  if (/^(?:[|>{\[]|-[ \t]|[&*!?][^\s]?)/u.test(trimmed)) {
    return { kind: 'complex' };
  }
  const quote = trimmed[0];
  if ('"' === quote || "'" === quote) {
    if (trimmed.length < 2 || trimmed.at(-1) !== quote) { return { kind: 'complex' }; }
    return { kind: 'scalar', value: trimmed.slice(1, -1) };
  }
  return { kind: 'scalar', value: trimmed };
}

export function parseDocumentMetadata(content: string): MetadataParseResult {
  const lines = logicalLines(content);
  if ('---' !== lines[0]) { return { kind: 'none' }; }
  let scannedBytes = byteLength(lines[0]) + 1;
  const fields: Array<{ key: string; kind: MetadataFieldKind; value?: string }> = [];
  const seen = new Set<string>();
  let lastField: { key: string; kind: MetadataFieldKind; value?: string } | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    if (index >= METADATA_SCAN_LIMITS.maxLines) {
      return { kind: 'invalid', reason: 'line-limit' };
    }
    const line = lines[index] ?? '';
    scannedBytes += byteLength(line) + 1;
    if (scannedBytes > METADATA_SCAN_LIMITS.maxBytes) {
      return { kind: 'invalid', reason: 'byte-limit' };
    }
    if ('---' === line) {
      const result: MetadataParseResult = {
        kind: 'metadata',
        fields,
        ...safeSummaryScalars(fields),
      };
      return result;
    }
    if ('' === line.trim() || line.trimStart().startsWith('#')) { continue; }
    if (/^[ \t]/u.test(line) || /^-[ \t]/u.test(line)) {
      if (lastField && 'empty' === lastField.kind) { lastField.kind = 'nested'; }
      continue;
    }
    const declaration = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/u.exec(line);
    if (!declaration) {
      lastField = null;
      continue;
    }
    const key = declaration[1] ?? '';
    if (seen.has(key)) {
      return { kind: 'invalid', reason: 'duplicate-key', duplicateKey: key };
    }
    seen.add(key);
    const scalar = scalarValue(declaration[2] ?? '');
    const field = 'scalar' === scalar.kind
      ? { key, kind: scalar.kind, value: scalar.value }
      : { key, kind: scalar.kind };
    fields.push(field);
    lastField = field;
  }
  return { kind: 'invalid', reason: 'missing-close' };
}

function safeSummaryScalars(
  fields: readonly MetadataField[],
): { readonly status?: string; readonly updated?: string } {
  const status = fields.find((field) => 'status' === field.key && 'scalar' === field.kind)?.value;
  const updated = fields.find((field) => 'updated' === field.key && 'scalar' === field.kind)?.value;
  return {
    ...(undefined === status ? {} : { status }),
    ...(undefined === updated ? {} : { updated }),
  };
}
