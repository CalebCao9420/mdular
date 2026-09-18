import type { InProcessPluginHost } from '@mdular/plugin-runtime';
import type {
  JsonValue,
  PluginLogger,
  PluginManifestV1,
  PluginPermission,
  PluginServices,
} from '@mdular/plugin-sdk';

import type { DesktopPluginDocumentHub } from './plugin-documents.js';
import type { DesktopPluginExtensionHost } from './plugin-extensions.js';
import type { DesktopPluginEditorHost } from './plugin-editor.js';
import type { DesktopPluginCommandHost } from './plugin-commands.js';
import type { DesktopDocumentHeaderHost } from './plugin-headers.js';
import type { DesktopPluginNavigationHost } from './plugin-navigation.js';
import type { DesktopPluginStorageManager } from './plugin-storage.js';
import type { DesktopPluginViewHost } from './plugin-views.js';
import type { DesktopPluginVcsHost } from './plugin-vcs.js';
import type { DesktopPluginWorkspaceHost } from './plugin-workspace.js';

export interface DesktopPluginHostOptions {
  readonly commands?: DesktopPluginCommandHost;
  readonly documents: DesktopPluginDocumentHub;
  readonly extensions?: DesktopPluginExtensionHost;
  readonly editor?: DesktopPluginEditorHost;
  readonly headers: DesktopDocumentHeaderHost;
  readonly navigation?: DesktopPluginNavigationHost;
  readonly storage: DesktopPluginStorageManager;
  readonly views?: DesktopPluginViewHost;
  readonly vcs?: DesktopPluginVcsHost;
  readonly workspace?: DesktopPluginWorkspaceHost;
  readonly grantedPermissions?: ReadonlySet<PluginPermission>;
  readonly onDiagnostic?: (
    pluginId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: JsonValue,
  ) => void;
}

const DEFAULT_GRANTS: ReadonlySet<PluginPermission> = new Set([
  'commands',
  'documents.editActive',
  'documents.readActive',
  'editor.extensions',
  'extensions.consume',
  'extensions.register',
  'navigation.openMarkdown',
  'process.vcs',
  'ui.documentHeader',
  'ui.views',
  'storage.workspace',
  'workspace.readMarkdown',
  'workspace.readText',
  'workspace.modifyMarkdown',
  'workspace.modifyText',
  'workspace.writeMedia',
  'workspace.writeTextBatch',
  'workspace.watchMarkdown',
]);

export class DesktopPluginHost implements InProcessPluginHost {
  readonly #commands: DesktopPluginCommandHost | undefined;
  readonly #documents: DesktopPluginDocumentHub;
  readonly #extensions: DesktopPluginExtensionHost | undefined;
  readonly #editor: DesktopPluginEditorHost | undefined;
  readonly #headers: DesktopDocumentHeaderHost;
  readonly #navigation: DesktopPluginNavigationHost | undefined;
  readonly #storage: DesktopPluginStorageManager;
  readonly #views: DesktopPluginViewHost | undefined;
  readonly #vcs: DesktopPluginVcsHost | undefined;
  readonly #workspace: DesktopPluginWorkspaceHost | undefined;
  readonly #grantedPermissions: ReadonlySet<PluginPermission>;
  readonly #onDiagnostic: NonNullable<DesktopPluginHostOptions['onDiagnostic']>;

  public constructor(options: DesktopPluginHostOptions) {
    this.#commands = options.commands;
    this.#documents = options.documents;
    this.#extensions = options.extensions;
    this.#editor = options.editor;
    this.#headers = options.headers;
    this.#navigation = options.navigation;
    this.#storage = options.storage;
    this.#views = options.views;
    this.#vcs = options.vcs;
    this.#workspace = options.workspace;
    this.#grantedPermissions = options.grantedPermissions ?? DEFAULT_GRANTS;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
  }

  public createServices(manifest: PluginManifestV1): PluginServices {
    const declared = new Set(manifest.permissions ?? []);
    const allowed = (permission: PluginPermission): boolean =>
      declared.has(permission) && this.#grantedPermissions.has(permission);
    const services: PluginServices = {
      logger: this.#createLogger(manifest.id),
      ...(allowed('commands') && this.#commands
        ? { commands: this.#commands.createService(manifest) }
        : {}),
      ...(allowed('documents.readActive')
        ? { documents: this.#documents.createService(manifest.id, {
            editActive: allowed('documents.editActive'),
          }) }
        : {}),
      ...(allowed('editor.extensions') && this.#editor
        ? { editor: this.#editor.createService(manifest.id, allowed('workspace.writeMedia')) }
        : {}),
      ...((allowed('extensions.consume') || allowed('extensions.register')) && this.#extensions
        ? {
            extensions: this.#extensions.createService(manifest.id, {
              consume: allowed('extensions.consume'),
              register: allowed('extensions.register'),
            }),
          }
        : {}),
      ...(allowed('navigation.openMarkdown') && this.#navigation
        ? { navigation: this.#navigation.createService() }
        : {}),
      ...(allowed('process.vcs') && this.#vcs &&
          'mdular.vcs' === manifest.id && '0.1.0' === manifest.version && 'vcs.js' === manifest.entry
        ? { vcs: this.#vcs.createService(manifest.id) }
        : {}),
      ...(allowed('ui.documentHeader')
        ? { ui: this.#headers.createService(manifest.id) }
        : {}),
      ...(allowed('ui.views') && this.#views
        ? { views: this.#views.createService(manifest) }
        : {}),
      ...(allowed('storage.workspace')
        ? { storage: this.#storage.createService(manifest.id) }
        : {}),
      ...((allowed('workspace.readMarkdown') ||
          allowed('workspace.readText') ||
          allowed('workspace.watchMarkdown') ||
          allowed('workspace.modifyMarkdown') ||
          allowed('workspace.modifyText') ||
          allowed('workspace.writeTextBatch')) && this.#workspace
        ? {
            workspace: this.#workspace.createService(manifest.id, {
              read: allowed('workspace.readMarkdown'),
              readText: allowed('workspace.readText'),
              watch: allowed('workspace.watchMarkdown'),
              modifyMarkdown: allowed('workspace.modifyMarkdown'),
              modifyText: allowed('workspace.modifyText'),
              writeTextBatch: allowed('workspace.writeTextBatch'),
            }),
          }
        : {}),
    };
    return services;
  }

  public releaseServices(pluginId: string): void {
    this.#commands?.releasePlugin(pluginId);
    this.#documents.releasePlugin?.(pluginId);
    this.#extensions?.releasePlugin(pluginId);
    this.#editor?.releasePlugin(pluginId);
    this.#headers.releasePlugin?.(pluginId);
    this.#views?.releasePlugin(pluginId);
    this.#vcs?.releasePlugin(pluginId);
    this.#workspace?.releasePlugin(pluginId);
  }

  #createLogger(pluginId: string): PluginLogger {
    return {
      debug: (message, data) => this.#onDiagnostic(pluginId, 'debug', message, data),
      info: (message, data) => this.#onDiagnostic(pluginId, 'info', message, data),
      warn: (message, data) => this.#onDiagnostic(pluginId, 'warn', message, data),
      error: (message, data) => this.#onDiagnostic(pluginId, 'error', message, data),
    };
  }
}
