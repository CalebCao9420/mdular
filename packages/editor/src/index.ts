export { PaneController } from './pane-controller.js';
export { SessionEditorBinding } from './session-editor-binding.js';
export {
  computeLineDiff,
  createWorkerUnavailableDiff,
  LINE_DIFF_LIMITS,
} from './line-diff.js';

export type {
  PaneControllerState,
  PaneCloseResult,
  PaneId,
  PaneLayoutPreference,
  PaneOpenOptions,
  PaneOpenResult,
  PaneOpenTarget,
  PaneState,
  PaneViewState,
} from './pane-controller.js';

export type {
  SessionEditorBindingOptions,
  TextEditorPort,
} from './session-editor-binding.js';

export type {
  LineDiffLimitReason,
  LineDiffLimits,
  LineDiffOptions,
  LineDiffResult,
  LineDiffWorkerRequest,
  LineDiffWorkerResponse,
  UnifiedDiffHunk,
  UnifiedDiffLine,
} from './line-diff.js';
