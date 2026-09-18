/** Host-neutral filesystem contracts. Native paths never cross this boundary. */

declare const workspacePathBrand: unique symbol;
declare const workspacePathKeyBrand: unique symbol;
declare const revisionBrand: unique symbol;
declare const byteHashBrand: unique symbol;

export type WorkspacePath = string & {
  readonly [workspacePathBrand]: 'WorkspacePath';
};

export type WorkspacePathKey = string & {
  readonly [workspacePathKeyBrand]: 'WorkspacePathKey';
};

export type OpaqueRevision = string & {
  readonly [revisionBrand]: 'OpaqueRevision';
};

export type ByteHash = string & {
  readonly [byteHashBrand]: 'ByteHash';
};

export type WorkspacePathErrorCode =
  | 'empty'
  | 'absolute'
  | 'backslash'
  | 'empty-segment'
  | 'traversal'
  | 'null-byte';

export class WorkspacePathError extends Error {
  public readonly code: WorkspacePathErrorCode;
  public readonly value: string;

  public constructor(code: WorkspacePathErrorCode, value: string) {
    super(`Invalid workspace path (${code}): ${JSON.stringify(value)}`);
    this.name = 'WorkspacePathError';
    this.code = code;
    this.value = value;
  }
}

/** Validates an already-normalized, workspace-relative display path. */
export function workspacePath(value: string): WorkspacePath {
  if ('' === value) { throw new WorkspacePathError('empty', value); }
  if (value.includes('\0')) { throw new WorkspacePathError('null-byte', value); }
  if (value.includes('\\')) { throw new WorkspacePathError('backslash', value); }
  if (value.startsWith('/') || /^[A-Za-z]:\//u.test(value)) {
    throw new WorkspacePathError('absolute', value);
  }

  const segments = value.split('/');
  if (segments.some((segment) => '' === segment)) {
    throw new WorkspacePathError('empty-segment', value);
  }
  if (segments.some((segment) => '.' === segment || '..' === segment)) {
    throw new WorkspacePathError('traversal', value);
  }
  return value as WorkspacePath;
}

function nonEmptyHostToken<TValue extends string>(value: string, label: string): TValue {
  if ('' === value) { throw new Error(`${label} must not be empty`); }
  return value as TValue;
}

/** Host adapters create keys after applying the real filesystem's case/Unicode rules. */
export function workspacePathKeyFromHost(value: string): WorkspacePathKey {
  return nonEmptyHostToken<WorkspacePathKey>(value, 'Workspace path key');
}

/** Revisions are opaque to Core and only comparable for exact equality. */
export function opaqueRevisionFromHost(value: string): OpaqueRevision {
  return nonEmptyHostToken<OpaqueRevision>(value, 'Revision');
}

export function byteHashFromHost(value: string): ByteHash {
  return nonEmptyHostToken<ByteHash>(value, 'Byte hash');
}

export interface DocumentTextFormat {
  readonly bom: 'none' | 'utf8';
  readonly mainEol: 'lf' | 'crlf';
  readonly trailingNewline: boolean;
}

export type DocumentAccess =
  | { readonly kind: 'read-write' }
  | {
      readonly kind: 'read-only';
      readonly reason: 'unsupported-encoding';
      readonly message: string;
    };

export interface DocumentSnapshot {
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  /** UTF-8 text, or a display-only replacement preview when access is read-only. */
  readonly content: string;
  readonly revision: OpaqueRevision;
  readonly byteHash: ByteHash;
  readonly format: DocumentTextFormat;
  readonly access: DocumentAccess;
  /** Diagnostic timestamp only; never participates in conflict detection. */
  readonly capturedAt: number;
}

export type WorkspaceReadErrorKind =
  | 'not-found'
  | 'outside-workspace'
  | 'unsupported-encoding'
  | 'permission-denied'
  | 'io-error';

export interface WorkspaceReadError {
  readonly kind: WorkspaceReadErrorKind;
  readonly message: string;
}

export type WorkspaceReadResult =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | { readonly ok: false; readonly error: WorkspaceReadError };

export interface WorkspaceWriteRequest {
  readonly path: WorkspacePath;
  readonly pathKey: WorkspacePathKey;
  readonly expectedRevision: OpaqueRevision;
  readonly content: string;
  readonly format: DocumentTextFormat;
}

export type WorkspaceWriteErrorKind =
  | 'not-found'
  | 'outside-workspace'
  | 'read-only'
  | 'permission-denied'
  | 'metadata-not-preserved'
  | 'io-error';

export type WorkspaceWriteResult =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | {
      readonly ok: false;
      readonly kind: 'conflict';
      readonly current: DocumentSnapshot;
    }
  | {
      readonly ok: false;
      readonly kind: WorkspaceWriteErrorKind;
      readonly message: string;
    };

export type WorkspaceStat =
  | {
      readonly path: WorkspacePath;
      readonly pathKey: WorkspacePathKey;
      readonly kind: 'file';
      readonly revision: OpaqueRevision;
    }
  | {
      readonly path: WorkspacePath;
      readonly pathKey: WorkspacePathKey;
      readonly kind: 'directory';
    }
  | {
      readonly path: WorkspacePath;
      readonly kind: 'missing';
    };

export type WorkspaceStatResult =
  | { readonly ok: true; readonly stat: WorkspaceStat }
  | { readonly ok: false; readonly error: WorkspaceReadError };

export interface WorkspaceChangeHint {
  readonly path: WorkspacePath;
  readonly pathKey?: WorkspacePathKey;
  readonly kind: 'created' | 'changed' | 'deleted';
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface WorkspaceAdapterCapabilities {
  readonly persistence: 'durable' | 'session-memory';
  readonly atomicReplace: 'host-guaranteed' | 'memory-assignment';
  readonly externalWatch: 'native-hints' | 'adapter-local-only' | 'unavailable';
}

export interface WorkspaceAdapter {
  readonly capabilities: WorkspaceAdapterCapabilities;
  read(path: WorkspacePath): Promise<WorkspaceReadResult>;
  write(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>;
  stat(path: WorkspacePath): Promise<WorkspaceStatResult>;
  watch(listener: (hint: WorkspaceChangeHint) => void): Disposable;
}
