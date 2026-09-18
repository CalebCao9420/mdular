export interface StorageMigrationHost {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StorageMigrationComplete {
  readonly kind: 'complete';
  readonly importedKeys: readonly string[];
  readonly alreadyComplete: boolean;
}

export interface StorageMigrationFailed {
  readonly kind: 'failed';
  readonly reason: 'read' | 'write' | 'invalid-marker';
}

export type StorageMigrationResult = StorageMigrationComplete | StorageMigrationFailed;

export const V2_STORAGE_MIGRATION_MARKER_KEY = `${__APP_NAME__}:v2:migration:v1`;
export const V2_LEGACY_IMPORT_PREFIX = `${__APP_NAME__}:v2:legacy-import:v1:`;

/**
 * Persisted v0.0.5 preferences that have no versioned envelope. Values are copied into a
 * read-only import namespace for the future owning official plugin; the original keys remain
 * untouched so reinstalling v0.0.5 remains safe.
 */
export const V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS = Object.freeze([
  `${__APP_NAME__}:default-template`,
  `${__APP_NAME__}:read-mode`,
  `${__APP_NAME__}:outline-collapsed`,
  `${__APP_NAME__}:kanban-open`,
  `${__APP_NAME__}:ticket-layout`,
  `${__APP_NAME__}:kanban-filter`,
  `${__APP_NAME__}:kanban-filter-presets`,
] as const);

interface StoredMigrationMarker {
  readonly schemaVersion: 1;
  readonly migration: 'v0.0.5-to-v0.1.0';
  readonly status: 'complete';
  readonly importedKeys: readonly string[];
}

function parseCompleteMarker(encoded: string): StoredMigrationMarker | null {
  try {
    const value = JSON.parse(encoded) as unknown;
    if (!value || 'object' !== typeof value || Array.isArray(value)) { return null; }
    const marker = value as Record<string, unknown>;
    if (
      1 !== marker.schemaVersion ||
      'v0.0.5-to-v0.1.0' !== marker.migration ||
      'complete' !== marker.status ||
      !Array.isArray(marker.importedKeys) ||
      marker.importedKeys.some((key) => 'string' !== typeof key)
    ) { return null; }
    const importedKeys = marker.importedKeys as string[];
    if (
      new Set(importedKeys).size !== importedKeys.length ||
      importedKeys.some((key) => !V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS.includes(
        key as (typeof V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS)[number],
      ))
    ) { return null; }
    return {
      schemaVersion: 1,
      migration: 'v0.0.5-to-v0.1.0',
      status: 'complete',
      importedKeys: Object.freeze([...importedKeys]),
    };
  } catch {
    return null;
  }
}

function importedStorageKey(sourceKey: string): string {
  return `${V2_LEGACY_IMPORT_PREFIX}${encodeURIComponent(sourceKey)}`;
}

/**
 * Idempotently copies known unversioned preferences, then writes the completion marker last.
 * A partial run is safe to retry. It never removes or rewrites a v0.0.5 key.
 */
export function migrateV0_0_5LocalStorage(
  storage: StorageMigrationHost,
): StorageMigrationResult {
  let marker: string | null;
  try {
    marker = storage.getItem(V2_STORAGE_MIGRATION_MARKER_KEY);
  } catch {
    return { kind: 'failed', reason: 'read' };
  }
  if (null !== marker) {
    const parsed = parseCompleteMarker(marker);
    return parsed
      ? {
          kind: 'complete',
          importedKeys: parsed.importedKeys,
          alreadyComplete: true,
        }
      : { kind: 'failed', reason: 'invalid-marker' };
  }

  const importedKeys: string[] = [];
  try {
    for (const sourceKey of V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS) {
      const value = storage.getItem(sourceKey);
      if (null === value) { continue; }
      storage.setItem(importedStorageKey(sourceKey), JSON.stringify({
        schemaVersion: 1,
        sourceKey,
        value,
      }));
      importedKeys.push(sourceKey);
    }
  } catch {
    return { kind: 'failed', reason: 'write' };
  }

  const completion: StoredMigrationMarker = {
    schemaVersion: 1,
    migration: 'v0.0.5-to-v0.1.0',
    status: 'complete',
    importedKeys,
  };
  try {
    storage.setItem(V2_STORAGE_MIGRATION_MARKER_KEY, JSON.stringify(completion));
  } catch {
    return { kind: 'failed', reason: 'write' };
  }
  return {
    kind: 'complete',
    importedKeys: Object.freeze([...importedKeys]),
    alreadyComplete: false,
  };
}
