/** Host-neutral document state. No DOM, Tauri, Node.js, or engine types. */

export {
  byteHashFromHost,
  opaqueRevisionFromHost,
  workspacePath,
  workspacePathKeyFromHost,
  WorkspacePathError,
} from '@mdular/platform';

export type {
  ByteHash,
  Disposable,
  DocumentAccess,
  DocumentSnapshot,
  DocumentTextFormat,
  OpaqueRevision,
  WorkspaceAdapter,
  WorkspaceAdapterCapabilities,
  WorkspaceChangeHint,
  WorkspacePath,
  WorkspacePathErrorCode,
  WorkspacePathKey,
  WorkspaceReadError,
  WorkspaceReadErrorKind,
  WorkspaceReadResult,
  WorkspaceStat,
  WorkspaceStatResult,
  WorkspaceWriteErrorKind,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '@mdular/platform';

export {
  DocumentReadOnlyError,
  DocumentSession,
  RecoveryCoordinator,
  SessionRegistry,
} from './document-session.js';

export type {
  DocumentConflict,
  DocumentSessionState,
  ExternalRefreshOutcome,
  PrepareForRestartResult,
  RecoveryClock,
  RecoveryCoordinatorOptions,
  RecoveryFlushReason,
  RecoveryPersistOutcome,
  RecoveryRecord,
  RecoveryRestoreOutcome,
  RecoveryScheduler,
  RecoveryState,
  RecoveryStore,
  RecoveryTimer,
  RestartBlockReason,
  SaveOutcome,
  SaveState,
  WorkspaceWatchRefresh,
} from './document-session.js';
