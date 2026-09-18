import type {
  Disposable,
  DocumentHeaderProvider,
  DocumentHeaderViewModel,
  PluginDocumentSnapshot,
  PluginUiService,
} from '@mdular/plugin-sdk';

import type { PaneId } from '@mdular/editor';
import type { DesktopPluginFailureHandler } from './plugin-documents.js';

interface OwnedProvider {
  readonly key: string;
  readonly pluginId: string;
  readonly provider: DocumentHeaderProvider;
}

export interface DesktopDocumentHeaderHostOptions {
  readonly document: Document;
  readonly containers: Readonly<Record<PaneId, HTMLElement>>;
  readonly getSnapshot: (paneId: PaneId) => PluginDocumentSnapshot | null;
  readonly onFailure: DesktopPluginFailureHandler;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tagName);
  if (className) { result.className = className; }
  return result;
}

export class DesktopDocumentHeaderHost implements Disposable {
  readonly #document: Document;
  readonly #containers: Readonly<Record<PaneId, HTMLElement>>;
  readonly #getSnapshot: (paneId: PaneId) => PluginDocumentSnapshot | null;
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #providers = new Map<string, OwnedProvider>();
  readonly #generation: Record<PaneId, number> = { primary: 0, secondary: 0 };
  #disposed = false;

  public constructor(options: DesktopDocumentHeaderHostOptions) {
    this.#document = options.document;
    this.#containers = options.containers;
    this.#getSnapshot = options.getSnapshot;
    this.#onFailure = options.onFailure;
  }

  public createService(pluginId: string): PluginUiService {
    return {
      registerDocumentHeaderProvider: (provider) => this.#register(pluginId, provider),
    };
  }

  public renderAll(): void {
    if (this.#disposed) { return; }
    void this.#render('primary');
    void this.#render('secondary');
  }

  public providerCount(pluginId?: string): number {
    return [...this.#providers.values()]
      .filter((owned) => undefined === pluginId || owned.pluginId === pluginId).length;
  }

  public releasePlugin(pluginId: string): void {
    let changed = false;
    for (const [key, owned] of [...this.#providers]) {
      if (owned.pluginId !== pluginId) { continue; }
      this.#providers.delete(key);
      changed = true;
    }
    if (changed) { this.renderAll(); }
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#providers.clear();
    for (const paneId of ['primary', 'secondary'] as const) {
      this.#generation[paneId] += 1;
      this.#containers[paneId].replaceChildren();
      this.#containers[paneId].hidden = true;
    }
  }

  #register(pluginId: string, provider: DocumentHeaderProvider): Disposable {
    if (this.#disposed) { throw new Error('Document header host is disposed'); }
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(provider.id)) {
      throw new Error('Document header provider ID is invalid');
    }
    const key = `${pluginId}:${provider.id}`;
    if (this.#providers.has(key)) {
      throw new Error(`Document header provider is already registered: ${key}`);
    }
    const owned = { key, pluginId, provider };
    this.#providers.set(key, owned);
    this.renderAll();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        this.#providers.delete(key);
        this.renderAll();
      },
    };
  }

  async #render(paneId: PaneId): Promise<void> {
    const generation = ++this.#generation[paneId];
    const snapshot = this.#getSnapshot(paneId);
    const container = this.#containers[paneId];
    if (!snapshot) {
      container.replaceChildren();
      container.hidden = true;
      return;
    }
    const rendered: HTMLElement[] = [];
    for (const owned of [...this.#providers.values()]) {
      let viewModel: DocumentHeaderViewModel | null;
      try {
        viewModel = await owned.provider.provide(snapshot);
      } catch (error) {
        this.#providers.delete(owned.key);
        this.#onFailure(owned.pluginId, 'provider', error);
        continue;
      }
      if (this.#disposed || generation !== this.#generation[paneId]) { return; }
      if (!viewModel) { continue; }
      try {
        rendered.push(this.#renderContribution(owned, paneId, snapshot, viewModel));
      } catch (error) {
        this.#providers.delete(owned.key);
        this.#onFailure(owned.pluginId, 'render', error);
      }
    }
    if (this.#disposed || generation !== this.#generation[paneId]) { return; }
    container.replaceChildren(...rendered);
    container.hidden = 0 === rendered.length;
  }

  #renderContribution(
    owned: OwnedProvider,
    paneId: PaneId,
    snapshot: PluginDocumentSnapshot,
    viewModel: DocumentHeaderViewModel,
  ): HTMLElement {
    const contribution = element(this.#document, 'section', 'v2-document-contribution');
    contribution.dataset.pluginId = owned.pluginId;
    contribution.dataset.providerId = owned.provider.id;
    const summary = element(this.#document, 'button', 'v2-document-contribution-summary');
    summary.type = 'button';
    summary.setAttribute('aria-expanded', String(viewModel.expanded));
    const title = element(this.#document, 'span', 'v2-document-contribution-title');
    title.textContent = `${viewModel.title} · ${viewModel.summary}`;
    summary.append(title);
    for (const badge of viewModel.badges ?? []) {
      const badgeElement = element(this.#document, 'span', 'v2-document-contribution-badge');
      badgeElement.dataset.tone = badge.tone ?? 'neutral';
      badgeElement.textContent = badge.label;
      summary.append(badgeElement);
    }
    if (!viewModel.toggleAction || !owned.provider.onAction) {
      summary.disabled = true;
    } else {
      summary.addEventListener('click', () => {
        void this.#handleAction(
          owned,
          paneId,
          snapshot,
          viewModel.toggleAction as string,
        );
      });
    }
    contribution.append(summary);
    if (viewModel.expanded && 0 < (viewModel.fields?.length ?? 0)) {
      const fields = element(this.#document, 'dl', 'v2-document-contribution-fields');
      for (const field of viewModel.fields ?? []) {
        const key = element(this.#document, 'dt');
        key.textContent = field.key;
        const value = element(this.#document, 'dd');
        value.dataset.kind = field.kind;
        value.textContent = field.value ?? field.kind;
        fields.append(key, value);
      }
      contribution.append(fields);
    }
    return contribution;
  }

  async #handleAction(
    owned: OwnedProvider,
    paneId: PaneId,
    renderedSnapshot: PluginDocumentSnapshot,
    action: string,
  ): Promise<void> {
    const current = this.#getSnapshot(paneId);
    if (
      !current ||
      current.path !== renderedSnapshot.path ||
      current.bufferVersion !== renderedSnapshot.bufferVersion
    ) { return; }
    try {
      await owned.provider.onAction?.({ type: action }, current);
    } catch (error) {
      this.#providers.delete(owned.key);
      this.#onFailure(owned.pluginId, 'provider', error);
    }
    this.renderAll();
  }
}
