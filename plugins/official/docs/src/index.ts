import {
  definePlugin,
  definePluginManifest,
  documentStorageKey,
  excludedDocumentPaths,
} from '@mdular/plugin-sdk';
import type {
  DocumentHeaderField,
  DocumentHeaderProvider,
  PluginContext,
  PluginManifestV1,
  PluginStorageService,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import { DocsController } from './controller.js';
import type { DocsWorkspace } from './controller.js';
import { parseDocumentMetadata } from './metadata.js';
import type { MetadataField } from './metadata.js';

const EXPANDED_STATE_KEY = 'metadata-expanded';

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

async function readExpanded(storage: PluginStorageService, path: string): Promise<boolean> {
  const result = await storage.get(documentStorageKey(path, EXPANDED_STATE_KEY));
  return result.ok && 1 === result.value?.schemaVersion && true === result.value.value;
}

function fieldsForView(fields: readonly MetadataField[]): readonly DocumentHeaderField[] {
  return fields.map((field) => ({
    key: field.key,
    kind: field.kind,
    ...(undefined === field.value ? {} : { value: field.value }),
  }));
}

function createMetadataProvider(context: PluginContext): DocumentHeaderProvider {
  const storage = context.storage;
  if (!storage) { throw new Error('Docs Metadata requires storage.workspace'); }
  const extensions = context.extensions;
  if (!extensions) { throw new Error('Docs Metadata requires extensions.consume'); }
  return {
    id: 'metadata',
    async provide(snapshot) {
      const normalizedPath = snapshot.path.toLocaleLowerCase('en-US');
      if (
        !normalizedPath.endsWith('.md') ||
        excludedDocumentPaths(extensions, 'metadata').has(normalizedPath)
      ) { return null; }
      const parsed = parseDocumentMetadata(snapshot.content);
      if ('none' === parsed.kind) { return null; }
      const expanded = await readExpanded(storage, snapshot.path);
      if ('invalid' === parsed.kind) {
        return {
          title: 'Metadata',
          summary: 'invalid',
          expanded,
          fields: expanded
            ? [{ key: parsed.duplicateKey ?? parsed.reason, kind: 'complex' }]
            : [],
          toggleAction: 'toggle',
        };
      }
      return {
        title: 'Metadata',
        summary: `${parsed.fields.length} field${1 === parsed.fields.length ? '' : 's'}`,
        expanded,
        badges: [
          ...(parsed.status ? [{ label: `status: ${parsed.status}`, tone: 'info' as const }] : []),
          ...(parsed.updated ? [{ label: `updated: ${parsed.updated}`, tone: 'neutral' as const }] : []),
        ],
        fields: expanded ? fieldsForView(parsed.fields) : [],
        toggleAction: 'toggle',
      };
    },
    async onAction(action, snapshot) {
      if ('toggle' !== action.type) { return; }
      const expanded = await readExpanded(storage, snapshot.path);
      const result = await storage.set(documentStorageKey(snapshot.path, EXPANDED_STATE_KEY), {
        schemaVersion: 1,
        value: !expanded,
      });
      if (!result.ok) {
        context.logger?.warn('Unable to persist Metadata expansion state', {
          kind: result.error.kind,
          message: result.error.message,
        });
      }
    },
  };
}

const plugin = definePlugin({
  activate(context) {
    if (!context.documents) { throw new Error('Docs Metadata requires documents.readActive'); }
    if (!context.extensions) { throw new Error('Docs Metadata requires extensions.consume'); }
    if (!context.ui) { throw new Error('Docs Metadata requires ui.documentHeader'); }
    const provider = createMetadataProvider(context);
    if (!context.commands) { throw new Error('Docs requires commands'); }
    if (!context.documents.applyActiveEdit) {
      throw new Error('Docs requires documents.editActive');
    }
    if (!context.navigation) { throw new Error('Docs requires navigation.openMarkdown'); }
    if (!context.views) { throw new Error('Docs requires ui.views'); }
    const workspace = context.workspace;
    if (
      !workspace?.readMarkdown ||
      !workspace.listMarkdown ||
      !workspace.watchMarkdown ||
      !workspace.planTextWrites ||
      !workspace.commitTextWritePlan
    ) { throw new Error('Docs requires bounded workspace read, watch and text batch services'); }
    context.subscriptions.add(context.ui.registerDocumentHeaderProvider(provider));
    const controller = new DocsController(context, {
      documents: context.documents,
      extensions: context.extensions,
      navigation: context.navigation,
      views: context.views,
      workspace: workspace as DocsWorkspace,
    });
    context.subscriptions.add(controller);
    controller.start();
  },
});

export default plugin;
export { parseDocumentMetadata } from './metadata.js';
export { archiveChatMessageToDocs, buildDocsArchiveContent } from './chat-archive.js';
export { DocsController, DOCS_COMMANDS } from './controller.js';
export {
  FRONTMATTER_ROUNDTRIP_LIMITS,
  parseRoundTripFrontmatter,
  updateRoundTripFrontmatter,
} from './frontmatter-roundtrip.js';
export {
  buildDocsReaderDocument,
  DOCS_READER_LIMITS,
  summarizeDocsDocument,
} from './reading.js';
export type {
  MetadataField,
  MetadataFieldKind,
  MetadataInvalidReason,
  MetadataParseResult,
} from './metadata.js';
export type {
  RoundTripFrontmatterField,
  RoundTripFrontmatterResult,
  RoundTripFrontmatterUpdateResult,
} from './frontmatter-roundtrip.js';
export type { DocsDocumentSummary, DocsReaderDocument } from './reading.js';
