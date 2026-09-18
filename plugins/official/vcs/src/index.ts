import {
  definePlugin,
  definePluginManifest,
} from '@mdular/plugin-sdk';
import type { PluginContext, PluginManifestV1 } from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import { VcsController } from './controller.js';

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

const plugin = definePlugin({
  activate(context: PluginContext) {
    if (!context.commands) { throw new Error('VCS requires commands'); }
    if (!context.documents) { throw new Error('VCS requires document save-state access'); }
    if (!context.storage) { throw new Error('VCS requires workspace storage'); }
    if (!context.vcs) { throw new Error('VCS requires the official bounded process broker'); }
    if (!context.views) { throw new Error('VCS requires ui.views'); }
    const controller = new VcsController(context, {
      documents: context.documents,
      storage: context.storage,
      vcs: context.vcs,
      views: context.views,
    });
    controller.start();
    return controller;
  },
});

export default plugin;
export {
  diffReaderBlocks,
  mergeVcsStatus,
  VCS_LIMITS,
  visibleStatusCode,
} from './model.js';
