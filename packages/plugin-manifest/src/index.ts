export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type PluginActivationEvent =
  | 'onStartup'
  | `onCommand:${string}`
  | `onView:${string}`;

/** Capabilities are granted by the host; declaring one does not grant it automatically. */
export type PluginPermission =
  | 'commands'
  | 'ui.views'
  | 'workspace.readMarkdown'
  | 'workspace.writeMarkdown'
  | 'workspace.watchMarkdown';

export interface PluginCommandContribution {
  readonly id: string;
  readonly title: string;
}

export interface PluginViewContribution {
  readonly id: string;
  readonly title: string;
  readonly location: 'sidebar' | 'secondary-pane' | 'editor-pane';
}

export interface PluginContributions {
  readonly commands?: readonly PluginCommandContribution[];
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
