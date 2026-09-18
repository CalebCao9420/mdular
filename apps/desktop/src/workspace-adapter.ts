import {
  byteHashFromHost,
  opaqueRevisionFromHost,
  workspacePath,
  workspacePathKeyFromHost,
} from '@mdular/platform';
import type {
  DocumentAccess,
  DocumentSnapshot,
  DocumentTextFormat,
  Disposable,
  WorkspaceAdapter,
  WorkspaceAdapterCapabilities,
  WorkspaceChangeHint,
  WorkspacePath,
  WorkspaceReadError,
  WorkspaceReadResult,
  WorkspaceStat,
  WorkspaceStatResult,
  WorkspaceWriteErrorKind,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '@mdular/platform';

export const desktopWorkspaceCapabilities: WorkspaceAdapterCapabilities = {
  persistence: 'durable',
  atomicReplace: 'host-guaranteed',
  externalWatch: 'native-hints',
};

export interface DesktopBridge {
  invoke<TResult>(command: string, args: Record<string, unknown>): Promise<TResult>;
  listen<TPayload>(event: string, listener: (payload: TPayload) => void): Promise<() => void>;
}

export interface DesktopWorkspaceAdapterOptions {
  readonly onDiagnostic?: (message: string) => void;
}

interface WireSnapshot {
  readonly path: string;
  readonly pathKey: string;
  readonly content: string;
  readonly revision: string;
  readonly byteHash: string;
  readonly format: DocumentTextFormat;
  readonly access: DocumentAccess;
  readonly capturedAt: number;
}

type WireReadResult =
  | { readonly status: 'ok'; readonly snapshot: WireSnapshot }
  | { readonly status: 'error'; readonly error: WorkspaceReadError };

type WireWriteResult =
  | { readonly status: 'ok'; readonly snapshot: WireSnapshot }
  | { readonly status: 'conflict'; readonly current: WireSnapshot }
  | {
      readonly status: 'error';
      readonly kind: WorkspaceWriteErrorKind;
      readonly message: string;
    };

type WireStatResult =
  | {
      readonly status: 'ok';
      readonly stat:
        | { readonly kind: 'file'; readonly path: string; readonly pathKey: string; readonly revision: string }
        | { readonly kind: 'directory'; readonly path: string; readonly pathKey: string }
        | { readonly kind: 'missing'; readonly path: string };
    }
  | { readonly status: 'error'; readonly error: WorkspaceReadError };

interface WireChangeHint {
  readonly path: string;
  readonly pathKey?: string;
  readonly kind: WorkspaceChangeHint['kind'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if ('string' !== typeof value) { throw new Error(`${label} must be a string`); }
  return value;
}

function decodeFormat(value: unknown): DocumentTextFormat {
  if (!isRecord(value)) { throw new Error('Document format must be an object'); }
  if ('none' !== value.bom && 'utf8' !== value.bom) {
    throw new Error('Document format has an invalid BOM value');
  }
  if ('lf' !== value.mainEol && 'crlf' !== value.mainEol) {
    throw new Error('Document format has an invalid EOL value');
  }
  if ('boolean' !== typeof value.trailingNewline) {
    throw new Error('Document format trailingNewline must be boolean');
  }
  return {
    bom: value.bom,
    mainEol: value.mainEol,
    trailingNewline: value.trailingNewline,
  };
}

function decodeAccess(value: unknown): DocumentAccess {
  if (!isRecord(value)) { throw new Error('Document access must be an object'); }
  if ('read-write' === value.kind) { return { kind: 'read-write' }; }
  if (
    'read-only' === value.kind &&
    'unsupported-encoding' === value.reason &&
    'string' === typeof value.message
  ) {
    return {
      kind: 'read-only',
      reason: 'unsupported-encoding',
      message: value.message,
    };
  }
  throw new Error('Document access has an invalid value');
}

function decodeSnapshot(value: unknown): DocumentSnapshot {
  if (!isRecord(value)) { throw new Error('Document snapshot must be an object'); }
  const capturedAt = value.capturedAt;
  if ('number' !== typeof capturedAt || !Number.isFinite(capturedAt)) {
    throw new Error('Document snapshot capturedAt must be finite');
  }
  return {
    path: workspacePath(assertString(value.path, 'Document path')),
    pathKey: workspacePathKeyFromHost(assertString(value.pathKey, 'Document path key')),
    content: assertString(value.content, 'Document content'),
    revision: opaqueRevisionFromHost(assertString(value.revision, 'Document revision')),
    byteHash: byteHashFromHost(assertString(value.byteHash, 'Document byte hash')),
    format: decodeFormat(value.format),
    access: decodeAccess(value.access),
    capturedAt,
  };
}

function decodeReadError(value: unknown): WorkspaceReadError {
  if (!isRecord(value) || 'string' !== typeof value.message) {
    throw new Error('Workspace read error is malformed');
  }
  if (![
    'not-found',
    'outside-workspace',
    'unsupported-encoding',
    'permission-denied',
    'io-error',
  ].includes(String(value.kind))) {
    throw new Error('Workspace read error has an invalid kind');
  }
  return {
    kind: value.kind as WorkspaceReadError['kind'],
    message: value.message,
  };
}

function ioReadError(error: unknown): WorkspaceReadError {
  return {
    kind: 'io-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function decodeWriteErrorKind(value: unknown): WorkspaceWriteErrorKind {
  if (![
    'not-found',
    'outside-workspace',
    'read-only',
    'permission-denied',
    'metadata-not-preserved',
    'io-error',
  ].includes(String(value))) {
    throw new Error('Workspace write error has an invalid kind');
  }
  return value as WorkspaceWriteErrorKind;
}

function requireSnapshotIdentity(
  snapshot: DocumentSnapshot,
  path: WorkspacePath,
  pathKey?: WorkspaceWriteRequest['pathKey'],
): void {
  if (snapshot.path !== path) { throw new Error('Workspace command returned a different path'); }
  if (pathKey && snapshot.pathKey !== pathKey) {
    throw new Error('Workspace command returned a different path key');
  }
}

function writeIoError(error: unknown): WorkspaceWriteResult {
  return {
    ok: false,
    kind: 'io-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export class DesktopWorkspaceAdapter implements WorkspaceAdapter {
  public readonly capabilities = desktopWorkspaceCapabilities;

  readonly #bridge: DesktopBridge;
  readonly #onDiagnostic: (message: string) => void;

  public constructor(bridge: DesktopBridge, options: DesktopWorkspaceAdapterOptions = {}) {
    this.#bridge = bridge;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
  }

  public async read(path: WorkspacePath): Promise<WorkspaceReadResult> {
    try {
      const result = await this.#bridge.invoke<WireReadResult>(
        'workspace_read_document',
        { request: { path } },
      );
      if (!isRecord(result)) { throw new Error('Workspace read result must be an object'); }
      if ('error' === result.status) {
        return { ok: false, error: decodeReadError(result.error) };
      }
      if ('ok' !== result.status) { throw new Error('Workspace read result has an invalid status'); }
      const snapshot = decodeSnapshot(result.snapshot);
      requireSnapshotIdentity(snapshot, path);
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, error: ioReadError(error) };
    }
  }

  public async write(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult> {
    try {
      const result = await this.#bridge.invoke<WireWriteResult>(
        'workspace_write_document_if_revision',
        { request },
      );
      if (!isRecord(result)) { throw new Error('Workspace write result must be an object'); }
      if ('ok' === result.status) {
        const snapshot = decodeSnapshot(result.snapshot);
        requireSnapshotIdentity(snapshot, request.path, request.pathKey);
        return { ok: true, snapshot };
      }
      if ('conflict' === result.status) {
        const current = decodeSnapshot(result.current);
        requireSnapshotIdentity(current, request.path, request.pathKey);
        return { ok: false, kind: 'conflict', current };
      }
      if (
        'error' === result.status &&
        'string' === typeof result.kind &&
        'string' === typeof result.message
      ) {
        return {
          ok: false,
          kind: decodeWriteErrorKind(result.kind),
          message: result.message,
        };
      }
      throw new Error('Workspace write result has an invalid status');
    } catch (error) {
      return writeIoError(error);
    }
  }

  public async stat(path: WorkspacePath): Promise<WorkspaceStatResult> {
    try {
      const result = await this.#bridge.invoke<WireStatResult>(
        'workspace_stat_document',
        { request: { path } },
      );
      if (!isRecord(result)) { throw new Error('Workspace stat result must be an object'); }
      if ('error' === result.status) {
        return { ok: false, error: decodeReadError(result.error) };
      }
      if ('ok' !== result.status || !isRecord(result.stat)) {
        throw new Error('Workspace stat result has an invalid status');
      }
      const statPath = workspacePath(assertString(result.stat.path, 'Workspace stat path'));
      let stat: WorkspaceStat;
      if ('missing' === result.stat.kind) {
        stat = { kind: 'missing', path: statPath };
      } else if ('directory' === result.stat.kind) {
        stat = {
          kind: 'directory',
          path: statPath,
          pathKey: workspacePathKeyFromHost(
            assertString(result.stat.pathKey, 'Workspace stat path key'),
          ),
        };
      } else if ('file' === result.stat.kind) {
        stat = {
          kind: 'file',
          path: statPath,
          pathKey: workspacePathKeyFromHost(
            assertString(result.stat.pathKey, 'Workspace stat path key'),
          ),
          revision: opaqueRevisionFromHost(
            assertString(result.stat.revision, 'Workspace stat revision'),
          ),
        };
      } else {
        throw new Error('Workspace stat has an invalid kind');
      }
      if (stat.path !== path) { throw new Error('Workspace stat returned a different path'); }
      return { ok: true, stat };
    } catch (error) {
      return { ok: false, error: ioReadError(error) };
    }
  }

  public watch(listener: (hint: WorkspaceChangeHint) => void): Disposable {
    let disposed = false;
    const subscription = this.#bridge
      .listen<WireChangeHint>('workspace-document-change', (wire) => {
        if (disposed) { return; }
        try {
          if (!isRecord(wire)) { throw new Error('Workspace change hint must be an object'); }
          if (!['created', 'changed', 'deleted'].includes(String(wire.kind))) {
            throw new Error('Workspace change hint has an invalid kind');
          }
          const pathKey = undefined === wire.pathKey
            ? undefined
            : workspacePathKeyFromHost(assertString(wire.pathKey, 'Workspace change path key'));
          listener({
            path: workspacePath(assertString(wire.path, 'Workspace change path')),
            ...(pathKey ? { pathKey } : {}),
            kind: wire.kind as WorkspaceChangeHint['kind'],
          });
        } catch (error) {
          this.#onDiagnostic(error instanceof Error ? error.message : String(error));
        }
      })
      .catch((error: unknown) => {
        this.#onDiagnostic(error instanceof Error ? error.message : String(error));
        return () => {};
      });
    return {
      dispose: async () => {
        disposed = true;
        const unlisten = await subscription;
        unlisten();
      },
    };
  }

  public trackDocument(path: WorkspacePath): Disposable {
    let disposed = false;
    let registered = false;
    const registration = this.#bridge
      .invoke<void>('workspace_watch_document', { relativePath: path })
      .then(() => { registered = true; })
      .catch((error: unknown) => {
        this.#onDiagnostic(error instanceof Error ? error.message : String(error));
      });
    return {
      dispose: async () => {
        if (disposed) { return; }
        disposed = true;
        await registration;
        if (!registered) { return; }
        try {
          await this.#bridge.invoke<void>('workspace_unwatch_document', { relativePath: path });
        } catch (error) {
          this.#onDiagnostic(error instanceof Error ? error.message : String(error));
        }
      },
    };
  }
}
