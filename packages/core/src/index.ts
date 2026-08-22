/**
 * Host-neutral invariants shared by every application shell.
 *
 * This package deliberately has no DOM, Tauri, Node.js, Godot, or Unity types.
 */

declare const workspacePathBrand: unique symbol;

/** A canonical path relative to the opened workspace. */
export type WorkspacePath = string & {
  readonly [workspacePathBrand]: 'WorkspacePath';
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

/**
 * Validates an already-normalized, workspace-relative path.
 * Platform adapters are responsible for converting native paths before calling this function.
 */
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

export interface DocumentReference {
  readonly path: WorkspacePath;
}

/** Immutable content observed at one host-owned revision. */
export interface DocumentSnapshot extends DocumentReference {
  readonly text: string;
  readonly revision: string;
  readonly dirty: boolean;
}
