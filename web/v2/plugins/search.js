// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
var DOCUMENT_POLICY_EXTENSION_POINT = "mdular.documents.policy";
function isJsonObject(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function excludedDocumentPaths(extensions, capability) {
  const excluded = /* @__PURE__ */ new Set();
  for (const contribution of extensions.list(DOCUMENT_POLICY_EXTENSION_POINT)) {
    const data = contribution.data;
    if (!isJsonObject(data) || 1 !== data.schemaVersion || "exclude" !== data[capability] || !Array.isArray(data.paths) || 128 < data.paths.length) {
      continue;
    }
    for (const value of data.paths) {
      if ("string" !== typeof value || "" === value || 1024 < value.length || value.startsWith("/") || value.includes("\\") || !value.toLocaleLowerCase("en-US").endsWith(".md")) {
        continue;
      }
      const segments = value.split("/");
      if (segments.some((segment) => "" === segment || "." === segment || ".." === segment)) {
        continue;
      }
      excluded.add(value.toLocaleLowerCase("en-US"));
    }
  }
  return excluded;
}
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/search/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.search",
  name: "Search",
  version: "0.1.0",
  entry: "search.js",
  description: "Private, incremental full-text search for authorized Markdown documents.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "extensions.consume",
    "navigation.openMarkdown",
    "storage.workspace",
    "ui.views",
    "workspace.readMarkdown",
    "workspace.watchMarkdown"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.search.open",
        title: "Search",
        defaultKeybindings: [
          "Mod+K",
          "Mod+P"
        ]
      }
    ],
    views: [
      {
        id: "search-results",
        title: "Search",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/search/src/query.ts
var FRONTMATTER_FILTER_KEYS = /* @__PURE__ */ new Set([
  "status",
  "tags",
  "tag",
  "title",
  "date",
  "author",
  "category",
  "priority",
  "assignee"
]);
function normalizeFolder(raw) {
  const normalized = raw.trim().replace(/^\/+|\/+$/gu, "");
  return "" === normalized ? null : normalized;
}
function parseSearchQuery(raw, knownDirectories = /* @__PURE__ */ new Set()) {
  const input = raw.trim();
  if ("" === input) {
    return { text: "", folderPath: null, filters: {}, browseFolder: null };
  }
  if (input.endsWith("/") && !/\s/u.test(input)) {
    return {
      text: "",
      folderPath: null,
      filters: {},
      browseFolder: normalizeFolder(input)
    };
  }
  const filters = {};
  const textParts = [];
  let folderPath = null;
  for (const token of input.split(/\s+/u).filter(Boolean)) {
    const scope = token.match(/^(?:in|path):(.+)$/iu);
    if (scope?.[1]) {
      folderPath = normalizeFolder(scope[1]);
      continue;
    }
    const tag = token.match(/^#([^\s#]+)$/u);
    if (tag?.[1]) {
      filters.tags = tag[1].toLocaleLowerCase("en-US");
      continue;
    }
    const field = token.match(/^([a-z_.-]+):(.+)$/iu);
    if (field?.[1] && field[2] && FRONTMATTER_FILTER_KEYS.has(
      field[1].toLocaleLowerCase("en-US")
    )) {
      const key = "tag" === field[1].toLocaleLowerCase("en-US") ? "tags" : field[1].toLocaleLowerCase("en-US");
      filters[key] = field[2].toLocaleLowerCase("en-US");
      continue;
    }
    if (!folderPath && 0 === textParts.length && 0 === Object.keys(filters).length && token.includes("/")) {
      const separator = token.lastIndexOf("/");
      const directory = normalizeFolder(token.slice(0, separator));
      const filename = token.slice(separator + 1);
      if (directory && filename) {
        folderPath = directory;
        textParts.push(filename);
        continue;
      }
    }
    textParts.push(token);
  }
  if (2 === textParts.length && !folderPath && 0 === Object.keys(filters).length && knownDirectories.has(textParts[0] ?? "")) {
    folderPath = normalizeFolder(textParts.shift() ?? "");
  }
  return {
    text: textParts.join(" ").toLocaleLowerCase("en-US"),
    folderPath,
    filters,
    browseFolder: null
  };
}
function metadataMatches(metadata, filters) {
  for (const [key, wanted] of Object.entries(filters)) {
    const value = (metadata[key] ?? "").toLocaleLowerCase("en-US");
    if ("tags" === key) {
      const tags = value.replace(/^\[|\]$/gu, "").split(/[\s,]+/u).map((tag) => tag.replace(/^['"]|['"]$/gu, "")).filter(Boolean);
      if (!value.includes(wanted) && !tags.includes(wanted)) {
        return false;
      }
    } else if (!value.includes(wanted)) {
      return false;
    }
  }
  return true;
}

// plugins/official/search/src/indexer.ts
var SEARCH_INDEX_LIMITS = Object.freeze({
  maxDocuments: 1e4,
  maxDocumentBytes: 2 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxResults: 100,
  maxCacheBytes: 48 * 1024
});
var textEncoder = new TextEncoder();
function byteLength(value) {
  return textEncoder.encode(value).byteLength;
}
function basename(path) {
  return path.split("/").at(-1) ?? path;
}
function displayTitle(path) {
  const name = basename(path);
  return name.toLocaleLowerCase("en-US").endsWith(".md") ? name.slice(0, -3) : name;
}
function isCanonicalMarkdownPath(path) {
  if ("" === path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || !path.toLocaleLowerCase("en-US").endsWith(".md")) {
    return false;
  }
  const segments = path.split("/");
  return !segments.some((segment) => "" === segment || "." === segment || ".." === segment);
}
function unquote(value) {
  if (2 <= value.length && ('"' === value[0] && '"' === value.at(-1) || "'" === value[0] && "'" === value.at(-1))) {
    return value.slice(1, -1);
  }
  return value;
}
function parseSearchMetadata(content) {
  const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = normalized.replaceAll("\r\n", "\n").split("\n");
  if ("---" !== lines[0]) {
    return {};
  }
  const metadata = {};
  let activeListKey = null;
  let scannedCharacters = 4;
  for (let index = 1; index < Math.min(lines.length, 512); index += 1) {
    const line = lines[index] ?? "";
    scannedCharacters += line.length + 1;
    if (64 * 1024 < scannedCharacters) {
      return {};
    }
    if ("---" === line) {
      return metadata;
    }
    const listItem = line.match(/^\s+-\s*(.+)$/u);
    if (activeListKey && listItem?.[1]) {
      const item = unquote(listItem[1].trim());
      metadata[activeListKey] = `${metadata[activeListKey] ?? ""} ${item}`.trim();
      continue;
    }
    activeListKey = null;
    const field = line.match(/^([a-z_.-]+):\s*(.*)$/iu);
    if (!field?.[1] || void 0 === field[2]) {
      continue;
    }
    const key = "tag" === field[1].toLocaleLowerCase("en-US") ? "tags" : field[1].toLocaleLowerCase("en-US");
    const value = unquote(field[2].trim());
    metadata[key] = value;
    if ("" === value) {
      activeListKey = key;
    }
  }
  return {};
}
function levenshtein(left, right) {
  if (left === right) {
    return 0;
  }
  if (0 === left.length || 0 === right.length) {
    return left.length + right.length;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex + 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + (left[leftIndex] === right[rightIndex] ? 0 : 1)
      ));
    }
    previous = current;
  }
  return previous.at(-1) ?? Math.max(left.length, right.length);
}
function similarity(left, right) {
  const maximum = Math.max(left.length, right.length);
  return 0 === maximum ? 100 : (1 - levenshtein(left, right) / maximum) * 100;
}
function matchingRanges(text, terms) {
  const lower = text.toLocaleLowerCase("en-US");
  const ranges = [];
  for (const term of terms) {
    if ("" === term) {
      continue;
    }
    let start = lower.indexOf(term);
    while (-1 !== start && ranges.length < 32) {
      ranges.push({ start, end: start + term.length });
      start = lower.indexOf(term, start + term.length);
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
function bodySnippet(content, terms) {
  const lower = content.toLocaleLowerCase("en-US");
  let match = -1;
  for (const term of terms) {
    const candidate = lower.indexOf(term);
    if (-1 !== candidate && (-1 === match || candidate < match)) {
      match = candidate;
    }
  }
  if (-1 === match) {
    return null;
  }
  const lineStart = Math.max(content.lastIndexOf("\n", match - 1) + 1, match - 70);
  const newline = content.indexOf("\n", match);
  const lineEnd = Math.min(-1 === newline ? content.length : newline, lineStart + 240);
  const prefix = 0 < lineStart ? "\u2026" : "";
  const suffix = lineEnd < content.length ? "\u2026" : "";
  const text = `${prefix}${content.slice(lineStart, lineEnd).trim()}${suffix}`;
  return { text, highlights: matchingRanges(text, terms) };
}
function pathInFolder(path, folder) {
  return !folder || path.startsWith(`${folder}/`);
}
function directChild(path, folder) {
  if (!path.startsWith(`${folder}/`)) {
    return false;
  }
  return !path.slice(folder.length + 1).includes("/");
}
function scoreDocument(entry, text) {
  if ("" === text) {
    return 50;
  }
  const title = entry.title.toLocaleLowerCase("en-US");
  const path = entry.path.toLocaleLowerCase("en-US");
  const body = entry.content.toLocaleLowerCase("en-US");
  const terms = text.split(/\s+/u).filter(Boolean).slice(0, 16);
  let score = 0;
  for (const term of terms) {
    if (title === term) {
      score += 160;
      continue;
    }
    if (title.startsWith(term)) {
      score += 135;
      continue;
    }
    if (title.includes(term)) {
      score += 115;
      continue;
    }
    const fuzzy = 128 >= term.length && 256 >= title.length ? similarity(term, title) : 0;
    if (70 <= fuzzy) {
      score += fuzzy;
      continue;
    }
    if (path.includes(term)) {
      score += 90;
      continue;
    }
    if (body.includes(term)) {
      score += 60;
      continue;
    }
    return null;
  }
  const root = entry.path.split("/")[0]?.toLocaleLowerCase("en-US");
  if (["archive", "habits", "triggers"].includes(root ?? "")) {
    score -= 60;
  }
  return Math.round(score / Math.max(1, terms.length));
}
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
var SearchIndex = class _SearchIndex {
  #documents = /* @__PURE__ */ new Map();
  #totalBytes = 0;
  get size() {
    return this.#documents.size;
  }
  get totalBytes() {
    return this.#totalBytes;
  }
  clear() {
    this.#documents.clear();
    this.#totalBytes = 0;
  }
  remove(path) {
    const previous = this.#documents.get(path);
    if (!previous) {
      return;
    }
    this.#documents.delete(path);
    this.#totalBytes -= previous.bytes;
  }
  upsert(path, content) {
    this.remove(path);
    if (!isCanonicalMarkdownPath(path)) {
      return { indexed: false, reason: "invalid-path" };
    }
    const bytes = byteLength(path) + byteLength(content);
    if (SEARCH_INDEX_LIMITS.maxDocumentBytes < bytes) {
      return { indexed: false, reason: "document-size" };
    }
    if (SEARCH_INDEX_LIMITS.maxDocuments <= this.#documents.size) {
      return { indexed: false, reason: "document-limit" };
    }
    if (SEARCH_INDEX_LIMITS.maxTotalBytes < this.#totalBytes + bytes) {
      return { indexed: false, reason: "total-size" };
    }
    this.#documents.set(path, {
      path,
      title: displayTitle(path),
      content,
      metadata: parseSearchMetadata(content),
      bytes
    });
    this.#totalBytes += bytes;
    return { indexed: true };
  }
  directories() {
    const directories = /* @__PURE__ */ new Set();
    for (const path of this.#documents.keys()) {
      const parts = path.split("/");
      parts.pop();
      for (let index = 1; index <= parts.length; index += 1) {
        directories.add(parts.slice(0, index).join("/"));
      }
    }
    return directories;
  }
  search(raw) {
    const query = parseSearchQuery(raw.slice(0, 512), this.directories());
    const terms = query.text.split(/\s+/u).filter(Boolean).slice(0, 16);
    const results = [];
    for (const entry of this.#documents.values()) {
      if (query.browseFolder && !directChild(entry.path, query.browseFolder)) {
        continue;
      }
      if (!pathInFolder(entry.path, query.folderPath)) {
        continue;
      }
      if (!metadataMatches(entry.metadata, query.filters)) {
        continue;
      }
      const score = query.browseFolder ? 100 : scoreDocument(entry, query.text);
      if (null === score) {
        continue;
      }
      const snippet = bodySnippet(entry.content, terms);
      const description = snippet?.text ?? entry.path;
      const badges = Object.entries(query.filters).slice(0, 3).map(([key]) => `${key}: ${entry.metadata[key] ?? ""}`);
      results.push({
        path: entry.path,
        score: score + (0 < Object.keys(query.filters).length ? 10 : 0),
        title: entry.title,
        description,
        ...0 < terms.length && 0 < matchingRanges(entry.title, terms).length ? { titleHighlights: matchingRanges(entry.title, terms) } : {},
        ...snippet && 0 < snippet.highlights.length ? { descriptionHighlights: snippet.highlights } : 0 < terms.length && 0 < matchingRanges(description, terms).length ? { descriptionHighlights: matchingRanges(description, terms) } : {},
        ...0 < badges.length ? { badges } : {}
      });
    }
    return results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path)).slice(0, SEARCH_INDEX_LIMITS.maxResults);
  }
  exportCache() {
    const documents = [];
    let bytes = byteLength('{"documents":[]}');
    for (const entry of [...this.#documents.values()].sort((left, right) => left.path.localeCompare(right.path))) {
      const value = { path: entry.path, content: entry.content };
      const encodedBytes = byteLength(JSON.stringify(value)) + 1;
      if (SEARCH_INDEX_LIMITS.maxCacheBytes < bytes + encodedBytes) {
        break;
      }
      documents.push(value);
      bytes += encodedBytes;
    }
    return { documents, complete: documents.length === this.#documents.size };
  }
  importCache(value) {
    if (!isRecord(value) || !Array.isArray(value.documents)) {
      return false;
    }
    const restored = new _SearchIndex();
    for (const entry of value.documents) {
      if (!isRecord(entry) || "string" !== typeof entry.path || "string" !== typeof entry.content || !restored.upsert(entry.path, entry.content).indexed) {
        return false;
      }
    }
    this.clear();
    for (const entry of restored.#documents.values()) {
      this.#documents.set(entry.path, entry);
    }
    this.#totalBytes = restored.#totalBytes;
    return true;
  }
};

// plugins/official/search/src/index.ts
var COMMAND_ID = "mdular.search.open";
var VIEW_ID = "search-results";
var CACHE_KEY = "private-search-index";
var pluginManifest = definePluginManifest(plugin_default);
function isRecord2(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord2(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function isSearchablePath(path, excluded) {
  const normalized = path.toLocaleLowerCase("en-US");
  return normalized.endsWith(".md") && !excluded.has(normalized);
}
var SearchController = class {
  #context;
  #workspace;
  #storage;
  #views;
  #extensions;
  #index = new SearchIndex();
  #excludedPaths = /* @__PURE__ */ new Set();
  #query = "";
  #status = "Loading private index\u2026";
  #queue = Promise.resolve();
  #disposed = false;
  constructor(context, services) {
    this.#context = context;
    this.#workspace = services.workspace;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#extensions = services.extensions;
  }
  start() {
    this.#render();
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => {
      this.#handleAction(action);
    }));
    this.#context.subscriptions.add(this.#context.commands.register(COMMAND_ID, async () => {
      this.#render();
      await this.#views.reveal(VIEW_ID);
      return void 0;
    }));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      this.#enqueue(() => this.#applyWorkspaceChange(change));
    }));
    this.#context.subscriptions.add(this.#extensions.onDidChange(
      DOCUMENT_POLICY_EXTENSION_POINT,
      () => {
        this.#enqueue(async () => {
          this.#refreshDocumentPolicies();
          await this.#rebuild();
        });
      }
    ));
    this.#enqueue(async () => {
      await this.#restoreCache();
      this.#refreshDocumentPolicies();
      await this.#rebuild();
    });
  }
  #refreshDocumentPolicies() {
    this.#excludedPaths = excludedDocumentPaths(this.#extensions, "search");
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#index.clear();
    this.#views.hide(VIEW_ID);
  }
  #enqueue(task) {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) {
        await task();
      }
    }).catch((error) => {
      if (this.#disposed) {
        return;
      }
      this.#status = "Search index unavailable";
      this.#context.logger?.warn("Search index task failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      this.#render();
    });
  }
  #handleAction(action) {
    if ("input" === action.type) {
      const value = payloadString(action, "value");
      if (null === value) {
        throw new Error("Search input action is malformed");
      }
      this.#query = value;
      this.#render();
      return;
    }
    if ("activate" === action.type) {
      const path = payloadString(action, "id");
      if (!path) {
        throw new Error("Search activation action is malformed");
      }
      void this.#context.navigation.openMarkdown(path).catch((error) => {
        this.#context.logger?.warn("Unable to open Search result", {
          path,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }
  async #restoreCache() {
    const result = await this.#storage.get(CACHE_KEY);
    if (this.#disposed) {
      return;
    }
    if (!result.ok) {
      this.#context.logger?.warn("Private Search cache could not be read", {
        kind: result.error.kind,
        message: result.error.message
      });
      return;
    }
    if (!result.value) {
      return;
    }
    if (1 !== result.value.schemaVersion || !this.#index.importCache(result.value.value)) {
      this.#index.clear();
      await this.#storage.remove(CACHE_KEY);
      this.#context.logger?.warn("Private Search cache was corrupt and will be rebuilt");
      return;
    }
    this.#status = `${this.#index.size} cached document${1 === this.#index.size ? "" : "s"} \xB7 refreshing`;
    this.#render();
  }
  async #rebuild() {
    this.#status = "Rebuilding private Search index\u2026";
    this.#render();
    const next = new SearchIndex();
    const paths = (await this.#workspace.listMarkdown()).filter((path) => isSearchablePath(path, this.#excludedPaths)).sort((left, right) => left.localeCompare(right));
    for (const path of paths) {
      if (this.#disposed) {
        return;
      }
      try {
        const content = await this.#workspace.readMarkdown(path);
        if (this.#disposed) {
          return;
        }
        const result = next.upsert(path, content);
        if (!result.indexed) {
          this.#context.logger?.warn("Markdown document skipped by Search index budget", {
            path,
            reason: result.reason ?? "unknown"
          });
        }
      } catch (error) {
        this.#context.logger?.warn("Markdown document could not be indexed", {
          path,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (this.#disposed) {
      return;
    }
    this.#index = next;
    this.#status = `${next.size} indexed document${1 === next.size ? "" : "s"}`;
    await this.#persistCache();
    this.#render();
  }
  async #applyWorkspaceChange(change) {
    if ("reset" === change.kind) {
      await this.#rebuild();
      return;
    }
    if ("deleted" === change.kind || !isSearchablePath(change.path, this.#excludedPaths)) {
      this.#index.remove(change.path);
    } else {
      try {
        const content = await this.#workspace.readMarkdown(change.path);
        if (this.#disposed) {
          return;
        }
        const result = this.#index.upsert(change.path, content);
        if (!result.indexed) {
          this.#context.logger?.warn("Changed Markdown document exceeds Search index budget", {
            path: change.path,
            reason: result.reason ?? "unknown"
          });
        }
      } catch (error) {
        this.#index.remove(change.path);
        this.#context.logger?.warn("Changed Markdown document could not be indexed", {
          path: change.path,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.#status = `${this.#index.size} indexed document${1 === this.#index.size ? "" : "s"}`;
    await this.#persistCache();
    this.#render();
  }
  async #persistCache() {
    const result = await this.#storage.set(CACHE_KEY, {
      schemaVersion: 1,
      value: this.#index.exportCache()
    });
    if (!result.ok) {
      this.#context.logger?.warn("Private Search cache could not be persisted", {
        kind: result.error.kind,
        message: result.error.message
      });
    }
  }
  #render() {
    if (this.#disposed) {
      return;
    }
    const results = this.#index.search(this.#query);
    const items = results.map((result) => ({
      id: result.path,
      title: result.title,
      description: result.description,
      ...result.titleHighlights ? { titleHighlights: result.titleHighlights } : {},
      ...result.descriptionHighlights ? { descriptionHighlights: result.descriptionHighlights } : {},
      ...result.badges ? { badges: result.badges } : {}
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Search Markdown",
      input: {
        value: this.#query,
        placeholder: "filename, body, #tag, status:draft, in:docs",
        ariaLabel: "Search Markdown documents"
      },
      status: `${this.#status} \xB7 ${results.length} result${1 === results.length ? "" : "s"}`,
      emptyMessage: "" === this.#query ? "No Markdown documents indexed." : "No matches.",
      dismissOnActivate: true,
      items
    });
  }
};
var plugin = definePlugin({
  activate(context) {
    if (!context.commands) {
      throw new Error("Search requires commands");
    }
    if (!context.extensions) {
      throw new Error("Search requires extensions.consume");
    }
    if (!context.navigation) {
      throw new Error("Search requires navigation.openMarkdown");
    }
    if (!context.storage) {
      throw new Error("Search requires storage.workspace");
    }
    if (!context.views) {
      throw new Error("Search requires ui.views");
    }
    if (!context.workspace?.listMarkdown || !context.workspace.readMarkdown || !context.workspace.watchMarkdown) {
      throw new Error("Search requires workspace read and watch access");
    }
    const controller = new SearchController(context, {
      workspace: {
        listMarkdown: context.workspace.listMarkdown,
        readMarkdown: context.workspace.readMarkdown,
        watchMarkdown: context.workspace.watchMarkdown
      },
      storage: context.storage,
      views: context.views,
      extensions: context.extensions
    });
    controller.start();
    return controller;
  }
});
var index_default = plugin;
export {
  SEARCH_INDEX_LIMITS,
  SearchIndex,
  index_default as default,
  metadataMatches,
  parseSearchMetadata,
  parseSearchQuery,
  pluginManifest
};

export const pluginContentHash="sha256:4c4981510313f185ebc210db3ebad88772ae3b3f4caf906a1dd3963ef37eeb49";
