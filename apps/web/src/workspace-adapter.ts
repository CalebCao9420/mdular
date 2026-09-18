import {
  byteHashFromHost,
  opaqueRevisionFromHost,
} from '@mdular/platform';
import type {
  DocumentSnapshot,
  DocumentTextFormat,
  WorkspaceAdapter,
  WorkspaceAdapterCapabilities,
  WorkspaceChangeHint,
  WorkspacePath,
  WorkspacePathKey,
  WorkspaceReadResult,
  WorkspaceStatResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '@mdular/platform';

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const READ_ONLY_ENCODING_MESSAGE =
  'The file is not valid UTF-8. It is read-only until the user explicitly converts it.';

export const browserPreviewCapabilities: WorkspaceAdapterCapabilities = {
  persistence: 'session-memory',
  atomicReplace: 'memory-assignment',
  externalWatch: 'adapter-local-only',
};

export interface BrowserPreviewFile {
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  readonly bytes: Uint8Array;
}

export interface BrowserPreviewWorkspaceAdapterOptions {
  readonly now?: () => number;
  readonly hashBytes?: (bytes: Uint8Array) => Promise<string>;
}

interface StoredPreviewFile {
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  bytes: Uint8Array;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    3 <= bytes.length &&
    UTF8_BOM[0] === bytes[0] &&
    UTF8_BOM[1] === bytes[1] &&
    UTF8_BOM[2] === bytes[2]
  );
}

function textFormat(text: string, bom: DocumentTextFormat['bom']): DocumentTextFormat {
  let crlfCount = 0;
  let lfCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ('\n' !== text[index]) { continue; }
    if (0 < index && '\r' === text[index - 1]) {
      crlfCount += 1;
    } else {
      lfCount += 1;
    }
  }
  return {
    bom,
    mainEol: 0 < crlfCount && crlfCount > lfCount ? 'crlf' : 'lf',
    trailingNewline: text.endsWith('\n') || text.endsWith('\r'),
  };
}

function normalizeLogicalLines(text: string): string {
  return text.replace(/\r\n|\r/gu, '\n');
}

export function encodeUtf8Document(
  content: string,
  format: DocumentTextFormat,
): Uint8Array {
  const logicalText = normalizeLogicalLines(content);
  const encodedText = 'crlf' === format.mainEol
    ? logicalText.replace(/\n/gu, '\r\n')
    : logicalText;
  const body = new TextEncoder().encode(encodedText);
  if ('none' === format.bom) { return body; }
  const result = new Uint8Array(UTF8_BOM.length + body.length);
  result.set(UTF8_BOM, 0);
  result.set(body, UTF8_BOM.length);
  return result;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable in this browser preview');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export class BrowserPreviewWorkspaceAdapter implements WorkspaceAdapter {
  public readonly capabilities = browserPreviewCapabilities;

  readonly #byPath = new Map<WorkspacePath, StoredPreviewFile>();
  readonly #pathsByKey = new Map<WorkspacePathKey, WorkspacePath>();
  readonly #listeners = new Set<(hint: WorkspaceChangeHint) => void>();
  readonly #now: () => number;
  readonly #hashBytes: (bytes: Uint8Array) => Promise<string>;

  public constructor(
    files: readonly BrowserPreviewFile[] = [],
    options: BrowserPreviewWorkspaceAdapterOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#hashBytes = options.hashBytes ?? sha256Hex;
    for (const file of files) {
      if (this.#byPath.has(file.path)) {
        throw new Error(`Duplicate browser preview path: ${file.path}`);
      }
      if (this.#pathsByKey.has(file.pathKey)) {
        throw new Error('Browser preview received duplicate host-confirmed path keys');
      }
      this.#byPath.set(file.path, {
        path: file.path,
        pathKey: file.pathKey,
        bytes: file.bytes.slice(),
      });
      this.#pathsByKey.set(file.pathKey, file.path);
    }
  }

  public async read(path: WorkspacePath): Promise<WorkspaceReadResult> {
    const file = this.#byPath.get(path);
    if (!file) {
      return { ok: false, error: { kind: 'not-found', message: `File not found: ${path}` } };
    }
    return { ok: true, snapshot: await this.#snapshot(file) };
  }

  public async write(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult> {
    const file = this.#byPath.get(request.path);
    if (!file) {
      return { ok: false, kind: 'not-found', message: `File not found: ${request.path}` };
    }
    if (file.pathKey !== request.pathKey) {
      return {
        ok: false,
        kind: 'outside-workspace',
        message: 'The browser preview path key does not match the selected file',
      };
    }

    const current = await this.#snapshot(file);
    if (current.revision !== request.expectedRevision) {
      return { ok: false, kind: 'conflict', current };
    }
    if ('read-only' === current.access.kind) {
      return { ok: false, kind: 'read-only', message: current.access.message };
    }

    file.bytes = encodeUtf8Document(request.content, request.format);
    const snapshot = await this.#snapshot(file);
    this.#emit({ path: file.path, pathKey: file.pathKey, kind: 'changed' });
    return { ok: true, snapshot };
  }

  public async stat(path: WorkspacePath): Promise<WorkspaceStatResult> {
    const file = this.#byPath.get(path);
    if (!file) {
      return {
        ok: true,
        stat: { path, kind: 'missing' },
      };
    }
    const revision = opaqueRevisionFromHost(`sha256:${await this.#hashBytes(file.bytes)}`);
    return {
      ok: true,
      stat: { path: file.path, pathKey: file.pathKey, kind: 'file', revision },
    };
  }

  public watch(listener: (hint: WorkspaceChangeHint) => void): { dispose(): void } {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  /** Models a new browser-selected version; it is not a native filesystem watcher. */
  public replaceFromBrowser(path: WorkspacePath, bytes: Uint8Array): boolean {
    const file = this.#byPath.get(path);
    if (!file) { return false; }
    file.bytes = bytes.slice();
    this.#emit({ path: file.path, pathKey: file.pathKey, kind: 'changed' });
    return true;
  }

  /** Returns a defensive copy suitable for an explicit browser download/save action. */
  public exportBytes(path: WorkspacePath): Uint8Array | undefined {
    return this.#byPath.get(path)?.bytes.slice();
  }

  async #snapshot(file: StoredPreviewFile): Promise<DocumentSnapshot> {
    const raw = file.bytes.slice();
    const bom = hasUtf8Bom(raw) ? 'utf8' : 'none';
    const payload = 'utf8' === bom ? raw.slice(UTF8_BOM.length) : raw;
    let decoded: string;
    let access: DocumentSnapshot['access'];
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      access = { kind: 'read-write' };
    } catch {
      decoded = new TextDecoder('utf-8').decode(payload);
      access = {
        kind: 'read-only',
        reason: 'unsupported-encoding',
        message: READ_ONLY_ENCODING_MESSAGE,
      };
    }
    const hash = `sha256:${await this.#hashBytes(raw)}`;
    return {
      path: file.path,
      pathKey: file.pathKey,
      content: normalizeLogicalLines(decoded),
      revision: opaqueRevisionFromHost(hash),
      byteHash: byteHashFromHost(hash),
      format: textFormat(decoded, bom),
      access,
      capturedAt: this.#now(),
    };
  }

  #emit(hint: WorkspaceChangeHint): void {
    for (const listener of this.#listeners) { listener(hint); }
  }
}
