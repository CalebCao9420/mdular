// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/vcs/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.vcs",
  name: "Version Control",
  version: "0.1.0",
  entry: "vcs.js",
  description: "Official bounded Git/SVN status, diff and external-client integration.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "documents.readActive",
    "process.vcs",
    "storage.workspace",
    "ui.views"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.vcs.open",
        title: "Version Control: Open",
        defaultKeybindings: ["Mod+Shift+G"]
      },
      {
        id: "mdular.vcs.refresh",
        title: "Version Control: Refresh"
      },
      {
        id: "mdular.vcs.open-external",
        title: "Version Control: Open External Client"
      }
    ],
    views: [
      {
        id: "vcs",
        title: "Version Control",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/vcs/src/model.ts
var VCS_LIMITS = Object.freeze({
  renderedStatusEntries: 500,
  renderedDiffBytes: 512 * 1024,
  diffBlockCharacters: 60 * 1024
});
function mergeVcsStatus(entries, documents) {
  const byPath = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!byPath.has(entry.path)) {
      byPath.set(entry.path, { path: entry.path, status: entry, unsaved: false });
    }
  }
  for (const openState of documents) {
    if (!openState.dirty) {
      continue;
    }
    const current = byPath.get(openState.path);
    byPath.set(openState.path, current ? { ...current, unsaved: true } : { path: openState.path, unsaved: true });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}
function visibleStatusCode(entry) {
  return entry.status.replaceAll(" ", "\xB7").replaceAll(".", "\xB7");
}
function boundedPrefix(text, maximumBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maximumBytes) {
    return { text, truncated: false };
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { text: text.slice(0, low), truncated: true };
}
function diffReaderBlocks(result) {
  const blocks = [];
  let remaining = VCS_LIMITS.renderedDiffBytes;
  let truncated = false;
  for (const section of result.sections) {
    if (0 >= remaining) {
      truncated = truncated || 0 < section.text.length;
      continue;
    }
    const bounded = boundedPrefix(section.text, remaining);
    remaining -= new TextEncoder().encode(bounded.text).byteLength;
    truncated = truncated || bounded.truncated || section.truncated;
    if ("" === bounded.text) {
      continue;
    }
    blocks.push({
      id: `section-${String(blocks.length)}`,
      kind: "heading",
      level: 2,
      text: "staged" === section.kind ? "Staged changes" : "Working tree changes"
    });
    for (let offset = 0; offset < bounded.text.length; offset += VCS_LIMITS.diffBlockCharacters) {
      blocks.push({
        id: `diff-${String(blocks.length)}`,
        kind: "code",
        language: "diff",
        text: bounded.text.slice(offset, offset + VCS_LIMITS.diffBlockCharacters)
      });
    }
  }
  return { blocks, truncated };
}

// plugins/official/vcs/src/controller.ts
var VIEW_ID = "vcs";
var CLIENT_KEY = "external-client";
var CLIENTS = [
  "default",
  "source-git",
  "tortoise-git",
  "explorer",
  "finder"
];
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function clientLabel(client) {
  switch (client) {
    case "source-git":
      return "SourceGit";
    case "tortoise-git":
      return "TortoiseGit";
    case "explorer":
      return "Explorer";
    case "finder":
      return "Finder";
    default:
      return "Platform default";
  }
}
var VcsController = class {
  #context;
  #documents;
  #storage;
  #vcs;
  #views;
  #pathByItem = /* @__PURE__ */ new Map();
  #snapshot = {
    kind: "none",
    entries: [],
    truncated: false
  };
  #selectedClient = "default";
  #selectedDiffPath = null;
  #status = "Detecting Git or SVN workspace\u2026";
  #busy = false;
  #disposed = false;
  #queue = Promise.resolve();
  constructor(context, services) {
    this.#context = context;
    this.#documents = services.documents;
    this.#storage = services.storage;
    this.#vcs = services.vcs;
    this.#views = services.views;
  }
  start() {
    this.#context.subscriptions.add(this.#context.commands.register(
      "mdular.vcs.open",
      () => {
        this.#enqueue(async () => {
          await this.#views.reveal(VIEW_ID);
          await this.#refresh();
        });
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#context.commands.register(
      "mdular.vcs.refresh",
      () => {
        this.#enqueue(() => this.#refresh());
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#context.commands.register(
      "mdular.vcs.open-external",
      () => {
        this.#enqueue(() => this.#openExternal());
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#views.onAction(
      VIEW_ID,
      (action) => this.#handleAction(action)
    ));
    const rerender = () => {
      this.#renderStatus();
    };
    this.#context.subscriptions.add(this.#documents.onDidOpen(rerender));
    this.#context.subscriptions.add(this.#documents.onDidChange(rerender));
    this.#context.subscriptions.add(this.#documents.onDidActivatePane(rerender));
    this.#context.subscriptions.add(this.#documents.onDidSave(() => {
      this.#enqueue(() => this.#refresh());
    }));
    this.#renderStatus();
    this.#enqueue(async () => {
      await this.#restoreClient();
      await this.#refresh();
    });
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#pathByItem.clear();
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
      this.#busy = false;
      this.#selectedDiffPath = null;
      this.#status = `Version control unavailable: ${message(error)}`;
      this.#context.logger?.warn("VCS operation failed", { message: message(error) });
      this.#renderStatus();
    });
  }
  async #restoreClient() {
    const stored = await this.#storage.get(CLIENT_KEY);
    if (!stored.ok || !stored.value || 1 !== stored.value.schemaVersion) {
      return;
    }
    const value = stored.value.value;
    if ("string" === typeof value && CLIENTS.includes(value)) {
      this.#selectedClient = value;
    }
  }
  async #persistClient() {
    const result = await this.#storage.set(CLIENT_KEY, {
      schemaVersion: 1,
      value: this.#selectedClient
    });
    if (!result.ok) {
      this.#context.logger?.warn("VCS external-client preference was not saved", {
        kind: result.error.kind,
        message: result.error.message
      });
    }
  }
  async #refresh() {
    this.#busy = true;
    this.#status = "Refreshing version-control status\u2026";
    this.#renderStatus();
    this.#snapshot = await this.#vcs.status();
    if (this.#disposed) {
      return;
    }
    this.#busy = false;
    const count = this.#snapshot.entries.length;
    this.#status = "none" === this.#snapshot.kind ? "This workspace is not a supported Git or SVN checkout." : `${this.#snapshot.kind.toUpperCase()} \xB7 ${String(count)} changed path${1 === count ? "" : "s"}${this.#snapshot.truncated ? " \xB7 native result truncated" : ""}`;
    this.#selectedDiffPath = null;
    this.#renderStatus();
  }
  async #openDiff(path) {
    if ("none" === this.#snapshot.kind) {
      return;
    }
    this.#busy = true;
    this.#status = `Loading diff for ${path}\u2026`;
    this.#renderStatus();
    const result = await this.#vcs.diff(path);
    if (this.#disposed) {
      return;
    }
    this.#busy = false;
    this.#selectedDiffPath = path;
    const rendered = diffReaderBlocks(result);
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "reader",
      title: `Diff \xB7 ${path}`,
      sourcePath: path,
      status: 0 === rendered.blocks.length ? "No textual working-tree or staged diff is available for this path." : `${result.kind.toUpperCase()} diff${rendered.truncated ? " \xB7 display truncated" : ""}`,
      outline: [],
      blocks: rendered.blocks,
      actions: [
        { id: "back", label: "Back" },
        { id: "refresh-diff", label: "Refresh" }
      ]
    });
  }
  async #openExternal() {
    if ("none" === this.#snapshot.kind) {
      throw new Error("External VCS client requires a Git or SVN workspace");
    }
    const result = await this.#vcs.openExternal(this.#selectedClient);
    this.#status = `Opened ${clientLabel(result.client)}`;
    this.#renderStatus();
  }
  #handleAction(action) {
    if ("activate" === action.type) {
      const id2 = payloadString(action, "id");
      const path = id2 ? this.#pathByItem.get(id2) : void 0;
      if (path) {
        this.#enqueue(() => this.#openDiff(path));
      }
      return;
    }
    if ("field" === action.type && "client" === payloadString(action, "id")) {
      const value = payloadString(action, "value");
      if (!value || !CLIENTS.includes(value)) {
        throw new Error("External VCS client selection is malformed");
      }
      this.#selectedClient = value;
      this.#renderStatus();
      this.#enqueue(() => this.#persistClient());
      return;
    }
    if ("command" !== action.type) {
      return;
    }
    const id = payloadString(action, "id");
    if ("refresh" === id) {
      this.#enqueue(() => this.#refresh());
    } else if ("open-external" === id) {
      this.#enqueue(() => this.#openExternal());
    } else if ("back" === id) {
      this.#selectedDiffPath = null;
      this.#renderStatus();
    } else if ("refresh-diff" === id && this.#selectedDiffPath) {
      this.#enqueue(() => this.#openDiff(this.#selectedDiffPath));
    }
  }
  #renderStatus() {
    if (this.#disposed || null !== this.#selectedDiffPath) {
      return;
    }
    const merged = mergeVcsStatus(
      this.#snapshot.entries,
      this.#documents.listOpenSaveStates()
    );
    const visible = merged.slice(0, VCS_LIMITS.renderedStatusEntries);
    this.#pathByItem.clear();
    const items = visible.map((entry, index) => {
      const id = `entry-${String(index)}`;
      this.#pathByItem.set(id, entry.path);
      const badges = [
        ...entry.status ? [visibleStatusCode(entry.status)] : [],
        ...entry.unsaved ? ["Unsaved"] : []
      ];
      return {
        id,
        title: entry.path,
        description: entry.status ? `index ${entry.status.indexStatus} \xB7 working tree ${entry.status.workingTreeStatus}` : "Open document has unsaved application changes",
        badges
      };
    });
    const branch = this.#snapshot.branch ? ` \xB7 ${this.#snapshot.branch}` : "";
    const displayTruncated = VCS_LIMITS.renderedStatusEntries < merged.length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: `Version Control${branch}`,
      fields: [{
        id: "client",
        kind: "select",
        label: "External client",
        value: this.#selectedClient,
        options: CLIENTS.map((client) => ({ value: client, label: clientLabel(client) }))
      }],
      actions: [
        { id: "refresh", label: "Refresh", disabled: this.#busy },
        {
          id: "open-external",
          label: "Open external",
          disabled: this.#busy || "none" === this.#snapshot.kind
        }
      ],
      status: `${this.#status}${displayTruncated ? " \xB7 display limited to 500 paths" : ""}`,
      busy: this.#busy,
      emptyMessage: "No repository or unsaved document changes.",
      items
    });
  }
};

// plugins/official/vcs/src/index.ts
var pluginManifest = definePluginManifest(plugin_default);
var plugin = definePlugin({
  activate(context) {
    if (!context.commands) {
      throw new Error("VCS requires commands");
    }
    if (!context.documents) {
      throw new Error("VCS requires document save-state access");
    }
    if (!context.storage) {
      throw new Error("VCS requires workspace storage");
    }
    if (!context.vcs) {
      throw new Error("VCS requires the official bounded process broker");
    }
    if (!context.views) {
      throw new Error("VCS requires ui.views");
    }
    const controller = new VcsController(context, {
      documents: context.documents,
      storage: context.storage,
      vcs: context.vcs,
      views: context.views
    });
    controller.start();
    return controller;
  }
});
var index_default = plugin;
export {
  VCS_LIMITS,
  index_default as default,
  diffReaderBlocks,
  mergeVcsStatus,
  pluginManifest,
  visibleStatusCode
};

export const pluginContentHash="sha256:c61b9aa158628fcc1087f42912477b7c1140a1671c92a346b506dbd48205b87e";
