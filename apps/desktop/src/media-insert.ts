export const MEDIA_INSERT_LIMITS = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxFilenameCharacters: 96,
  maxCollisionAttempts: 16,
});

const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/x-wav': 'wav',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
});

export interface MediaWriteReceipt {
  readonly path: string;
  readonly revision: string;
  readonly bytes: number;
}

export type MediaWriteResult =
  | { readonly status: 'written'; readonly receipt: MediaWriteReceipt }
  | { readonly status: 'failed'; readonly kind: string; readonly message: string };

export type MediaRollbackResult =
  | { readonly status: 'removed' | 'missing'; readonly path: string }
  | {
      readonly status: 'retained';
      readonly path: string;
      readonly kind: string;
      readonly message: string;
    };

export interface MediaMarkdownEdit {
  readonly content: string;
  readonly cursor: number;
  readonly markdown: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

export function mediaExtensionForMime(mimeType: string): string {
  const normalized = mimeType.trim().toLocaleLowerCase('en-US');
  const extension = MIME_EXTENSIONS[normalized];
  if (!extension) { throw new Error('Media type is unsupported'); }
  return extension;
}

function filenameStem(filename: string): string {
  const normalized = filename.normalize('NFC').split(/[\\/]/u).at(-1) ?? '';
  const withoutExtension = normalized.replace(/\.[^.]*$/u, '');
  let stem = withoutExtension
    .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]+/gu, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/[-_.]{2,}/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '')
    .slice(0, 48);
  if (!stem) { stem = 'asset'; }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem)) { stem = `asset-${stem}`; }
  return stem;
}

function timestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) { throw new Error('Media timestamp is invalid'); }
  return date.toISOString()
    .replace(/[-:]/gu, '')
    .replace('T', '-')
    .replace('Z', '')
    .replace('.', '-');
}

export function createMediaAssetPath(
  originalName: string,
  mimeType: string,
  date: Date,
  collisionAttempt = 0,
): string {
  if (
    !Number.isSafeInteger(collisionAttempt) ||
    0 > collisionAttempt ||
    MEDIA_INSERT_LIMITS.maxCollisionAttempts <= collisionAttempt
  ) { throw new Error('Media collision attempt is outside the allowed range'); }
  const extension = mediaExtensionForMime(mimeType);
  const suffix = 0 === collisionAttempt ? '' : `-${collisionAttempt + 1}`;
  const filename = `${timestamp(date)}-${filenameStem(originalName)}${suffix}.${extension}`;
  if (MEDIA_INSERT_LIMITS.maxFilenameCharacters < filename.length) {
    throw new Error('Generated media filename exceeds the limit');
  }
  return `media/${filename}`;
}

export function markdownMediaLink(path: string, originalName: string): string {
  if (!/^media\/[^/\\?#]+$/u.test(path) || path.includes('..')) {
    throw new Error('Media path is invalid');
  }
  const alt = filenameStem(originalName)
    .replace(/\\/gu, '\\\\')
    .replace(/\]/gu, '\\]');
  return `![${alt}](${path})`;
}

export function applyMediaMarkdownEdit(
  content: string,
  selectionAnchor: number,
  selectionHead: number,
  markdown: string,
): MediaMarkdownEdit {
  if (
    !Number.isSafeInteger(selectionAnchor) ||
    !Number.isSafeInteger(selectionHead) ||
    0 > selectionAnchor ||
    0 > selectionHead ||
    content.length < selectionAnchor ||
    content.length < selectionHead ||
    '' === markdown
  ) { throw new Error('Media insertion selection is invalid'); }
  const start = Math.min(selectionAnchor, selectionHead);
  const end = Math.max(selectionAnchor, selectionHead);
  return {
    content: `${content.slice(0, start)}${markdown}${content.slice(end)}`,
    cursor: start + markdown.length,
    markdown,
  };
}

export function encodeMediaBase64(bytes: Uint8Array): string {
  if (0 === bytes.byteLength || MEDIA_INSERT_LIMITS.maxFileBytes < bytes.byteLength) {
    throw new Error('Media file is empty or exceeds the file limit');
  }
  const encoder = globalThis.btoa;
  if ('function' !== typeof encoder) { throw new Error('Base64 encoding is unavailable'); }
  const chunks: string[] = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    let binary = '';
    for (const byte of bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize))) {
      binary += String.fromCharCode(byte);
    }
    chunks.push(binary);
  }
  return encoder(chunks.join(''));
}

export function decodeMediaWriteResult(value: unknown): MediaWriteResult {
  if (!isRecord(value) || ('written' !== value.status && 'failed' !== value.status)) {
    throw new Error('Media write response is malformed');
  }
  if ('failed' === value.status) {
    if ('string' !== typeof value.kind || 'string' !== typeof value.message) {
      throw new Error('Media write failure is malformed');
    }
    return { status: 'failed', kind: value.kind, message: value.message };
  }
  const receipt = value.receipt;
  if (
    !isRecord(receipt) ||
    'string' !== typeof receipt.path ||
    !/^media\/[^/\\?#]+$/u.test(receipt.path) ||
    'string' !== typeof receipt.revision ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.revision) ||
    !Number.isSafeInteger(receipt.bytes) ||
    0 >= Number(receipt.bytes) ||
    MEDIA_INSERT_LIMITS.maxFileBytes < Number(receipt.bytes)
  ) { throw new Error('Media write receipt is malformed'); }
  return {
    status: 'written',
    receipt: {
      path: receipt.path,
      revision: receipt.revision,
      bytes: Number(receipt.bytes),
    },
  };
}

export function decodeMediaRollbackResult(value: unknown): MediaRollbackResult {
  if (
    !isRecord(value) ||
    !['removed', 'missing', 'retained'].includes(String(value.status)) ||
    'string' !== typeof value.path
  ) { throw new Error('Media rollback response is malformed'); }
  if ('retained' === value.status) {
    if ('string' !== typeof value.kind || 'string' !== typeof value.message) {
      throw new Error('Media rollback retention is malformed');
    }
    return {
      status: 'retained',
      path: value.path,
      kind: value.kind,
      message: value.message,
    };
  }
  return { status: value.status as 'removed' | 'missing', path: value.path };
}
