import type {
  PluginBoardColumn,
  PluginBoardItem,
  PluginBoardViewState,
  PluginCollectionItem,
  PluginCollectionItemAction,
  PluginCollectionViewState,
  PluginFormField,
  PluginManifestV1,
  PluginReaderBlock,
  PluginReaderViewState,
  PluginTextHighlight,
  PluginViewAction,
  PluginViewButton,
  PluginViewState,
  PluginViewService,
  PluginWorkspaceImage,
} from '@mdular/plugin-sdk';

import type { DesktopPluginFailureHandler } from './plugin-documents.js';
import type { WorkspaceImageLease, WorkspaceImageResolver } from './plugin-assets.js';

const MAX_ITEMS = 500;
const MAX_BOARD_COLUMNS = 64;
const MAX_BOARD_ITEMS = 2_000;
const MAX_BOARD_ITEM_FIELDS = 8;
const MAX_TEXT = 4096;
const MAX_HIGHLIGHTS = 32;
const MAX_FIELDS = 16;
const MAX_FIELD_OPTIONS = 64;
const MAX_FIELD_VALUE = 64 * 1024;
const MAX_ACTIONS = 16;
const MAX_ITEM_ACTIONS = 16;
const MAX_READER_BLOCKS = 500;
const MAX_READER_OUTLINE = 256;
const MAX_READER_LIST_ITEMS = 128;
const MAX_READER_TEXT = 64 * 1024;
const MAX_READER_TOTAL_TEXT = 4 * 1024 * 1024;

interface OwnedView {
  readonly pluginId: string;
  readonly viewId: string;
  readonly key: string;
}

interface OwnedViewListener extends OwnedView {
  readonly listener: (action: PluginViewAction) => void | Promise<void>;
}

function boundedString(value: unknown, label: string, maximum = MAX_TEXT): string {
  if ('string' !== typeof value || maximum < value.length) {
    throw new Error(`${label} must be a string no longer than ${maximum} characters`);
  }
  return value;
}

