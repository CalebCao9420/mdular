import {
  definePlugin,
  definePluginManifest,
} from '@mdular/plugin-sdk';
import type {
  PluginContext,
  PluginManifestV1,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

const plugin = definePlugin({
  activate(context: PluginContext) {
    const editor = context.editor;
    if (!editor) {
      throw new Error('Extended Markdown requires editor.extensions');
    }
    context.subscriptions.add(editor.registerExtension({
      schemaVersion: 1,
      id: 'mdular.extended-markdown.features',
      features: [
        'code-languages',
        'emoji',
        'math',
        'mermaid',
        'tables',
        'wiki-links',
      ],
    }));
  },
});

export default plugin;
