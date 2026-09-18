import type { BundledPluginCatalogEntry } from '@mdular/plugin-runtime';

interface GeneratedCatalogModule {
  readonly bundledPluginCatalog: readonly BundledPluginCatalogEntry[];
}

const GENERATED_CATALOG_SPECIFIER = './bundled-plugin-catalog.js';

/** The generated catalog owns literal, allowlisted dynamic imports for bundled plugin assets. */
export async function loadDesktopBundledPluginCatalog(): Promise<
  readonly BundledPluginCatalogEntry[]
> {
  const loaded = await import(GENERATED_CATALOG_SPECIFIER) as GeneratedCatalogModule;
  if (!Array.isArray(loaded.bundledPluginCatalog)) {
    throw new Error('Bundled plugin catalog is malformed');
  }
  return loaded.bundledPluginCatalog;
}
