export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type PluginActivationEvent =
  | 'onStartup'
  | `onCommand:${string}`
  | `onView:${string}`;

/** Capabilities are granted by the host; declaring one does not grant it automatically. */
export type PluginPermission =
  | 'commands'
  | 'documents.editActive'
  | 'documents.readActive'
  | 'editor.extensions'
  | 'extensions.consume'
  | 'extensions.register'
  | 'navigation.openMarkdown'
  | 'process.vcs'
  | 'storage.workspace'
  | 'ui.documentHeader'
  | 'ui.views'
  | 'workspace.readMarkdown'
  | 'workspace.readText'
  | 'workspace.modifyMarkdown'
  | 'workspace.modifyText'
  | 'workspace.writeMedia'
  | 'workspace.writeTextBatch'
  | 'workspace.writeMarkdown'
  | 'workspace.watchMarkdown';

export interface PluginCommandContribution {
  readonly id: string;
  readonly title: string;
  readonly defaultKeybindings?: readonly string[];
}

export interface PluginViewContribution {
  readonly id: string;
  readonly title: string;
  readonly location: 'sidebar' | 'secondary-pane' | 'editor-pane';
}

export interface PluginDocumentHeaderContribution {
  readonly id: string;
  readonly title: string;
}

export interface PluginContributions {
  readonly commands?: readonly PluginCommandContribution[];
  readonly documentHeaders?: readonly PluginDocumentHeaderContribution[];
  readonly views?: readonly PluginViewContribution[];
}

export interface PluginManifestV1 {
  readonly schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entry: string;
  readonly description?: string;
  readonly activationEvents?: readonly PluginActivationEvent[];
  readonly permissions?: readonly PluginPermission[];
  readonly contributes?: PluginContributions;
}

/** Compile-time helper; runtime schema validation belongs to the installer/host boundary. */
export function definePluginManifest<const TManifest extends PluginManifestV1>(
  manifest: TManifest,
): TManifest {
  return manifest;
}

