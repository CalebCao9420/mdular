import type { Disposable } from '@mdular/plugin-sdk';

import type { DesktopBridge } from './workspace-adapter.js';

export const PLUGIN_IMAGE_CACHE_LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxMediaFileBytes: 16 * 1024 * 1024,
  maxCacheBytes: 32 * 1024 * 1024,
  maxEntries: 64,
  maxConcurrentLoads: 3,
  maxPathLength: 1024,
});

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ...IMAGE_MIME_TYPES,
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'video/webm',
});

export interface WorkspaceImageLease extends Disposable {
  readonly url: string;
}

export interface WorkspaceImageResolver {
  acquire(path: string): Promise<WorkspaceImageLease>;
}

export interface WorkspaceMediaLease {
  readonly url: string;
  release(): void;
}

interface CacheEntry {
  readonly key: string;
  readonly path: string;
  readonly modifiedMs: number;
  readonly promise: Promise<CacheEntry>;
  url: string | undefined;
  bytes: number;
  refs: number;
  lastUsed: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function assetPath(
  value: string,
  media: boolean,
): { readonly path: string; readonly mime: string } {
  if (
    'string' !== typeof value ||
    '' === value ||
    PLUGIN_IMAGE_CACHE_LIMITS.maxPathLength < value.length ||
    value.startsWith('/') ||
    value.includes('\\')
  ) { throw new Error('Workspace image path is invalid'); }
  const segments = value.split('/');
  if (segments.some((segment) => '' === segment || '.' === segment || '..' === segment)) {
    throw new Error('Workspace image path escapes the workspace');
  }
  const extension = segments.at(-1)?.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? '';
  const mime = (media ? MEDIA_MIME_TYPES : IMAGE_MIME_TYPES)[extension];
  if (!mime) { throw new Error(`Workspace ${media ? 'media' : 'image'} type is unsupported`); }
  if (media && (2 !== segments.length || 'media' !== segments[0])) {
    throw new Error('Workspace media must be a direct child of media/');
  }
  return { path: segments.join('/'), mime };
}

function decodeBase64(value: string, maxFileBytes: number): Uint8Array {
  const maximumEncodedLength = Math.ceil(maxFileBytes / 3) * 4 + 4;
  if (
    '' === value ||
    maximumEncodedLength < value.length ||
    0 !== value.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) { throw new Error('Workspace image payload is malformed or exceeds the limit'); }
  const decoder = globalThis.atob;
  if ('function' !== typeof decoder) { throw new Error('Base64 decoding is unavailable'); }
  let binary: string;
  try {
    binary = decoder(value);
  } catch {
    throw new Error('Workspace image payload is malformed');
  }
  if (maxFileBytes < binary.length) {
    throw new Error('Workspace asset exceeds the file limit');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function defaultCreateObjectUrl(bytes: Uint8Array, mime: string): string {
  if ('undefined' === typeof Blob || 'function' !== typeof URL?.createObjectURL) {
    throw new Error('Object URL creation is unavailable');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
}

function defaultRevokeObjectUrl(url: string): void {
  URL?.revokeObjectURL?.(url);
}

export class DesktopPluginAssetHost implements WorkspaceImageResolver, Disposable {
  readonly #bridge: DesktopBridge;
  readonly #createObjectUrl: (bytes: Uint8Array, mime: string) => string;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #waiters: Array<() => void> = [];
  #activeLoads = 0;
  #cacheBytes = 0;
  #clock = 0;
  #epoch = 0;
  #disposed = false;

  public constructor(options: {
    readonly bridge: DesktopBridge;
    readonly createObjectUrl?: (bytes: Uint8Array, mime: string) => string;
    readonly revokeObjectUrl?: (url: string) => void;
  }) {
    this.#bridge = options.bridge;
    this.#createObjectUrl = options.createObjectUrl ?? defaultCreateObjectUrl;
    this.#revokeObjectUrl = options.revokeObjectUrl ?? defaultRevokeObjectUrl;
  }

  public async acquire(value: string): Promise<WorkspaceImageLease> {
    return this.#acquire(value, false);
  }

  public async resolveMedia(value: string): Promise<WorkspaceMediaLease> {
    const lease = await this.#acquire(value, true);
    return { url: lease.url, release: () => lease.dispose() };
  }

  async #acquire(value: string, media: boolean): Promise<WorkspaceImageLease> {
    if (this.#disposed) { throw new Error('Plugin asset host is disposed'); }
    const { path, mime } = assetPath(value, media);
    const maxFileBytes = media
      ? PLUGIN_IMAGE_CACHE_LIMITS.maxMediaFileBytes
      : PLUGIN_IMAGE_CACHE_LIMITS.maxFileBytes;
    const modifiedMs = await this.#bridge.invoke<unknown>('workspace_file_mtime', {
      relativePath: path,
    });
    if (!Number.isSafeInteger(modifiedMs) || Number(modifiedMs) < 0) {
      throw new Error('Workspace image mtime is malformed');
    }
    const key = `${media ? 'media' : 'image'}\u0000${path}\u0000${String(modifiedMs)}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      this.#evictWhile(() => this.#cache.size >= PLUGIN_IMAGE_CACHE_LIMITS.maxEntries);
      if (this.#cache.size >= PLUGIN_IMAGE_CACHE_LIMITS.maxEntries) {
        throw new Error('Workspace image cache entry budget exceeded');
      }
      const epoch = this.#epoch;
      const pending = {} as CacheEntry;
      const promise = this.#withLoadSlot(async () => {
        const payload = await this.#bridge.invoke<unknown>(
          media ? 'workspace_read_plugin_media' : 'workspace_read_plugin_image', {
          relativePath: path,
          },
        );
        if (this.#disposed || epoch !== this.#epoch) {
          throw new Error('Workspace image load was cancelled');
        }
        if (
          !isRecord(payload) ||
          'string' !== typeof payload.contentBase64 ||
          !Number.isSafeInteger(payload.lastModifiedMs) ||
          Number(payload.lastModifiedMs) !== Number(modifiedMs)
        ) { throw new Error('Workspace image payload or revision is malformed'); }
        const encoded = payload.contentBase64;
        const bytes = decodeBase64(encoded, maxFileBytes);
        this.#reserve(bytes.byteLength);
        let url: string;
        try {
          url = this.#createObjectUrl(bytes, mime);
        } catch (error) {
          throw error;
        }
        pending.url = url;
        pending.bytes = bytes.byteLength;
        this.#cacheBytes += bytes.byteLength;
        this.#trim();
        return pending;
      }).catch((error: unknown) => {
        if (this.#cache.get(key) === pending) { this.#cache.delete(key); }
        throw error;
      });
      Object.assign(pending, {
        key,
        path,
        modifiedMs: Number(modifiedMs),
        promise,
        bytes: 0,
        url: undefined,
        refs: 0,
        lastUsed: ++this.#clock,
      });
      entry = pending;
      this.#cache.set(key, entry);
    }
    entry.refs += 1;
    entry.lastUsed = ++this.#clock;
    try {
      await entry.promise;
    } catch (error) {
      entry.refs = Math.max(0, entry.refs - 1);
      throw error;
    }
    if (!entry.url || this.#disposed) {
      entry.refs = Math.max(0, entry.refs - 1);
      throw new Error('Workspace image was released before use');
    }
    let disposed = false;
    return {
      url: entry.url,
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        entry!.refs = Math.max(0, entry!.refs - 1);
        entry!.lastUsed = ++this.#clock;
        this.#trim();
      },
    };
  }

  public notifyWorkspaceReset(): void {
    this.#releaseAll();
  }

  public cacheStats(): { readonly entries: number; readonly bytes: number } {
    return { entries: this.#cache.size, bytes: this.#cacheBytes };
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#releaseAll();
  }

  #reserve(bytes: number): void {
    this.#evictWhile(() => this.#cacheBytes + bytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes);
    if (this.#cacheBytes + bytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes) {
      throw new Error('Workspace image cache memory budget exceeded');
    }
  }

  #trim(): void {
    this.#evictWhile(() => (
      this.#cache.size > PLUGIN_IMAGE_CACHE_LIMITS.maxEntries ||
      this.#cacheBytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes
    ));
  }

  #evictWhile(condition: () => boolean): void {
    while (condition()) {
      const candidate = [...this.#cache.values()]
        .filter((entry) => 0 === entry.refs && undefined !== entry.url)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) { return; }
      this.#evict(candidate);
    }
  }

  #evict(entry: CacheEntry): void {
    if (this.#cache.get(entry.key) !== entry) { return; }
    this.#cache.delete(entry.key);
    if (entry.url) {
      this.#revokeObjectUrl(entry.url);
      this.#cacheBytes = Math.max(0, this.#cacheBytes - entry.bytes);
      entry.url = undefined;
      entry.bytes = 0;
    }
  }

  #releaseAll(): void {
    this.#epoch += 1;
    for (const entry of this.#cache.values()) {
      if (entry.url) { this.#revokeObjectUrl(entry.url); }
      entry.url = undefined;
      entry.bytes = 0;
      entry.refs = 0;
    }
    this.#cache.clear();
    this.#cacheBytes = 0;
  }

  async #withLoadSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#activeLoads >= PLUGIN_IMAGE_CACHE_LIMITS.maxConcurrentLoads) {
      await new Promise<void>((resolve) => { this.#waiters.push(resolve); });
    }
    if (this.#disposed) { throw new Error('Plugin asset host is disposed'); }
    this.#activeLoads += 1;
    try {
      return await operation();
    } finally {
      this.#activeLoads -= 1;
      this.#waiters.shift()?.();
    }
  }
}
