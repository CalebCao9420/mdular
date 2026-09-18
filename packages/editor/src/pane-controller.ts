import { SessionRegistry } from '@mdular/core';
import type {
  DocumentSession,
  DocumentSnapshot,
  WorkspaceAdapter,
} from '@mdular/core';

export type PaneId = 'primary' | 'secondary';
export type PaneOpenTarget = PaneId | 'active';

export interface PaneViewState {
  readonly selectionAnchor: number;
  readonly selectionHead: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly focused: boolean;
}

export interface PaneState {
  readonly id: PaneId;
  readonly session: DocumentSession | null;
  readonly view: PaneViewState;
}

export interface PaneControllerState {
  readonly activePane: PaneId;
  readonly secondaryAvailable: boolean;
  readonly secondaryVisible: boolean;
  readonly primary: PaneState;
  readonly secondary: PaneState;
}

export interface PaneLayoutPreference {
  readonly secondaryVisible: boolean;
  readonly activePane: PaneId;
}

export interface PaneOpenOptions {
  readonly target?: PaneOpenTarget;
}

export interface PaneOpenResult {
  readonly paneId: PaneId;
  readonly session: DocumentSession;
  readonly reusedSession: boolean;
  readonly fellBackToPrimary: boolean;
  readonly releasedSession: DocumentSession | null;
}

export interface PaneCloseResult {
  readonly session: DocumentSession;
  readonly released: boolean;
}

interface MutablePane {
  readonly id: PaneId;
  session: DocumentSession | null;
  view: PaneViewState;
}

const EMPTY_VIEW: PaneViewState = Object.freeze({
  selectionAnchor: 0,
  selectionHead: 0,
  scrollLeft: 0,
  scrollTop: 0,
  focused: false,
});

function copyView(view: PaneViewState): PaneViewState {
  return { ...view };
}

function validateView(view: PaneViewState): void {
  for (const [name, value] of Object.entries(view)) {
    if ('focused' === name) {
      if ('boolean' !== typeof value) { throw new Error('Pane focused state must be boolean'); }
      continue;
    }
    if ('number' !== typeof value || !Number.isFinite(value) || 0 > value) {
      throw new Error(`Pane ${name} must be a non-negative finite number`);
    }
  }
}

export class PaneController {
  readonly #registry: SessionRegistry;
  readonly #panes: Record<PaneId, MutablePane> = {
    primary: { id: 'primary', session: null, view: copyView(EMPTY_VIEW) },
    secondary: { id: 'secondary', session: null, view: copyView(EMPTY_VIEW) },
  };
  #activePane: PaneId = 'primary';
  #preferredActivePane: PaneId = 'primary';
  #secondaryAvailable = true;
  #secondaryRequested = false;

  public constructor(registry: SessionRegistry = new SessionRegistry()) {
    this.#registry = registry;
  }

  public get registry(): SessionRegistry {
    return this.#registry;
  }

  public get state(): PaneControllerState {
    return {
      activePane: this.#activePane,
      secondaryAvailable: this.#secondaryAvailable,
      secondaryVisible: this.#secondaryAvailable && this.#secondaryRequested,
      primary: this.#paneState('primary'),
      secondary: this.#paneState('secondary'),
    };
  }

  public open(
    snapshot: DocumentSnapshot,
    adapter: WorkspaceAdapter,
    options: PaneOpenOptions = {},
  ): PaneOpenResult {
    const requestedTarget = options.target ?? 'active';
    const resolvedTarget = 'active' === requestedTarget ? this.#activePane : requestedTarget;
    const fellBackToPrimary = 'secondary' === resolvedTarget && !this.#secondaryAvailable;
    const paneId: PaneId = fellBackToPrimary ? 'primary' : resolvedTarget;
    const existing = this.#registry.get(snapshot.pathKey);
    const session = this.#registry.open(snapshot, adapter);
    const releasedSession = this.#bind(paneId, session);
    if ('secondary' === paneId) { this.#secondaryRequested = true; }
    this.#activePane = paneId;
    this.#preferredActivePane = paneId;
    return {
      paneId,
      session,
      reusedSession: undefined !== existing,
      fellBackToPrimary,
      releasedSession,
    };
  }

  public activate(paneId: PaneId): void {
    if ('secondary' === paneId && !this.#secondaryAvailable) {
      throw new Error('Secondary pane is unavailable in the current layout');
    }
    if ('secondary' === paneId && !this.#secondaryRequested) {
      throw new Error('Secondary pane is not visible in the current layout');
    }
    this.#activePane = paneId;
    this.#preferredActivePane = paneId;
  }

  public setSecondaryAvailable(available: boolean): void {
    this.#secondaryAvailable = available;
    if (!available && 'secondary' === this.#activePane) {
      this.#activePane = 'primary';
    } else if (
      available &&
      this.#secondaryRequested &&
      'secondary' === this.#preferredActivePane
    ) {
      this.#activePane = 'secondary';
    }
  }

  public get layoutPreference(): PaneLayoutPreference {
    return {
      secondaryVisible: this.#secondaryRequested,
      activePane: this.#preferredActivePane,
    };
  }

  public restoreLayout(preference: PaneLayoutPreference): void {
    if (
      'boolean' !== typeof preference.secondaryVisible ||
      ('primary' !== preference.activePane && 'secondary' !== preference.activePane) ||
      (!preference.secondaryVisible && 'secondary' === preference.activePane)
    ) {
      throw new Error('Pane layout preference is malformed');
    }
    this.#secondaryRequested = preference.secondaryVisible;
    this.#preferredActivePane =
      preference.secondaryVisible ? preference.activePane : 'primary';
    this.#activePane =
      this.#secondaryAvailable &&
      this.#secondaryRequested &&
      'secondary' === this.#preferredActivePane
        ? 'secondary'
        : 'primary';
  }

  public updateView(paneId: PaneId, view: PaneViewState): void {
    validateView(view);
    this.#panes[paneId].view = copyView(view);
  }

  public closeSecondary(): PaneCloseResult | null {
    const session = this.#panes.secondary.session;
    if (session) {
      session.detachPane('secondary');
      this.#panes.secondary.session = null;
    }
    this.#panes.secondary.view = copyView(EMPTY_VIEW);
    this.#secondaryRequested = false;
    this.#activePane = 'primary';
    this.#preferredActivePane = 'primary';
    if (!session) { return null; }
    return {
      session,
      released: this.#registry.release(session.state.pathKey),
    };
  }

  public dispose(): void {
    for (const paneId of ['primary', 'secondary'] as const) {
      const pane = this.#panes[paneId];
      const session = pane.session;
      if (!session) { continue; }
      session.detachPane(paneId);
      pane.session = null;
      pane.view = copyView(EMPTY_VIEW);
      this.#registry.release(session.state.pathKey);
    }
    this.#activePane = 'primary';
    this.#preferredActivePane = 'primary';
    this.#secondaryRequested = false;
  }

  #paneState(paneId: PaneId): PaneState {
    const pane = this.#panes[paneId];
    return {
      id: pane.id,
      session: pane.session,
      view: copyView(pane.view),
    };
  }

  #bind(paneId: PaneId, session: DocumentSession): DocumentSession | null {
    const pane = this.#panes[paneId];
    const previous = pane.session;
    if (previous === session) { return null; }
    let releasedSession: DocumentSession | null = null;
    if (previous) {
      previous.detachPane(paneId);
      if (this.#registry.release(previous.state.pathKey)) { releasedSession = previous; }
    }
    pane.session = session;
    pane.view = copyView(EMPTY_VIEW);
    session.attachPane(paneId);
    return releasedSession;
  }
}