function normalizeHighlights(
  value: readonly PluginTextHighlight[],
  text: string,
): readonly PluginTextHighlight[];
function normalizeHighlights(
  value: undefined,
  text: string,
): undefined;
function normalizeHighlights(
  value: readonly PluginTextHighlight[] | undefined,
  text: string,
): readonly PluginTextHighlight[] | undefined {
  if (undefined === value) { return undefined; }
  if (!Array.isArray(value) || MAX_HIGHLIGHTS < value.length) {
    throw new Error('Plugin view highlights are malformed or exceed the limit');
  }
  const normalized = value.map((range) => {
    if (
      !range ||
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.start >= range.end ||
      text.length < range.end
    ) { throw new Error('Plugin view highlight range is invalid'); }
    return { start: range.start, end: range.end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  if (normalized.some((range, index) => (
    0 < index && (normalized[index - 1]?.end ?? 0) > range.start
  ))) {
    throw new Error('Plugin view highlight ranges overlap');
  }
  return normalized;
}

function normalizeImage(value: PluginWorkspaceImage): PluginWorkspaceImage {
  const path = boundedString(value?.path, 'Plugin workspace image path', 1024);
  const segments = path.split('/');
  if (
    '' === path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    segments.some((segment) => '' === segment || '.' === segment || '..' === segment)
  ) { throw new Error('Plugin workspace image path is invalid'); }
  const alt = boundedString(value.alt, 'Plugin workspace image alt text', 1024);
  if (
    undefined !== value.presentation &&
    !['cover', 'thumbnail', 'content'].includes(value.presentation)
  ) { throw new Error('Plugin workspace image presentation is invalid'); }
  for (const coordinate of [value.focusX, value.focusY]) {
    if (undefined !== coordinate && (
      'number' !== typeof coordinate || !Number.isFinite(coordinate) ||
      coordinate < 0 || 100 < coordinate
    )) { throw new Error('Plugin workspace image focus is invalid'); }
  }
  return {
    path: segments.join('/'),
    alt,
    ...(value.presentation ? { presentation: value.presentation } : {}),
    ...(undefined === value.focusX ? {} : { focusX: value.focusX }),
    ...(undefined === value.focusY ? {} : { focusY: value.focusY }),
  };
}

function normalizeItem(value: PluginCollectionItem): PluginCollectionItem {
  const id = boundedString(value?.id, 'Plugin view item ID', 512);
  if ('' === id) { throw new Error('Plugin view item ID must not be empty'); }
  const title = boundedString(value.title, 'Plugin view item title');
  const description = undefined === value.description
    ? undefined
    : boundedString(value.description, 'Plugin view item description');
  const badges = undefined === value.badges
    ? undefined
    : Array.isArray(value.badges)
      ? value.badges.map((badge) => boundedString(badge, 'Plugin view badge', 128))
      : (() => { throw new Error('Plugin view item badges are malformed'); })();
  if (badges && 16 < badges.length) { throw new Error('Plugin view item has too many badges'); }
  const actions = undefined === value.actions
    ? undefined
    : Array.isArray(value.actions)
      ? value.actions.map((action) => normalizeItemAction(action))
      : (() => { throw new Error('Plugin view item actions are malformed'); })();
  if (actions && (
    MAX_ITEM_ACTIONS < actions.length ||
    new Set(actions.map((action) => action.id)).size !== actions.length
  )) { throw new Error('Plugin view item actions are duplicated or exceed the limit'); }
  if (undefined !== value.appearance && !['default', 'completed'].includes(value.appearance)) {
    throw new Error('Plugin view item appearance is invalid');
  }
  return {
    id,
    title,
    ...(undefined === description ? {} : { description }),
    ...(undefined === badges ? {} : { badges }),
    ...(true === value.selected ? { selected: true } : {}),
    ...(value.appearance ? { appearance: value.appearance } : {}),
    ...(undefined === actions ? {} : { actions }),
    ...(undefined === value.image ? {} : { image: normalizeImage(value.image) }),
    ...(undefined === value.titleHighlights
      ? {}
      : { titleHighlights: normalizeHighlights(value.titleHighlights, title) }),
    ...(undefined === value.descriptionHighlights || undefined === description
      ? {}
      : { descriptionHighlights: normalizeHighlights(value.descriptionHighlights, description) }),
  };
}

function normalizeItemAction(value: PluginCollectionItemAction): PluginCollectionItemAction {
  return normalizeAction(value);
}

function normalizeField(value: PluginFormField): PluginFormField {
  const id = boundedString(value?.id, 'Plugin view field ID', 128);
  if ('' === id) { throw new Error('Plugin view field ID must not be empty'); }
  const label = boundedString(value.label, 'Plugin view field label', 256);
  const fieldValue = boundedString(value.value, 'Plugin view field value', MAX_FIELD_VALUE);
  const description = undefined === value.description
    ? undefined
    : boundedString(value.description, 'Plugin view field description', 512);
  if ('select' === value.kind) {
    if (!Array.isArray(value.options) || 0 === value.options.length ||
        MAX_FIELD_OPTIONS < value.options.length) {
      throw new Error('Plugin view select options are malformed or exceed the limit');
    }
    const options = value.options.map((option) => ({
      value: boundedString(option?.value, 'Plugin view select option value', 512),
      label: boundedString(option?.label, 'Plugin view select option label', 256),
    }));
    if (new Set(options.map((option) => option.value)).size !== options.length) {
      throw new Error('Plugin view select option values must be unique');
    }
    if (!options.some((option) => option.value === fieldValue)) {
      throw new Error('Plugin view select value must match an option');
    }
    return {
      id,
      kind: 'select',
      label,
      value: fieldValue,
      options,
      ...(undefined === description ? {} : { description }),
      ...(true === value.readOnly ? { readOnly: true } : {}),
    };
  }
  if ('text' !== value.kind && 'textarea' !== value.kind) {
    throw new Error('Plugin view field kind is unsupported');
  }
  const placeholder = undefined === value.placeholder
    ? undefined
    : boundedString(value.placeholder, 'Plugin view field placeholder', 256);
  const rows = undefined === value.rows ? undefined : value.rows;
  if (undefined !== rows && (
    'textarea' !== value.kind || !Number.isSafeInteger(rows) || rows < 2 || 24 < rows
  )) { throw new Error('Plugin view field rows are invalid'); }
  return {
    id,
    kind: value.kind,
    label,
    value: fieldValue,
    ...(undefined === placeholder ? {} : { placeholder }),
    ...(undefined === description ? {} : { description }),
    ...(undefined === rows ? {} : { rows }),
    ...(true === value.readOnly ? { readOnly: true } : {}),
    ...(undefined === value.submitActionId
      ? {}
      : { submitActionId: boundedString(
          value.submitActionId,
          'Plugin view field submit action ID',
          128,
        ) }),
  };
}

function normalizeAction(value: PluginViewButton): PluginViewButton {
  const id = boundedString(value?.id, 'Plugin view action ID', 128);
  if ('' === id) { throw new Error('Plugin view action ID must not be empty'); }
  const label = boundedString(value.label, 'Plugin view action label', 256);
  if (undefined !== value.tone && !['neutral', 'primary', 'danger'].includes(value.tone)) {
    throw new Error('Plugin view action tone is invalid');
  }
  return {
    id,
    label,
    ...(value.tone ? { tone: value.tone } : {}),
    ...(true === value.disabled ? { disabled: true } : {}),
  };
}

function normalizeActions(
  value: readonly PluginViewButton[] | undefined,
): readonly PluginViewButton[] | undefined {
  const actions = undefined === value
    ? undefined
    : Array.isArray(value)
      ? value.map(normalizeAction)
      : (() => { throw new Error('Plugin view actions are malformed'); })();
  if (actions && (
    MAX_ACTIONS < actions.length || new Set(actions.map((action) => action.id)).size !== actions.length
  )) { throw new Error('Plugin view actions are duplicated or exceed the limit'); }
  return actions;
}

function normalizeFields(
  value: readonly PluginFormField[] | undefined,
  maximum = MAX_FIELDS,
): readonly PluginFormField[] | undefined {
  const fields = undefined === value
    ? undefined
    : Array.isArray(value)
      ? value.map(normalizeField)
      : (() => { throw new Error('Plugin view fields are malformed'); })();
  if (fields && (
    maximum < fields.length || new Set(fields.map((field) => field.id)).size !== fields.length
  )) { throw new Error('Plugin view fields are duplicated or exceed the limit'); }
  return fields;
}

function normalizeCollectionState(value: PluginCollectionViewState): PluginCollectionViewState {
  if (
    !value ||
    1 !== value.schemaVersion ||
    'collection' !== value.kind ||
    !Array.isArray(value.items) ||
    MAX_ITEMS < value.items.length
  ) { throw new Error('Plugin collection view state is malformed or exceeds the item limit'); }
  const title = boundedString(value.title, 'Plugin view title', 256);
  const input = undefined === value.input
    ? undefined
    : {
        value: boundedString(value.input.value, 'Plugin view input', 2048),
        ...(undefined === value.input.placeholder
          ? {}
          : { placeholder: boundedString(value.input.placeholder, 'Plugin view placeholder', 256) }),
        ...(undefined === value.input.ariaLabel
          ? {}
          : { ariaLabel: boundedString(value.input.ariaLabel, 'Plugin view input label', 256) }),
      };
  const fields = normalizeFields(value.fields);
  const actions = normalizeActions(value.actions);
  return {
    schemaVersion: 1,
    kind: 'collection',
    title,
    ...(undefined === input ? {} : { input }),
    ...(undefined === fields ? {} : { fields }),
    ...(undefined === actions ? {} : { actions }),
    ...(undefined === value.status
      ? {}
      : { status: boundedString(value.status, 'Plugin view status', 512) }),
    ...(undefined === value.emptyMessage
      ? {}
      : { emptyMessage: boundedString(value.emptyMessage, 'Plugin view empty message', 512) }),
    ...(true === value.busy ? { busy: true } : {}),
    ...(true === value.dismissOnActivate ? { dismissOnActivate: true } : {}),
    items: value.items.map(normalizeItem),
  };
}

function normalizeBoardItem(value: PluginBoardItem): PluginBoardItem {
  const id = boundedString(value?.id, 'Plugin board item ID', 1024);
  if ('' === id) { throw new Error('Plugin board item ID must not be empty'); }
  const badges = undefined === value.badges
    ? undefined
    : Array.isArray(value.badges)
      ? value.badges.map((badge) => boundedString(badge, 'Plugin board badge', 128))
      : (() => { throw new Error('Plugin board item badges are malformed'); })();
  if (badges && 16 < badges.length) { throw new Error('Plugin board item has too many badges'); }
  const actions = undefined === value.actions
    ? undefined
    : Array.isArray(value.actions)
      ? value.actions.map(normalizeItemAction)
      : (() => { throw new Error('Plugin board item actions are malformed'); })();
  if (actions && (
    MAX_ITEM_ACTIONS < actions.length ||
    new Set(actions.map((action) => action.id)).size !== actions.length
  )) { throw new Error('Plugin board item actions are duplicated or exceed the limit'); }
  if (undefined !== value.appearance && !['default', 'completed'].includes(value.appearance)) {
    throw new Error('Plugin board item appearance is invalid');
  }
  return {
    id,
    title: boundedString(value.title, 'Plugin board item title'),
    ...(undefined === value.description
      ? {}
      : { description: boundedString(value.description, 'Plugin board item description') }),
    ...(undefined === badges ? {} : { badges }),
    ...(value.appearance ? { appearance: value.appearance } : {}),
    ...(true === value.draggable ? { draggable: true } : {}),
    ...(undefined === value.fields
      ? {}
      : { fields: normalizeFields(value.fields, MAX_BOARD_ITEM_FIELDS)! }),
    ...(undefined === actions ? {} : { actions }),
  };
}

function normalizeBoardColumn(value: PluginBoardColumn): PluginBoardColumn {
  const id = boundedString(value?.id, 'Plugin board column ID', 512);
  if ('' === id || !Array.isArray(value.items)) {
    throw new Error('Plugin board column is malformed');
  }
  return {
    id,
    title: boundedString(value.title, 'Plugin board column title', 256),
    ...(true === value.locked ? { locked: true } : {}),
    items: value.items.map(normalizeBoardItem),
  };
}

function normalizeBoardState(value: PluginBoardViewState): PluginBoardViewState {
  if (
    !value || 1 !== value.schemaVersion || 'board' !== value.kind ||
    !Array.isArray(value.columns) || MAX_BOARD_COLUMNS < value.columns.length ||
    (undefined !== value.layout && !['board', 'list'].includes(value.layout))
  ) { throw new Error('Plugin board state is malformed or exceeds the column limit'); }
  const columns = value.columns.map(normalizeBoardColumn);
  const itemIds = columns.flatMap((column) => column.items.map((item) => item.id));
  if (
    MAX_BOARD_ITEMS < itemIds.length ||
    new Set(columns.map((column) => column.id)).size !== columns.length ||
    new Set(itemIds).size !== itemIds.length
  ) { throw new Error('Plugin board IDs are duplicated or exceed the item limit'); }
  const fields = normalizeFields(value.fields);
  const actions = normalizeActions(value.actions);
  return {
    schemaVersion: 1,
    kind: 'board',
    title: boundedString(value.title, 'Plugin board title', 256),
    layout: value.layout ?? 'board',
    ...(undefined === fields ? {} : { fields }),
    ...(undefined === actions ? {} : { actions }),
    ...(undefined === value.status
      ? {}
      : { status: boundedString(value.status, 'Plugin board status', 512) }),
    ...(true === value.busy ? { busy: true } : {}),
    ...(undefined === value.emptyMessage
      ? {}
      : { emptyMessage: boundedString(value.emptyMessage, 'Plugin board empty message', 512) }),
    columns,
  };
}

function normalizeReaderBlock(value: PluginReaderBlock): PluginReaderBlock {
  const id = boundedString(value?.id, 'Plugin reader block ID', 512);
  if ('' === id) { throw new Error('Plugin reader block ID must not be empty'); }
  if ('heading' === value.kind) {
    if (!Number.isSafeInteger(value.level) || value.level < 1 || 6 < value.level) {
      throw new Error('Plugin reader heading level is invalid');
    }
    return {
      id,
      kind: 'heading',
      level: value.level,
      text: boundedString(value.text, 'Plugin reader heading', MAX_TEXT),
    };
  }
  if ('list' === value.kind) {
    if (!Array.isArray(value.items) || MAX_READER_LIST_ITEMS < value.items.length) {
      throw new Error('Plugin reader list is malformed or exceeds the limit');
    }
    return {
      id,
      kind: 'list',
      items: value.items.map((item) => boundedString(item, 'Plugin reader list item', MAX_TEXT)),
      ...(true === value.ordered ? { ordered: true } : {}),
    };
  }
  if ('image' === value.kind) {
    return {
      id,
      kind: 'image',
      image: normalizeImage(value.image),
      ...(undefined === value.caption
        ? {}
        : { caption: boundedString(value.caption, 'Plugin reader image caption', 1024) }),
    };
  }
  if (!['paragraph', 'quote', 'code', 'nested'].includes(value.kind)) {
    throw new Error('Plugin reader block kind is unsupported');
  }
  return {
    id,
    kind: value.kind,
    text: boundedString(value.text, 'Plugin reader block text', MAX_READER_TEXT),
    ...('code' === value.kind && undefined !== value.language
      ? { language: boundedString(value.language, 'Plugin reader code language', 64) }
      : {}),
  };
}

function normalizeReaderState(value: PluginReaderViewState): PluginReaderViewState {
  if (
    !Array.isArray(value.outline) || MAX_READER_OUTLINE < value.outline.length ||
    !Array.isArray(value.blocks) || MAX_READER_BLOCKS < value.blocks.length
  ) { throw new Error('Plugin reader state is malformed or exceeds the limit'); }
  const title = boundedString(value.title, 'Plugin reader title', 256);
  const status = undefined === value.status
    ? undefined
    : boundedString(value.status, 'Plugin reader status', 512);
  const sourcePath = boundedString(value.sourcePath, 'Plugin reader source path', 1024);
  const sourceSegments = sourcePath.split('/');
  if (
    '' === sourcePath || sourcePath.startsWith('/') || sourcePath.includes('\\') ||
    sourceSegments.some((segment) => '' === segment || '.' === segment || '..' === segment) ||
    !sourcePath.toLocaleLowerCase('en-US').endsWith('.md')
  ) { throw new Error('Plugin reader source path is invalid'); }
  const outline = value.outline.map((item) => {
    const id = boundedString(item?.id, 'Plugin reader outline ID', 512);
    if (
      '' === id || !Number.isSafeInteger(item.level) || item.level < 1 || 6 < item.level
    ) { throw new Error('Plugin reader outline item is invalid'); }
    return {
      id,
      label: boundedString(item.label, 'Plugin reader outline label', MAX_TEXT),
      level: item.level,
    };
  });
  const blocks = value.blocks.map(normalizeReaderBlock);
  const totalText = new TextEncoder().encode([
    title,
    status ?? '',
    ...outline.map((item) => item.label),
    ...blocks.flatMap((block) => {
      if ('heading' === block.kind || 'paragraph' === block.kind || 'quote' === block.kind ||
          'code' === block.kind || 'nested' === block.kind) { return [block.text]; }
      if ('list' === block.kind) { return block.items; }
      if ('image' === block.kind) { return [block.image.alt, block.caption ?? '']; }
      return [];
    }),
  ].join('\n')).byteLength;
  if (MAX_READER_TOTAL_TEXT < totalText) {
    throw new Error('Plugin reader text exceeds the total limit');
  }
  if (
    new Set(outline.map((item) => item.id)).size !== outline.length ||
    new Set(blocks.map((block) => block.id)).size !== blocks.length ||
    outline.some((item) => !blocks.some((block) => block.id === item.id && 'heading' === block.kind))
  ) { throw new Error('Plugin reader IDs are duplicated or the outline is inconsistent'); }
  return {
    schemaVersion: 1,
    kind: 'reader',
    title,
    sourcePath: sourceSegments.join('/'),
    ...(undefined === status ? {} : { status }),
    ...(undefined === value.cover ? {} : { cover: normalizeImage(value.cover) }),
    outline,
    blocks,
    ...(undefined === value.actions ? {} : { actions: normalizeActions(value.actions)! }),
  };
}

function normalizeState(value: PluginViewState): PluginViewState {
  if (!value || 1 !== value.schemaVersion) { throw new Error('Plugin view state is malformed'); }
  if ('board' === value.kind) { return normalizeBoardState(value); }
  if ('collection' === value.kind) { return normalizeCollectionState(value); }
  if ('reader' === value.kind) { return normalizeReaderState(value); }
  throw new Error('Plugin view kind is unsupported');
}

function viewKey(pluginId: string, viewId: string): string {
  return `${pluginId}\u0000${viewId}`;
}

export class DesktopPluginViewHost {
  readonly #document: Document;
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #imageResolver: WorkspaceImageResolver | undefined;
  readonly #states = new Map<string, PluginViewState>();
  readonly #owners = new Map<string, OwnedView>();
  readonly #listeners = new Map<string, Set<OwnedViewListener>>();
  readonly #imageLeases = new Set<WorkspaceImageLease>();
  readonly #readerBlocks = new Map<string, HTMLElement>();
  readonly #overlay: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #title: HTMLHeadingElement;
  readonly #input: HTMLInputElement;
  readonly #fields: HTMLDivElement;
  readonly #actions: HTMLDivElement;
  readonly #status: HTMLParagraphElement;
  readonly #list: HTMLUListElement;
  readonly #board: HTMLDivElement;
  readonly #reader: HTMLDivElement;
  readonly #readerOutline: HTMLElement;
  readonly #readerArticle: HTMLElement;
  readonly #lightbox: HTMLElement;
  readonly #lightboxImage: HTMLImageElement;
  readonly #lightboxCaption: HTMLElement;
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (this.#overlay.hidden) { return; }
    if ('Escape' === event.key) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.#lightbox.hidden) {
        this.#closeLightbox();
        return;
      }
      this.hideCurrent(true);
      return;
    }
    const state = this.#currentKey ? this.#states.get(this.#currentKey) : undefined;
    const target = event.target as HTMLElement | null;
    if (target?.dataset.pluginFieldId) { return; }
    if (!state || 'collection' !== state.kind || 0 === state.items.length) { return; }
    if ('ArrowDown' === event.key || 'ArrowUp' === event.key) {
      event.preventDefault();
      const delta = 'ArrowDown' === event.key ? 1 : -1;
      this.#selectedIndex = (
        this.#selectedIndex + delta + state.items.length
      ) % state.items.length;
      this.#syncSelection();
      return;
    }
    if ('Enter' === event.key) {
      event.preventDefault();
      const item = state.items[this.#selectedIndex];
      if (item) { this.#activateItem(item.id, state); }
    }
  };
  #currentKey: string | null = null;
  #selectedIndex = 0;
  #renderGeneration = 0;
  #dragItemId: string | null = null;
  #lightboxReturnFocus: HTMLElement | null = null;
  #disposed = false;

  public constructor(options: {
    readonly document: Document;
    readonly container: HTMLElement;
    readonly onFailure: DesktopPluginFailureHandler;
    readonly imageResolver?: WorkspaceImageResolver;
  }) {
    this.#document = options.document;
    this.#onFailure = options.onFailure;
    this.#imageResolver = options.imageResolver;
    this.#overlay = this.#document.createElement('section');
    this.#overlay.id = 'v2-plugin-view-overlay';
    this.#overlay.className = 'v2-plugin-view-overlay';
    this.#overlay.hidden = true;
    this.#overlay.setAttribute('role', 'dialog');
    this.#overlay.setAttribute('aria-modal', 'true');
    this.#panel = this.#document.createElement('div');
    this.#panel.className = 'v2-plugin-view-panel';
    this.#panel.tabIndex = -1;
    const header = this.#document.createElement('header');
    header.className = 'v2-plugin-view-header';
    this.#title = this.#document.createElement('h2');
    const close = this.#document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close plugin view');
    close.addEventListener('click', () => this.hideCurrent(true));
    header.append(this.#title, close);
    this.#input = this.#document.createElement('input');
    this.#input.className = 'v2-plugin-view-input';
    this.#input.type = 'search';
    this.#input.autocomplete = 'off';
    this.#input.addEventListener('input', () => {
      this.#dispatch({ type: 'input', payload: { value: this.#input.value } });
    });
    this.#fields = this.#document.createElement('div');
    this.#fields.className = 'v2-plugin-view-fields';
    this.#status = this.#document.createElement('p');
    this.#status.className = 'v2-plugin-view-status';
    this.#status.setAttribute('role', 'status');
    this.#list = this.#document.createElement('ul');
    this.#list.className = 'v2-plugin-view-list';
    this.#board = this.#document.createElement('div');
    this.#board.className = 'v2-plugin-board';
    this.#board.hidden = true;
    this.#reader = this.#document.createElement('div');
    this.#reader.className = 'v2-plugin-reader';
    this.#reader.hidden = true;
    this.#readerOutline = this.#document.createElement('nav');
    this.#readerOutline.className = 'v2-plugin-reader-outline';
    this.#readerOutline.setAttribute('aria-label', 'Document outline');
    this.#readerArticle = this.#document.createElement('article');
    this.#readerArticle.className = 'v2-plugin-reader-article';
    this.#reader.append(this.#readerOutline, this.#readerArticle);
    this.#actions = this.#document.createElement('div');
    this.#actions.className = 'v2-plugin-view-actions';
    this.#panel.append(
      header,
      this.#input,
      this.#fields,
      this.#status,
      this.#reader,
      this.#board,
      this.#list,
      this.#actions,
    );
    this.#overlay.append(this.#panel);
    this.#lightbox = this.#document.createElement('section');
    this.#lightbox.className = 'v2-plugin-image-lightbox';
    this.#lightbox.hidden = true;
    this.#lightbox.setAttribute('role', 'dialog');
    this.#lightbox.setAttribute('aria-modal', 'true');
    const lightboxClose = this.#document.createElement('button');
    lightboxClose.type = 'button';
    lightboxClose.className = 'v2-plugin-image-lightbox-close';
    lightboxClose.textContent = '×';
    lightboxClose.setAttribute('aria-label', 'Close image preview');
    lightboxClose.addEventListener('click', () => this.#closeLightbox());
    this.#lightboxImage = this.#document.createElement('img');
    this.#lightboxImage.className = 'v2-plugin-image-lightbox-image';
    this.#lightboxCaption = this.#document.createElement('p');
    this.#lightboxCaption.className = 'v2-plugin-image-lightbox-caption';
    this.#lightbox.append(lightboxClose, this.#lightboxImage, this.#lightboxCaption);
    this.#lightbox.addEventListener('click', (event) => {
      if (event.target === this.#lightbox) { this.#closeLightbox(); }
    });
    this.#overlay.append(this.#lightbox);
    this.#overlay.addEventListener('keydown', this.#onKeyDown);
    this.#overlay.addEventListener('click', (event) => {
      if (event.target === this.#overlay) { this.hideCurrent(true); }
    });
    options.container.append(this.#overlay);
  }

  public createService(manifest: PluginManifestV1): PluginViewService {
    const declared = new Set((manifest.contributes?.views ?? []).map((view) => view.id));
    const owned = (viewId: string): OwnedView => {
      if (!declared.has(viewId)) {
        throw new Error(`View is not declared by ${manifest.id}: ${viewId}`);
      }
      return { pluginId: manifest.id, viewId, key: viewKey(manifest.id, viewId) };
    };
    return {
      setState: (viewId, state) => {
        const entry = owned(viewId);
        this.#owners.set(entry.key, entry);
        this.#states.set(entry.key, normalizeState(state));
        if (entry.key === this.#currentKey) { this.#renderCurrent(); }
      },
      onAction: (viewId, listener) => {
        const entry = { ...owned(viewId), listener };
        const listeners = this.#listeners.get(entry.key) ?? new Set<OwnedViewListener>();
        listeners.add(entry);
        this.#listeners.set(entry.key, listeners);
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) { return; }
            disposed = true;
            listeners.delete(entry);
            if (0 === listeners.size) { this.#listeners.delete(entry.key); }
          },
        };
      },
      reveal: async (viewId) => {
        const entry = owned(viewId);
        if (!this.#states.has(entry.key)) {
          throw new Error(`Plugin view has no state: ${viewId}`);
        }
        this.#currentKey = entry.key;
        this.#selectedIndex = 0;
        this.#overlay.hidden = false;
        this.#renderCurrent();
        const state = this.#states.get(entry.key);
        if (state && 'collection' === state.kind && state.input) {
          this.#input.focus();
        } else {
          this.#panel.focus();
        }
      },
      revealReaderBlock: (viewId, blockId) => {
        const entry = owned(viewId);
        if (this.#currentKey !== entry.key) {
          throw new Error(`Plugin reader view is not visible: ${viewId}`);
        }
        const block = this.#readerBlocks.get(blockId);
        if (!block) { throw new Error(`Plugin reader block is unavailable: ${blockId}`); }
        block.scrollIntoView?.({ block: 'start' });
      },
      hide: (viewId) => {
        const entry = owned(viewId);
        if (this.#currentKey === entry.key) { this.hideCurrent(false); }
      },
    };
  }

  public releasePlugin(pluginId: string): void {
    for (const [key, owner] of [...this.#owners]) {
      if (owner.pluginId !== pluginId) { continue; }
      this.#owners.delete(key);
      this.#states.delete(key);
      this.#listeners.delete(key);
      if (this.#currentKey === key) { this.hideCurrent(false); }
    }
  }

  public viewCount(pluginId?: string): number {
    return [...this.#owners.values()]
      .filter((owner) => undefined === pluginId || owner.pluginId === pluginId).length;
  }

  public hideCurrent(emitDismiss: boolean): void {
    if (this.#overlay.hidden) { return; }
    if (emitDismiss) { this.#dispatch({ type: 'dismiss' }); }
    this.#overlay.hidden = true;
    this.#currentKey = null;
    this.#renderGeneration += 1;
    this.#dragItemId = null;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#list.replaceChildren();
    this.#board.replaceChildren();
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#states.clear();
    this.#owners.clear();
    this.#listeners.clear();
    this.#currentKey = null;
    this.#dragItemId = null;
    this.#renderGeneration += 1;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#overlay.removeEventListener('keydown', this.#onKeyDown);
    this.#overlay.remove();
  }

  #renderCurrent(): void {
    const state = this.#currentKey ? this.#states.get(this.#currentKey) : undefined;
    if (!state) { return; }
    this.#renderGeneration += 1;
    this.#dragItemId = null;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#title.textContent = state.title;
    if ('reader' === state.kind) {
      this.#renderReader(state);
      return;
    }
    if ('board' === state.kind) {
      this.#renderBoard(state);
      return;
    }
    this.#board.hidden = true;
    this.#board.replaceChildren();
    this.#reader.hidden = true;
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
    this.#readerBlocks.clear();
    this.#list.hidden = false;
    this.#input.hidden = !state.input;
    if (state.input) {
      this.#input.value = state.input.value;
      this.#input.placeholder = state.input.placeholder ?? '';
      this.#input.setAttribute('aria-label', state.input.ariaLabel ?? state.title);
    }
    this.#fields.replaceChildren(...(state.fields ?? []).map((field) => this.#renderField(field)));
    this.#fields.hidden = 0 === (state.fields?.length ?? 0);
    this.#status.textContent = state.status ?? (state.busy ? 'Loading…' : '');
    this.#status.hidden = '' === this.#status.textContent;
    const items = state.items.map((item, index) => this.#renderItem(item, index, state));
    if (0 === items.length && state.emptyMessage) {
      const empty = this.#document.createElement('li');
      empty.className = 'v2-plugin-view-empty';
      empty.textContent = state.emptyMessage;
      items.push(empty);
    }
    this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, state.items.length - 1));
    this.#list.replaceChildren(...items);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action)),
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
    this.#syncSelection();
  }

  #renderBoard(state: PluginBoardViewState): void {
    this.#input.hidden = true;
    this.#reader.hidden = true;
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
    this.#readerBlocks.clear();
    this.#list.hidden = true;
    this.#list.replaceChildren();
    this.#fields.replaceChildren(...(state.fields ?? []).map((field) => this.#renderField(field)));
    this.#fields.hidden = 0 === (state.fields?.length ?? 0);
    this.#status.textContent = state.status ?? (state.busy ? 'Loading…' : '');
    this.#status.hidden = '' === this.#status.textContent;
    this.#board.hidden = false;
    this.#board.dataset.layout = state.layout ?? 'board';
    const columns = state.columns.map((column) => this.#renderBoardColumn(column));
    const itemCount = state.columns.reduce((total, column) => total + column.items.length, 0);
    if (0 === itemCount && state.emptyMessage) {
      const empty = this.#document.createElement('p');
      empty.className = 'v2-plugin-view-empty';
      empty.textContent = state.emptyMessage;
      columns.push(empty);
    }
    this.#board.replaceChildren(...columns);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action)),
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
  }

  #renderBoardColumn(column: PluginBoardColumn): HTMLElement {
    const section = this.#document.createElement('section');
    section.className = 'v2-plugin-board-column';
    section.dataset.columnId = column.id;
    section.dataset.locked = String(true === column.locked);
    const heading = this.#document.createElement('h3');
    heading.textContent = `${column.title} (${String(column.items.length)})`;
    const items = this.#document.createElement('div');
    items.className = 'v2-plugin-board-items';
    items.replaceChildren(...column.items.map((item) => this.#renderBoardItem(item)));
    if (!column.locked) {
      items.addEventListener('dragover', (rawEvent) => {
        if (!this.#dragItemId) { return; }
        const event = rawEvent as DragEvent;
        event.preventDefault();
        if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
        section.dataset.dragTarget = 'true';
      });
      items.addEventListener('dragleave', () => { delete section.dataset.dragTarget; });
      items.addEventListener('drop', (rawEvent) => {
        const event = rawEvent as DragEvent;
        event.preventDefault();
        delete section.dataset.dragTarget;
        const id = this.#dragItemId;
        this.#dragItemId = null;
        if (id) {
          this.#dispatch({ type: 'board-drop', payload: { id, columnId: column.id } });
        }
      });
    }
    section.append(heading, items);
    return section;
  }

  #renderBoardItem(item: PluginBoardItem): HTMLElement {
    const card = this.#document.createElement('article');
    card.className = 'v2-plugin-board-item';
    card.dataset.itemId = item.id;
    card.dataset.appearance = item.appearance ?? 'default';
    card.draggable = true === item.draggable;
    if (item.draggable) {
      card.addEventListener('dragstart', (rawEvent) => {
        this.#dragItemId = item.id;
        card.dataset.dragging = 'true';
        const transfer = (rawEvent as DragEvent).dataTransfer;
        if (transfer) {
          transfer.effectAllowed = 'move';
          transfer.setData('text/plain', item.id);
        }
      });
      card.addEventListener('dragend', () => {
        this.#dragItemId = null;
        delete card.dataset.dragging;
      });
    }
    const open = this.#document.createElement('button');
    open.type = 'button';
    open.className = 'v2-plugin-board-item-open';
    const title = this.#document.createElement('strong');
    title.textContent = item.title;
    open.append(title);
    if (item.description) {
      const description = this.#document.createElement('span');
      description.textContent = item.description;
      open.append(description);
    }
    open.addEventListener('click', () => {
      this.#dispatch({ type: 'activate', payload: { id: item.id } });
    });
    card.append(open);
    if (0 < (item.badges?.length ?? 0)) {
      const badges = this.#document.createElement('div');
      badges.className = 'v2-plugin-board-item-badges';
      for (const text of item.badges ?? []) {
        const badge = this.#document.createElement('span');
        badge.textContent = text;
        badges.append(badge);
      }
      card.append(badges);
    }
    if (0 < (item.fields?.length ?? 0)) {
      const fields = this.#document.createElement('div');
      fields.className = 'v2-plugin-board-item-fields';
      fields.replaceChildren(...(item.fields ?? []).map((field) =>
        this.#renderField(field, item.id)));
      card.append(fields);
    }
    if (0 < (item.actions?.length ?? 0)) {
      const actions = this.#document.createElement('div');
      actions.className = 'v2-plugin-view-item-actions';
      for (const action of item.actions ?? []) {
        const button = this.#document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.dataset.itemActionId = action.id;
        button.dataset.tone = action.tone ?? 'neutral';
        button.disabled = true === action.disabled;
        button.addEventListener('click', () => {
          this.#dispatch({
            type: 'item-command',
            payload: { id: item.id, actionId: action.id },
          });
        });
        actions.append(button);
      }
      card.append(actions);
    }
    return card;
  }

  #renderReader(state: PluginReaderViewState): void {
    this.#input.hidden = true;
    this.#fields.hidden = true;
    this.#fields.replaceChildren();
    this.#list.hidden = true;
    this.#list.replaceChildren();
    this.#board.hidden = true;
    this.#board.replaceChildren();
    this.#status.textContent = state.status ?? state.sourcePath;
    this.#status.hidden = '' === this.#status.textContent;
    this.#reader.hidden = false;
    this.#readerBlocks.clear();
    const outline = state.outline.map((item) => {
      const button = this.#document.createElement('button');
      button.type = 'button';
      button.className = 'v2-plugin-reader-outline-item';
      button.dataset.level = String(item.level);
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.#readerBlocks.get(item.id)?.scrollIntoView?.({ block: 'start' });
      });
      return button;
    });
    this.#readerOutline.replaceChildren(...outline);
    this.#readerOutline.hidden = 0 === outline.length;
    const articleChildren: HTMLElement[] = [];
    if (state.cover) {
      articleChildren.push(this.#renderImage(state.cover, state.title));
    }
    for (const block of state.blocks) {
      const element = this.#renderReaderBlock(block);
      this.#readerBlocks.set(block.id, element);
      articleChildren.push(element);
    }
    this.#readerArticle.replaceChildren(...articleChildren);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action)),
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
  }

  #renderReaderBlock(block: PluginReaderBlock): HTMLElement {
    let element: HTMLElement;
    if ('heading' === block.kind) {
      element = this.#document.createElement(`h${String(block.level)}`);
      element.textContent = block.text;
    } else if ('paragraph' === block.kind) {
      element = this.#document.createElement('p');
      element.textContent = block.text;
    } else if ('quote' === block.kind) {
      element = this.#document.createElement('blockquote');
      element.textContent = block.text;
    } else if ('code' === block.kind) {
      const pre = this.#document.createElement('pre');
      const code = this.#document.createElement('code');
      code.textContent = block.text;
      if (block.language) { code.dataset.language = block.language; }
      pre.append(code);
      element = pre;
    } else if ('nested' === block.kind) {
      element = this.#document.createElement('aside');
      element.className = 'v2-plugin-reader-nested';
      element.textContent = block.text;
    } else if ('list' === block.kind) {
      const list = this.#document.createElement(block.ordered ? 'ol' : 'ul');
      list.replaceChildren(...block.items.map((item) => {
        const entry = this.#document.createElement('li');
        entry.textContent = item;
        return entry;
      }));
      element = list;
    } else if ('image' === block.kind) {
      element = this.#renderImage(block.image, block.caption);
    } else {
      throw new Error('Plugin reader block kind is unsupported');
    }
    element.dataset.readerBlockId = block.id;
    return element;
  }

  #renderImage(image: PluginWorkspaceImage, caption?: string): HTMLElement {
    const generation = this.#renderGeneration;
    const figure = this.#document.createElement('figure');
    figure.className = 'v2-plugin-workspace-image';
    figure.dataset.presentation = image.presentation ?? 'content';
    figure.dataset.state = 'loading';
    const trigger = this.#document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'v2-plugin-workspace-image-trigger';
    trigger.disabled = true;
    const element = this.#document.createElement('img');
    element.alt = image.alt;
    element.loading = 'lazy';
    element.decoding = 'async';
    element.hidden = true;
    if (element.style) {
      element.style.objectPosition = `${String(image.focusX ?? 50)}% ${String(image.focusY ?? 50)}%`;
    }
    const placeholder = this.#document.createElement('span');
    placeholder.className = 'v2-plugin-workspace-image-placeholder';
    placeholder.textContent = 'Image unavailable';
    trigger.append(element, placeholder);
    figure.append(trigger);
    if (caption) {
      const figcaption = this.#document.createElement('figcaption');
      figcaption.textContent = caption;
      figure.append(figcaption);
    }
    if (!this.#imageResolver) {
      figure.dataset.state = 'unavailable';
      return figure;
    }
    void this.#imageResolver.acquire(image.path).then((lease) => {
      if (
        this.#disposed ||
        generation !== this.#renderGeneration ||
        this.#overlay.hidden
      ) {
        void lease.dispose();
        return;
      }
      this.#imageLeases.add(lease);
      element.src = lease.url;
      element.hidden = false;
      placeholder.hidden = true;
      trigger.disabled = false;
      figure.dataset.state = 'ready';
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        this.#openLightbox(lease.url, image, caption, trigger);
      });
    }).catch(() => {
      if (generation === this.#renderGeneration) { figure.dataset.state = 'unavailable'; }
    });
    return figure;
  }

  #openLightbox(
    url: string,
    image: PluginWorkspaceImage,
    caption: string | undefined,
    returnFocus: HTMLElement,
  ): void {
    this.#lightboxReturnFocus = returnFocus;
    this.#lightboxImage.src = url;
    this.#lightboxImage.alt = image.alt;
    if (this.#lightboxImage.style) {
      this.#lightboxImage.style.objectPosition =
        `${String(image.focusX ?? 50)}% ${String(image.focusY ?? 50)}%`;
    }
    this.#lightboxCaption.textContent = caption ?? image.alt;
    this.#lightboxCaption.hidden = '' === this.#lightboxCaption.textContent;
    this.#lightbox.hidden = false;
    (this.#lightbox.children[0] as HTMLElement | undefined)?.focus?.();
  }

  #closeLightbox(restoreFocus = true): void {
    const returnFocus = this.#lightboxReturnFocus;
    this.#lightboxReturnFocus = null;
    this.#lightbox.hidden = true;
    this.#lightboxImage.src = '';
    this.#lightboxImage.alt = '';
    this.#lightboxCaption.textContent = '';
    if (restoreFocus) { returnFocus?.focus?.(); }
  }

  #releaseImages(): void {
    for (const lease of this.#imageLeases) { void lease.dispose(); }
    this.#imageLeases.clear();
  }

  #renderField(field: PluginFormField, itemId?: string): HTMLDivElement {
    const wrapper = this.#document.createElement('div');
    wrapper.className = 'v2-plugin-view-field';
    const label = this.#document.createElement('label');
    label.textContent = field.label;
    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if ('textarea' === field.kind) {
      control = this.#document.createElement('textarea');
      control.rows = field.rows ?? 8;
      control.placeholder = field.placeholder ?? '';
    } else if ('select' === field.kind) {
      control = this.#document.createElement('select');
      control.replaceChildren(...field.options.map((option) => {
        const element = this.#document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        return element;
      }));
    } else {
      control = this.#document.createElement('input');
      control.type = 'text';
      control.placeholder = field.placeholder ?? '';
      control.autocomplete = 'off';
    }
    control.value = field.value;
    if ('select' === field.kind) {
      control.disabled = true === field.readOnly;
    } else {
      (control as HTMLInputElement | HTMLTextAreaElement).readOnly = true === field.readOnly;
    }
    control.dataset.pluginFieldId = field.id;
    control.setAttribute('aria-label', field.label);
    const eventName = 'select' === field.kind ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      this.#dispatch(undefined === itemId
        ? { type: 'field', payload: { id: field.id, value: control.value } }
        : {
            type: 'item-field',
            payload: { id: itemId, fieldId: field.id, value: control.value },
          });
    });
    if ('select' !== field.kind && field.submitActionId) {
      const submitActionId = field.submitActionId;
      control.addEventListener('keydown', (rawEvent) => {
        const event = rawEvent as KeyboardEvent;
        if ('Enter' !== event.key || event.shiftKey || event.isComposing) { return; }
        event.preventDefault();
        this.#dispatch({ type: 'command', payload: { id: submitActionId } });
      });
    }
    label.append(control);
    wrapper.append(label);
    if (field.description) {
      const description = this.#document.createElement('small');
      description.textContent = field.description;
      wrapper.append(description);
    }
    return wrapper;
  }

  #renderAction(action: PluginViewButton): HTMLButtonElement {
    const button = this.#document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.dataset.actionId = action.id;
    button.dataset.tone = action.tone ?? 'neutral';
    button.disabled = true === action.disabled;
    button.addEventListener('click', () => {
      this.#dispatch({ type: 'command', payload: { id: action.id } });
    });
    return button;
  }

  #renderItem(
    item: PluginCollectionItem,
    index: number,
    state: PluginCollectionViewState,
  ): HTMLLIElement {
    const row = this.#document.createElement('li');
    row.className = 'v2-plugin-view-item';
    row.dataset.index = String(index);
    row.dataset.pluginSelected = String(true === item.selected);
    row.dataset.appearance = item.appearance ?? 'default';
    if (item.image) { row.append(this.#renderImage(item.image, item.title)); }
    const button = this.#document.createElement('button');
    button.type = 'button';
    button.dataset.itemId = item.id;
    const title = this.#document.createElement('span');
    title.className = 'v2-plugin-view-item-title';
    this.#appendHighlighted(title, item.title, item.titleHighlights);
    button.append(title);
    if (item.description) {
      const description = this.#document.createElement('span');
      description.className = 'v2-plugin-view-item-description';
      this.#appendHighlighted(description, item.description, item.descriptionHighlights);
      button.append(description);
    }
    for (const badgeText of item.badges ?? []) {
      const badge = this.#document.createElement('span');
      badge.className = 'v2-plugin-view-item-badge';
      badge.textContent = badgeText;
      button.append(badge);
    }
    button.addEventListener('mouseenter', () => {
      this.#selectedIndex = index;
      this.#syncSelection();
    });
    button.addEventListener('click', () => this.#activateItem(item.id, state));
    row.append(button);
    if (0 < (item.actions?.length ?? 0)) {
      const actions = this.#document.createElement('div');
      actions.className = 'v2-plugin-view-item-actions';
      for (const action of item.actions ?? []) {
        const actionButton = this.#document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = action.label;
        actionButton.dataset.itemActionId = action.id;
        actionButton.dataset.tone = action.tone ?? 'neutral';
        actionButton.disabled = true === action.disabled;
        actionButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.#dispatch({
            type: 'item-command',
            payload: { id: item.id, actionId: action.id },
          });
        });
        actions.append(actionButton);
      }
      row.append(actions);
    }
    return row;
  }

  #appendHighlighted(
    container: HTMLElement,
    text: string,
    ranges: readonly PluginTextHighlight[] | undefined,
  ): void {
    let cursor = 0;
    for (const range of ranges ?? []) {
      if (cursor < range.start) {
        const plain = this.#document.createElement('span');
        plain.textContent = text.slice(cursor, range.start);
        container.append(plain);
      }
      const marked = this.#document.createElement('mark');
      marked.textContent = text.slice(range.start, range.end);
      container.append(marked);
      cursor = range.end;
    }
    if (cursor < text.length || 0 === container.children.length) {
      const plain = this.#document.createElement('span');
      plain.textContent = text.slice(cursor);
      container.append(plain);
    }
  }

  #activateItem(itemId: string, state: PluginCollectionViewState): void {
    this.#dispatch({ type: 'activate', payload: { id: itemId } });
    if (state.dismissOnActivate) { this.hideCurrent(false); }
  }

  #syncSelection(): void {
    const rows = [...this.#list.children] as HTMLElement[];
    rows.forEach((row, index) => {
      row.dataset.selected = String(index === this.#selectedIndex);
      if (index === this.#selectedIndex) { row.scrollIntoView?.({ block: 'nearest' }); }
    });
  }

  #dispatch(action: PluginViewAction): void {
    const currentKey = this.#currentKey;
    if (!currentKey) { return; }
    for (const owned of [...(this.#listeners.get(currentKey) ?? [])]) {
      try {
        void Promise.resolve(owned.listener(action)).catch((error: unknown) => {
          this.#onFailure(owned.pluginId, 'provider', error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, 'provider', error);
      }
    }
  }
}
