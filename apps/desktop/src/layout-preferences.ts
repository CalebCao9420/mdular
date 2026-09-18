import type { PaneLayoutPreference } from '@mdular/editor';

export const DESKTOP_LAYOUT_PREFERENCE_KEY = 'mdular:v2:desktop-layout:v1';

export interface DesktopLayoutPreferenceStore {
  load(): PaneLayoutPreference | null;
  save(preference: PaneLayoutPreference): void;
}

export interface LayoutPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredDesktopLayoutPreference {
  readonly schemaVersion: 1;
  readonly secondaryVisible: boolean;
  readonly activePane: 'primary' | 'secondary';
}

function decodePreference(value: string): PaneLayoutPreference | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (null === parsed || 'object' !== typeof parsed || Array.isArray(parsed)) { return null; }
  const record = parsed as Record<string, unknown>;
  if (
    1 !== record.schemaVersion ||
    'boolean' !== typeof record.secondaryVisible ||
    ('primary' !== record.activePane && 'secondary' !== record.activePane) ||
    (!record.secondaryVisible && 'secondary' === record.activePane)
  ) {
    return null;
  }
  return {
    secondaryVisible: record.secondaryVisible,
    activePane: record.secondaryVisible ? record.activePane : 'primary',
  };
}

export class LocalDesktopLayoutPreferenceStore implements DesktopLayoutPreferenceStore {
  readonly #storage: LayoutPreferenceStorage | null;

  public constructor(storage: LayoutPreferenceStorage | null) {
    this.#storage = storage;
  }

  public load(): PaneLayoutPreference | null {
    try {
      const value = this.#storage?.getItem(DESKTOP_LAYOUT_PREFERENCE_KEY);
      return value ? decodePreference(value) : null;
    } catch {
      return null;
    }
  }

  public save(preference: PaneLayoutPreference): void {
    const stored: StoredDesktopLayoutPreference = {
      schemaVersion: 1,
      secondaryVisible: preference.secondaryVisible,
      activePane: preference.secondaryVisible ? preference.activePane : 'primary',
    };
    try {
      this.#storage?.setItem(DESKTOP_LAYOUT_PREFERENCE_KEY, JSON.stringify(stored));
    } catch {
      // Layout persistence is optional. Storage denial must not block the editor.
    }
  }
}

export function createDesktopLayoutPreferenceStore(
  hostWindow: Window,
): DesktopLayoutPreferenceStore {
  try {
    return new LocalDesktopLayoutPreferenceStore(hostWindow.localStorage);
  } catch {
    return new LocalDesktopLayoutPreferenceStore(null);
  }
}
