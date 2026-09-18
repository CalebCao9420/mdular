import {
  definePlugin,
  definePluginManifest,
} from '@mdular/plugin-sdk';
import type {
  PluginContext,
  PluginManifestV1,
  PluginWorkspaceService,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import { KanbanController } from './controller.js';

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

type KanbanWorkspace = Required<Pick<
  PluginWorkspaceService,
  | 'beginMarkdownEdit'
  | 'beginTextEdit'
  | 'commitMarkdownEdit'
  | 'commitTextEdit'
  | 'commitTextWritePlan'
  | 'listMarkdown'
  | 'planTextWrites'
  | 'readMarkdown'
  | 'readText'
  | 'watchMarkdown'
>>;

function workspaceServices(context: PluginContext): KanbanWorkspace {
  const workspace = context.workspace;
  if (
    !workspace?.beginMarkdownEdit || !workspace.beginTextEdit ||
    !workspace.commitMarkdownEdit || !workspace.commitTextEdit ||
    !workspace.commitTextWritePlan || !workspace.listMarkdown ||
    !workspace.planTextWrites || !workspace.readMarkdown || !workspace.readText ||
    !workspace.watchMarkdown
  ) {
    throw new Error('Kanban requires bounded workspace read, watch, create and modify access');
  }
  return {
    beginMarkdownEdit: workspace.beginMarkdownEdit,
    beginTextEdit: workspace.beginTextEdit,
    commitMarkdownEdit: workspace.commitMarkdownEdit,
    commitTextEdit: workspace.commitTextEdit,
    commitTextWritePlan: workspace.commitTextWritePlan,
    listMarkdown: workspace.listMarkdown,
    planTextWrites: workspace.planTextWrites,
    readMarkdown: workspace.readMarkdown,
    readText: workspace.readText,
    watchMarkdown: workspace.watchMarkdown,
  };
}

const plugin = definePlugin({
  activate(context) {
    if (!context.commands) { throw new Error('Kanban requires commands'); }
    if (!context.extensions) { throw new Error('Kanban requires extension registration'); }
    if (!context.navigation) { throw new Error('Kanban requires Markdown navigation'); }
    if (!context.storage) { throw new Error('Kanban requires workspace storage'); }
    if (!context.views) { throw new Error('Kanban requires ui.views'); }
    const controller = new KanbanController(context, {
      extensions: context.extensions,
      storage: context.storage,
      views: context.views,
      workspace: workspaceServices(context),
    });
    controller.start();
    return controller;
  },
});

export default plugin;
export {
  buildIssueDocument,
  defaultBoardConfig,
  defaultStatusConfig,
  groupIssuesByColumn,
  groupIssuesByStatus,
  issuePathStem,
  issueTags,
  KANBAN_LIMITS,
  matchesIssueFilter,
  normalizeStatus,
  parseBoardConfig,
  parseIssueCard,
  parseStatusConfig,
  patchIssueFrontmatter,
  resolveIssueColumn,
  serializeBoardConfig,
  serializeStatusConfig,
  splitIssueArchiveText,
} from './model.js';