export type PluginManifestValidationResult =
  | { readonly ok: true; readonly manifest: PluginManifestV1 }
  | { readonly ok: false; readonly errors: readonly string[] };

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set<PluginPermission>([
  'commands',
  'documents.editActive',
  'documents.readActive',
  'editor.extensions',
  'extensions.consume',
  'extensions.register',
  'navigation.openMarkdown',
  'process.vcs',
  'storage.workspace',
  'ui.documentHeader',
  'ui.views',
  'workspace.readMarkdown',
  'workspace.readText',
  'workspace.modifyMarkdown',
  'workspace.modifyText',
  'workspace.writeMedia',
  'workspace.writeTextBatch',
  'workspace.writeMarkdown',
  'workspace.watchMarkdown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return 'string' === typeof value && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(value);
}

function isEntryBasename(value: unknown): value is string {
  return 'string' === typeof value && /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(value);
}

function isKeybinding(value: unknown): value is string {
  if ('string' !== typeof value) { return false; }
  const parts = value.split('+');
  const key = parts.pop();
  const modifiers = new Set(parts);
  return (
    0 < parts.length &&
    parts.length === modifiers.size &&
    parts.every((part) => ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'].includes(part)) &&
    ('Enter' === key || 'Escape' === key || /^[A-Z0-9]$/u.test(key ?? ''))
  );
}

function validateContributions(value: unknown, errors: string[]): void {
  if (undefined === value) { return; }
  if (!isRecord(value)) {
    errors.push('contributes must be an object');
    return;
  }
  if (undefined !== value.documentHeaders) {
    if (!Array.isArray(value.documentHeaders)) {
      errors.push('contributes.documentHeaders must be an array');
    } else {
      const seen = new Set<string>();
      value.documentHeaders.forEach((entry, index) => {
        if (
          !isRecord(entry) ||
          !isIdentifier(entry.id) ||
          'string' !== typeof entry.title ||
          '' === entry.title.trim()
        ) {
          errors.push(`contributes.documentHeaders[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate document header contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
  if (undefined !== value.commands) {
    if (!Array.isArray(value.commands)) {
      errors.push('contributes.commands must be an array');
    } else {
      const seen = new Set<string>();
      value.commands.forEach((entry, index) => {
        if (
          !isRecord(entry) ||
          !isIdentifier(entry.id) ||
          'string' !== typeof entry.title ||
          '' === entry.title.trim() ||
          (undefined !== entry.defaultKeybindings && (
            !Array.isArray(entry.defaultKeybindings) ||
            entry.defaultKeybindings.some((keybinding) => !isKeybinding(keybinding)) ||
            new Set(entry.defaultKeybindings).size !== entry.defaultKeybindings.length
          ))
        ) {
          errors.push(`contributes.commands[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate command contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
  if (undefined !== value.views) {
    if (!Array.isArray(value.views)) {
      errors.push('contributes.views must be an array');
    } else {
      const seen = new Set<string>();
      value.views.forEach((entry, index) => {
        if (
          !isRecord(entry) ||
          !isIdentifier(entry.id) ||
          'string' !== typeof entry.title ||
          '' === entry.title.trim() ||
          !['sidebar', 'secondary-pane', 'editor-pane'].includes(String(entry.location))
        ) {
          errors.push(`contributes.views[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate view contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
}

/** Runtime boundary validation; unknown permissions and non-basename entries fail closed. */
export function validatePluginManifest(value: unknown): PluginManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) { return { ok: false, errors: ['manifest must be an object'] }; }
  if (PLUGIN_MANIFEST_SCHEMA_VERSION !== value.schemaVersion) {
    errors.push(`schemaVersion must be ${PLUGIN_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!isIdentifier(value.id)) { errors.push('id must be a canonical plugin identifier'); }
  if ('string' !== typeof value.name || '' === value.name.trim()) {
    errors.push('name must be a non-empty string');
  }
  if ('string' !== typeof value.version || '' === value.version.trim()) {
    errors.push('version must be a non-empty string');
  }
  if (!isEntryBasename(value.entry)) {
    errors.push('entry must be a JavaScript basename without a path');
  }
  if (undefined !== value.description && 'string' !== typeof value.description) {
    errors.push('description must be a string');
  }
  if (undefined !== value.activationEvents) {
    if (!Array.isArray(value.activationEvents)) {
      errors.push('activationEvents must be an array');
    } else {
      value.activationEvents.forEach((event, index) => {
        if (
          'string' !== typeof event ||
          !('onStartup' === event || /^on(?:Command|View):[a-z0-9][a-z0-9._-]*$/u.test(event))
        ) {
          errors.push(`activationEvents[${index}] is malformed`);
        }
      });
    }
  }
  if (undefined !== value.permissions) {
    if (!Array.isArray(value.permissions)) {
      errors.push('permissions must be an array');
    } else {
      const seen = new Set<string>();
      value.permissions.forEach((permission, index) => {
        if ('string' !== typeof permission || !KNOWN_PERMISSIONS.has(permission)) {
          errors.push(`permissions[${index}] is unknown`);
          return;
        }
        if (seen.has(permission)) { errors.push(`duplicate permission: ${permission}`); }
        seen.add(permission);
      });
    }
  }
  validateContributions(value.contributes, errors);
  if (
    isRecord(value.contributes) &&
    Array.isArray(value.contributes.documentHeaders) &&
    0 < value.contributes.documentHeaders.length &&
    (!Array.isArray(value.permissions) || !value.permissions.includes('ui.documentHeader'))
  ) {
    errors.push('document header contributions require ui.documentHeader');
  }
  if (
    isRecord(value.contributes) &&
    Array.isArray(value.contributes.commands) &&
    0 < value.contributes.commands.length &&
    (!Array.isArray(value.permissions) || !value.permissions.includes('commands'))
  ) {
    errors.push('command contributions require commands');
  }
  if (
    isRecord(value.contributes) &&
    Array.isArray(value.contributes.views) &&
    0 < value.contributes.views.length &&
    (!Array.isArray(value.permissions) || !value.permissions.includes('ui.views'))
  ) {
    errors.push('view contributions require ui.views');
  }
  if (
    Array.isArray(value.permissions) &&
    value.permissions.includes('documents.editActive') &&
    !value.permissions.includes('documents.readActive')
  ) {
    errors.push('documents.editActive requires documents.readActive');
  }
  if (
    Array.isArray(value.permissions) &&
    value.permissions.includes('workspace.modifyMarkdown') &&
    !value.permissions.includes('workspace.readMarkdown')
  ) {
    errors.push('workspace.modifyMarkdown requires workspace.readMarkdown');
  }
  if (
    Array.isArray(value.permissions) &&
    value.permissions.includes('workspace.modifyText') &&
    !value.permissions.includes('workspace.readText')
  ) {
    errors.push('workspace.modifyText requires workspace.readText');
  }
  if (0 < errors.length) { return { ok: false, errors }; }
  return { ok: true, manifest: value as unknown as PluginManifestV1 };
}
