import type {
  Disposable,
  PluginEditorExtension,
  PluginEditorFeature,
  PluginEditorService,
} from '@mdular/plugin-sdk';

export interface DesktopEditorExtensionTarget {
  setPluginFeatures(features: ReadonlySet<PluginEditorFeature>): void;
}

interface RegisteredEditorExtension {
  readonly pluginId: string;
  readonly extension: PluginEditorExtension;
}

const EDITOR_FEATURES: ReadonlySet<string> = new Set<PluginEditorFeature>([
  'code-languages',
  'emoji',
  'math',
  'media',
  'mermaid',
  'tables',
  'wiki-links',
]);

const MAX_EXTENSIONS = 32;
const MAX_FEATURES = EDITOR_FEATURES.size;

function validateExtension(
  pluginId: string,
  extension: PluginEditorExtension,
  allowMedia: boolean,
): PluginEditorExtension {
  if (
    !extension ||
    'object' !== typeof extension ||
    1 !== extension.schemaVersion ||
    'string' !== typeof extension.id ||
    !extension.id.startsWith(`${pluginId}.`) ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(extension.id) ||
    !Array.isArray(extension.features) ||
    0 === extension.features.length ||
    MAX_FEATURES < extension.features.length ||
    extension.features.some((feature) => !EDITOR_FEATURES.has(feature)) ||
    new Set(extension.features).size !== extension.features.length
  ) {
    throw new Error('Editor extension is malformed');
  }
  if (extension.features.includes('media') && !allowMedia) {
    throw new Error('Media editor extensions require workspace.writeMedia');
  }
  return Object.freeze({
    schemaVersion: 1,
    id: extension.id,
    features: Object.freeze([...extension.features]),
  });
}

/** Capability broker for declarative editor behavior; raw editor objects never cross the SDK. */
export class DesktopPluginEditorHost implements Disposable {
  readonly #extensions = new Map<string, RegisteredEditorExtension>();
  readonly #targets = new Set<DesktopEditorExtensionTarget>();
  #disposed = false;

  public createService(pluginId: string, allowMedia: boolean): PluginEditorService {
    return {
      registerExtension: (candidate) => {
        if (this.#disposed) { throw new Error('Plugin editor host is disposed'); }
        if (MAX_EXTENSIONS <= this.#extensions.size) {
          throw new Error('Editor extension limit reached');
        }
        const extension = validateExtension(pluginId, candidate, allowMedia);
        if (this.#extensions.has(extension.id)) {
          throw new Error(`Editor extension is already registered: ${extension.id}`);
        }
        const record = { pluginId, extension };
        this.#extensions.set(extension.id, record);
        this.#apply();
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) { return; }
            disposed = true;
            if (this.#extensions.get(extension.id) === record) {
              this.#extensions.delete(extension.id);
              this.#apply();
            }
          },
        };
      },
    };
  }

  public attach(target: DesktopEditorExtensionTarget): Disposable {
    if (this.#disposed) { throw new Error('Plugin editor host is disposed'); }
    this.#targets.add(target);
    target.setPluginFeatures(this.#activeFeatures());
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        if (this.#targets.delete(target)) { target.setPluginFeatures(new Set()); }
      },
    };
  }

  public releasePlugin(pluginId: string): void {
    let changed = false;
    for (const [id, record] of [...this.#extensions]) {
      if (record.pluginId === pluginId) {
        this.#extensions.delete(id);
        changed = true;
      }
    }
    if (changed) { this.#apply(); }
  }

  public extensionCount(pluginId?: string): number {
    return [...this.#extensions.values()]
      .filter((record) => undefined === pluginId || record.pluginId === pluginId).length;
  }

  public activeFeatures(): ReadonlySet<PluginEditorFeature> {
    return this.#activeFeatures();
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#extensions.clear();
    for (const target of this.#targets) { target.setPluginFeatures(new Set()); }
    this.#targets.clear();
  }

  #activeFeatures(): ReadonlySet<PluginEditorFeature> {
    const features = new Set<PluginEditorFeature>();
    for (const { extension } of this.#extensions.values()) {
      for (const feature of extension.features) { features.add(feature); }
    }
    return features;
  }

  #apply(): void {
    const features = this.#activeFeatures();
    for (const target of this.#targets) { target.setPluginFeatures(features); }
  }
}
