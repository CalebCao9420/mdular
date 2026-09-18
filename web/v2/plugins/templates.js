// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/templates/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.templates",
  name: "Templates",
  version: "0.1.0",
  entry: "templates.js",
  description: "Previewed document templates and resumable project scaffolds.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "navigation.openMarkdown",
    "storage.workspace",
    "ui.views",
    "workspace.writeTextBatch"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.templates.new-document",
        title: "New from Template",
        defaultKeybindings: [
          "Mod+Shift+N"
        ]
      },
      {
        id: "mdular.templates.scaffold",
        title: "Create Project Scaffold"
      },
      {
        id: "mdular.templates.manage",
        title: "Manage Templates"
      }
    ],
    views: [
      {
        id: "templates",
        title: "Templates",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/templates/src/engine.ts
var TEMPLATE_LIMITS = Object.freeze({
  maxCustomTemplates: 32,
  maxTemplateNameCharacters: 80,
  maxTemplateCharacters: 32 * 1024,
  maxCustomTemplateCharacters: 40 * 1024
});
var BUILTIN_DOCUMENT_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "builtin:plain",
    name: "Plain Markdown",
    body: "",
    builtIn: true
  }),
  Object.freeze({
    id: "builtin:frontmatter",
    name: "Frontmatter document",
    body: [
      "---",
      "status: draft",
      "title: ${title}",
      "tags:",
      "date: ${date}",
      "---",
      "",
      ""
    ].join("\n"),
    builtIn: true
  })
]);
var VARIABLE_NAMES = /* @__PURE__ */ new Set([
  "title",
  "date",
  "path",
  "filename"
]);
function normalizeTemplatePath(value) {
  if ("string" !== typeof value) {
    throw new Error("Template path must be a string");
  }
  const path = value.trim();
  if ("" === path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:\//u.test(path)) {
    throw new Error("Template path must be workspace-relative");
  }
  const segments = path.split("/");
  if (segments.some((segment) => "" === segment || "." === segment || ".." === segment)) {
    throw new Error("Template path contains an invalid segment");
  }
  const extension = segments.at(-1)?.split(".").at(-1)?.toLocaleLowerCase("en-US");
  if (!["md", "json", "txt", "yaml", "yml"].includes(extension ?? "")) {
    throw new Error("Template output must be Markdown, JSON, text or YAML");
  }
  return path;
}
function templateVariables(pathValue, titleValue, date) {
  const path = normalizeTemplatePath(pathValue);
  const filename = path.split("/").at(-1) ?? path;
  const inferredTitle = filename.replace(/\.[^.]+$/u, "");
  const title = String(titleValue || inferredTitle).replace(/[\r\n]+/gu, " ").trim();
  return { title, date, path, filename };
}
function renderTemplateBody(body, variables) {
  if ("string" !== typeof body || TEMPLATE_LIMITS.maxTemplateCharacters < body.length) {
    throw new Error("Template body is malformed or exceeds the limit");
  }
  const unknown = /* @__PURE__ */ new Set();
  body.replace(/\$\{([A-Za-z][A-Za-z0-9_-]*)\}/gu, (_match, name) => {
    if (!VARIABLE_NAMES.has(name)) {
      unknown.add(name);
    }
    return "";
  });
  if (0 < unknown.size) {
    throw new Error(`Unknown template variable: ${[...unknown].sort().join(", ")}`);
  }
  return body.replace(
    /\$\{(title|date|path|filename)\}/gu,
    (_match, name) => variables[name]
  );
}
function renderDocumentOperation(options) {
  const variables = templateVariables(options.path, options.title, options.date);
  return {
    path: variables.path,
    content: renderTemplateBody(options.body, variables)
  };
}

// plugins/official/templates/src/scaffold.ts
var ticketStatuses = {
  version: 1,
  defaultStatus: "pending-assign",
  statuses: [
    { id: "pending-assign", label: "\u5F85\u5206\u914D" },
    { id: "assigned-waiting", label: "\u5DF2\u5206\u914D\u7B49\u5F85\u4E2D" },
    { id: "in-progress", label: "\u8FDB\u884C\u4E2D" },
    { id: "done-pending-review", label: "\u521D\u7248\u5B8C\u6210\u5F85\u9A8C\u6536" },
    { id: "reviewing", label: "\u9A8C\u6536\u4E2D" },
    { id: "review-done-pending-test", label: "\u9A8C\u6536\u5B8C\u6210\u5F85\u6D4B\u8BD5" },
    { id: "testing", label: "\u6D4B\u8BD5\u4E2D" },
    { id: "done", label: "\u9A8C\u6D4B\u5B8C\u6210" },
    { id: "requirement-rejected", label: "\u9700\u6C42\u9A73\u56DE" },
    { id: "review-failed", label: "\u9A8C\u6536\u4E0D\u901A\u8FC7" },
    { id: "test-failed", label: "\u6D4B\u8BD5\u4E0D\u901A\u8FC7" }
  ]
};
var ticketBoard = {
  version: 1,
  columns: [
    { id: "col-inbox", label: "\u6536\u4EF6\u7BB1", statusId: null, locked: false },
    ...ticketStatuses.statuses.map((status) => ({
      id: `col-${status.id}`,
      label: status.label,
      statusId: status.id,
      locked: false
    }))
  ]
};
var DEFAULT_SCAFFOLD_PACKAGE = Object.freeze({
  schemaVersion: 1,
  name: "Standard project documentation",
  files: Object.freeze([
    Object.freeze({
      path: "docs/README.md",
      content: [
        "# Project documentation",
        "",
        "Design notes, API references and decisions belong here.",
        "",
        "- `design/` \u2014 architecture and design",
        "- Other topics \u2014 Markdown files in this directory",
        ""
      ].join("\n")
    }),
    Object.freeze({
      path: "docs/design/README.md",
      content: "# Design documents\n\nArchitecture, module boundaries and interface agreements.\n"
    }),
    Object.freeze({
      path: "issues/ticket-statuses.json",
      content: `${JSON.stringify(ticketStatuses, null, 2)}
`
    }),
    Object.freeze({
      path: "issues/ticket-board.json",
      content: `${JSON.stringify(ticketBoard, null, 2)}
`
    }),
    Object.freeze({
      path: "issues/README.md",
      content: [
        "# Issues",
        "",
        "Each Markdown file in this directory is a ticket.",
        "",
        "```yaml",
        "---",
        "status: pending-assign",
        "title: Example ticket",
        "boardColumn: col-inbox",
        "assignee:",
        "priority: medium",
        "tags: feature",
        "date: ${date}",
        "---",
        "```",
        ""
      ].join("\n")
    }),
    Object.freeze({
      path: "changelog/CHANGELOG.md",
      content: "# Changelog\n\n## Unreleased\n\n### Added\n\n- \n"
    })
  ])
});
var DEFAULT_SCAFFOLD_PACKAGE_JSON = `${JSON.stringify(
  DEFAULT_SCAFFOLD_PACKAGE,
  null,
  2
)}
`;
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function parseScaffoldPackage(source) {
  if ("string" !== typeof source || 48 * 1024 < source.length) {
    throw new Error("Scaffold package is malformed or exceeds the editor limit");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Scaffold package JSON is invalid: ${error instanceof Error ? error.message : error}`);
  }
  if (!isRecord(value) || 1 !== value.schemaVersion || "string" !== typeof value.name || "" === value.name.trim() || !Array.isArray(value.files) || 0 === value.files.length || 128 < value.files.length) {
    throw new Error("Scaffold package shape is invalid");
  }
  const seen = /* @__PURE__ */ new Set();
  const files = value.files.map((file) => {
    if (!isRecord(file) || "string" !== typeof file.path || "string" !== typeof file.content) {
      throw new Error("Scaffold package file is malformed");
    }
    const path = normalizeTemplatePath(file.path);
    const identity = path.toLocaleLowerCase("en-US");
    if (seen.has(identity)) {
      throw new Error(`Scaffold package repeats ${path}`);
    }
    seen.add(identity);
    return { path, content: file.content };
  });
  return { schemaVersion: 1, name: value.name.trim(), files };
}
function prefixedPath(prefixValue, path) {
  const prefix = prefixValue.trim().replace(/^\/+|\/+$/gu, "");
  return normalizeTemplatePath("" === prefix ? path : `${prefix}/${path}`);
}
function renderScaffoldOperations(options) {
  const files = "docs-only" === options.preset ? options.packageDefinition.files.filter((file) => file.path.startsWith("docs/")) : options.packageDefinition.files;
  if (0 === files.length) {
    throw new Error("Selected scaffold preset has no files");
  }
  return files.map((file) => {
    const path = prefixedPath(options.prefix, file.path);
    const variables = templateVariables(path, "", options.date);
    return { path, content: renderTemplateBody(file.content, variables) };
  });
}

// plugins/official/templates/src/index.ts
var VIEW_ID = "templates";
var NEW_COMMAND = "mdular.templates.new-document";
var SCAFFOLD_COMMAND = "mdular.templates.scaffold";
var MANAGE_COMMAND = "mdular.templates.manage";
var CUSTOM_STORAGE_KEY = "custom-templates";
var SCAFFOLD_STORAGE_KEY = "scaffold-package";
var RESUME_STORAGE_KEY = "partial-batch";
var pluginManifest = definePluginManifest(plugin_default);
function isRecord2(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord2(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function messageFrom(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function decodeCustomTemplates(value) {
  if (!isRecord2(value) || !Number.isSafeInteger(value.nextId) || Number(value.nextId) < 1 || !Array.isArray(value.templates) || TEMPLATE_LIMITS.maxCustomTemplates < value.templates.length) {
    return null;
  }
  let totalCharacters = 0;
  const seen = /* @__PURE__ */ new Set();
  const templates = [];
  for (const entry of value.templates) {
    if (!isRecord2(entry) || "string" !== typeof entry.id || !/^custom-[1-9][0-9]*$/u.test(entry.id) || seen.has(entry.id) || "string" !== typeof entry.name || "" === entry.name.trim() || TEMPLATE_LIMITS.maxTemplateNameCharacters < entry.name.length || "string" !== typeof entry.body || TEMPLATE_LIMITS.maxTemplateCharacters < entry.body.length) {
      return null;
    }
    seen.add(entry.id);
    totalCharacters += entry.name.length + entry.body.length;
    templates.push({ id: entry.id, name: entry.name.trim(), body: entry.body });
  }
  if (TEMPLATE_LIMITS.maxCustomTemplateCharacters < totalCharacters) {
    return null;
  }
  return { nextId: Number(value.nextId), templates };
}
function decodeResumeBatch(value) {
  if (!isRecord2(value) || "string" !== typeof value.label || !Array.isArray(value.operations) || 0 === value.operations.length || 128 < value.operations.length || !Array.isArray(value.created) || value.created.some((path) => "string" !== typeof path)) {
    return null;
  }
  const operations = [];
  let encodedCharacters = 0;
  for (const operation of value.operations) {
    if (!isRecord2(operation) || "string" !== typeof operation.path || "string" !== typeof operation.content) {
      return null;
    }
    try {
      templateVariables(operation.path, "", "2000-01-01");
    } catch {
      return null;
    }
    encodedCharacters += operation.path.length + operation.content.length;
    operations.push({ path: operation.path, content: operation.content });
  }
  if (56 * 1024 < encodedCharacters) {
    return null;
  }
  return {
    operations,
    label: value.label.slice(0, 160),
    created: value.created
  };
}
var TemplatesController = class {
  #context;
  #storage;
  #views;
  #workspace;
  #customTemplates = [];
  #nextCustomId = 1;
  #scaffoldPackageJson = DEFAULT_SCAFFOLD_PACKAGE_JSON;
  #mode = "new";
  #status = "Choose a template and preview its write plan.";
  #busy = false;
  #newPath = "New file.md";
  #newTitle = "";
  #selectedTemplateId = "builtin:plain";
  #conflictPolicy = "fail-if-existing";
  #scaffoldPrefix = "";
  #scaffoldPreset = "standard";
  #manageName = "";
  #manageBody = "";
  #editingCustomId = null;
  #pending = null;
  #lastResult = null;
  #resumeBatch = null;
  #resumePersisted = true;
  #disposed = false;
  constructor(context, services) {
    this.#context = context;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }
  async start() {
    await Promise.all([
      this.#loadCustomTemplates(),
      this.#loadScaffoldPackage(),
      this.#loadResumeBatch()
    ]);
    if (this.#disposed) {
      return;
    }
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands.register(NEW_COMMAND, async () => {
      await this.#show("new", "Choose a template and preview its write plan.");
      return void 0;
    }));
    this.#context.subscriptions.add(this.#context.commands.register(SCAFFOLD_COMMAND, async () => {
      await this.#show("scaffold", "Edit the package if needed, then preview every write.");
      return void 0;
    }));
    this.#context.subscriptions.add(this.#context.commands.register(MANAGE_COMMAND, async () => {
      await this.#show("manage", "Custom templates stay in this workspace plugin namespace.");
      return void 0;
    }));
    this.#render();
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#pending = null;
    this.#lastResult = null;
    this.#views.hide(VIEW_ID);
  }
  async #show(mode, status) {
    this.#mode = mode;
    this.#status = status;
    this.#pending = null;
    this.#render();
    await this.#views.reveal(VIEW_ID);
  }
  async #handleAction(action) {
    if ("field" === action.type) {
      const id2 = payloadString(action, "id");
      const value = payloadString(action, "value");
      if (null === id2 || null === value) {
        throw new Error("Template field action is malformed");
      }
      this.#setField(id2, value);
      return;
    }
    if ("activate" === action.type) {
      const id2 = payloadString(action, "id");
      if (!id2) {
        throw new Error("Template activation action is malformed");
      }
      if (id2.startsWith("template:")) {
        this.#selectCustomForEditing(id2.slice("template:".length));
        this.#render();
      } else if (id2.startsWith("created:")) {
        const path = id2.slice("created:".length);
        if (path.toLocaleLowerCase("en-US").endsWith(".md")) {
          await this.#context.navigation.openMarkdown(path);
        }
      }
      return;
    }
    if ("command" !== action.type) {
      return;
    }
    const id = payloadString(action, "id");
    if (!id) {
      throw new Error("Template command action is malformed");
    }
    await this.#runViewCommand(id);
  }
  #setField(id, value) {
    switch (id) {
      case "new-path":
        this.#newPath = value;
        break;
      case "new-title":
        this.#newTitle = value;
        break;
      case "template-id":
        this.#selectedTemplateId = value;
        break;
      case "conflict-policy":
        if ("fail-if-existing" === value || "skip-existing" === value) {
          this.#conflictPolicy = value;
        }
        break;
      case "scaffold-prefix":
        this.#scaffoldPrefix = value;
        break;
      case "scaffold-preset":
        if ("standard" === value || "docs-only" === value) {
          this.#scaffoldPreset = value;
        }
        break;
      case "scaffold-package":
        this.#scaffoldPackageJson = value;
        break;
      case "custom-name":
        this.#manageName = value;
        break;
      case "custom-body":
        this.#manageBody = value;
        break;
      default:
        throw new Error(`Unknown Template field: ${id}`);
    }
  }
  async #runViewCommand(id) {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    this.#render();
    try {
      switch (id) {
        case "preview-document":
          await this.#previewDocument();
          break;
        case "preview-scaffold":
          await this.#previewScaffold();
          break;
        case "commit-plan":
          await this.#commitPlan();
          break;
        case "cancel-preview":
          this.#cancelPreview();
          break;
        case "show-new":
          this.#mode = "new";
          this.#status = "Choose a template and preview its write plan.";
          break;
        case "show-scaffold":
          this.#mode = "scaffold";
          this.#status = "Edit the package if needed, then preview every write.";
          break;
        case "show-manage":
          this.#mode = "manage";
          this.#status = "Create or edit a custom Markdown template.";
          break;
        case "save-custom":
          await this.#saveCustomTemplate();
          break;
        case "delete-custom":
          await this.#deleteCustomTemplate();
          break;
        case "new-custom":
          this.#clearCustomEditor();
          break;
        case "save-scaffold-package":
          await this.#saveScaffoldPackage();
          break;
        case "reset-scaffold-package":
          await this.#resetScaffoldPackage();
          break;
        case "continue-batch":
          await this.#previewContinuation();
          break;
        case "rollback-batch":
          await this.#rollbackLastBatch();
          break;
        default:
          throw new Error(`Unknown Template view command: ${id}`);
      }
    } catch (error) {
      this.#status = messageFrom(error);
      this.#context.logger?.warn("Templates action failed", {
        action: id,
        message: this.#status
      });
    } finally {
      this.#busy = false;
      this.#render();
    }
  }
  async #previewDocument() {
    const template = this.#templateDefinitions().find((entry) => entry.id === this.#selectedTemplateId);
    if (!template) {
      throw new Error("Selected template no longer exists");
    }
    const operation = renderDocumentOperation({
      path: this.#newPath,
      title: this.#newTitle,
      date: today(),
      body: template.body
    });
    await this.#createPreview([operation], this.#conflictPolicy, "document template", "new", operation.path);
  }
  async #previewScaffold() {
    const packageDefinition = parseScaffoldPackage(this.#scaffoldPackageJson);
    const operations = renderScaffoldOperations({
      packageDefinition,
      prefix: this.#scaffoldPrefix,
      preset: this.#scaffoldPreset,
      date: today()
    });
    await this.#createPreview(
      operations,
      this.#conflictPolicy,
      `${packageDefinition.name} (${this.#scaffoldPreset})`,
      "scaffold"
    );
  }
  async #createPreview(operations, policy, label, returnMode, openPath) {
    const plan = await this.#workspace.planTextWrites(operations, policy);
    this.#pending = { plan, operations, label, returnMode, ...openPath ? { openPath } : {} };
    this.#mode = "preview";
    const creates = plan.entries.filter((entry) => "create" === entry.disposition).length;
    const skips = plan.entries.filter((entry) => "skip" === entry.disposition).length;
    const conflicts = plan.entries.filter((entry) => "conflict" === entry.disposition).length;
    this.#status = `${creates} create \xB7 ${skips} skip \xB7 ${conflicts} conflict`;
  }
  async #commitPlan() {
    const pending = this.#pending;
    if (!pending) {
      throw new Error("No Template write plan is ready");
    }
    if (pending.plan.entries.some((entry) => "conflict" === entry.disposition)) {
      throw new Error("Resolve conflicts by choosing skip-existing and previewing again");
    }
    const result = await this.#workspace.commitTextWritePlan(pending.plan.planId);
    this.#lastResult = { result, operations: pending.operations, label: pending.label };
    this.#pending = null;
    this.#mode = "result";
    if ("partial" === result.status) {
      await this.#persistResumeBatch({
        operations: this.#lastResult.operations,
        label: this.#lastResult.label,
        created: result.created
      });
      this.#status = `Partial: ${result.created.length} created; failed at ${result.failed.path}.` + (this.#resumePersisted ? " Continuation saved." : " Continuation is session-only.");
      return;
    }
    await this.#clearResumeBatch();
    this.#status = `Complete: ${result.created.length} created \xB7 ${result.skipped.length} skipped.`;
    if (pending.openPath && result.created.includes(pending.openPath) && pending.openPath.toLocaleLowerCase("en-US").endsWith(".md")) {
      await this.#context.navigation.openMarkdown(pending.openPath);
    }
  }
  #cancelPreview() {
    const returnMode = this.#pending?.returnMode ?? "new";
    this.#pending = null;
    this.#mode = returnMode;
    this.#status = "Write plan cancelled; no files were created.";
  }
  async #previewContinuation() {
    const resume = this.#resumeBatch ?? (this.#lastResult && "partial" === this.#lastResult.result.status ? {
      operations: this.#lastResult.operations,
      label: this.#lastResult.label,
      created: this.#lastResult.result.created
    } : null);
    if (!resume) {
      throw new Error("No interrupted Template batch is available");
    }
    await this.#createPreview(
      resume.operations,
      "skip-existing",
      `${resume.label} continuation`,
      "scaffold"
    );
  }
  async #rollbackLastBatch() {
    const result = this.#lastResult?.result;
    if (!result?.rollbackId) {
      throw new Error("Safe rollback is unavailable after restart");
    }
    const rollback = await this.#workspace.rollbackTextWrites(result.rollbackId);
    await this.#clearResumeBatch();
    this.#status = `${rollback.removed.length} unchanged creation(s) removed` + (0 < rollback.retained.length ? ` \xB7 ${rollback.retained.length} changed file(s) retained` : "");
    this.#lastResult = null;
    this.#mode = "new";
  }
  #templateDefinitions() {
    return [
      ...BUILTIN_DOCUMENT_TEMPLATES,
      ...this.#customTemplates.map((template) => ({
        id: `custom:${template.id}`,
        name: template.name,
        body: template.body
      }))
    ];
  }
  #selectCustomForEditing(id) {
    const template = this.#customTemplates.find((entry) => entry.id === id);
    if (!template) {
      throw new Error("Custom template no longer exists");
    }
    this.#editingCustomId = template.id;
    this.#manageName = template.name;
    this.#manageBody = template.body;
    this.#status = `Editing ${template.name}`;
  }
  #clearCustomEditor() {
    this.#editingCustomId = null;
    this.#manageName = "";
    this.#manageBody = "";
    this.#status = "New custom template.";
  }
  async #saveCustomTemplate() {
    const name = this.#manageName.trim();
    if ("" === name || TEMPLATE_LIMITS.maxTemplateNameCharacters < name.length) {
      throw new Error("Custom template name is empty or too long");
    }
    renderTemplateBody(this.#manageBody, {
      title: "Title",
      date: "2000-01-01",
      path: "example.md",
      filename: "example.md"
    });
    const previousTemplates = this.#customTemplates;
    const previousNextId = this.#nextCustomId;
    if (this.#editingCustomId) {
      this.#customTemplates = this.#customTemplates.map((template) => template.id === this.#editingCustomId ? { ...template, name, body: this.#manageBody } : template);
    } else {
      if (TEMPLATE_LIMITS.maxCustomTemplates <= this.#customTemplates.length) {
        throw new Error("Custom template count limit reached");
      }
      const id = `custom-${this.#nextCustomId}`;
      this.#nextCustomId += 1;
      this.#customTemplates = [...this.#customTemplates, { id, name, body: this.#manageBody }];
      this.#editingCustomId = id;
    }
    const total = this.#customTemplates.reduce(
      (sum, template) => sum + template.name.length + template.body.length,
      0
    );
    if (TEMPLATE_LIMITS.maxCustomTemplateCharacters < total) {
      this.#customTemplates = previousTemplates;
      this.#nextCustomId = previousNextId;
      throw new Error("Custom templates exceed their combined storage budget");
    }
    try {
      await this.#persistCustomTemplates();
    } catch (error) {
      this.#customTemplates = previousTemplates;
      this.#nextCustomId = previousNextId;
      throw error;
    }
    this.#status = `Saved custom template: ${name}`;
  }
  async #deleteCustomTemplate() {
    if (!this.#editingCustomId) {
      throw new Error("Select a custom template to delete");
    }
    const previous = this.#customTemplates;
    const deleted = previous.find((template) => template.id === this.#editingCustomId);
    this.#customTemplates = previous.filter((template) => template.id !== this.#editingCustomId);
    try {
      await this.#persistCustomTemplates();
    } catch (error) {
      this.#customTemplates = previous;
      throw error;
    }
    this.#clearCustomEditor();
    this.#status = `Deleted custom template: ${deleted?.name ?? ""}`;
    if (!this.#templateDefinitions().some((template) => template.id === this.#selectedTemplateId)) {
      this.#selectedTemplateId = "builtin:plain";
    }
  }
  async #saveScaffoldPackage() {
    parseScaffoldPackage(this.#scaffoldPackageJson);
    const result = await this.#storage.set(SCAFFOLD_STORAGE_KEY, {
      schemaVersion: 1,
      value: { source: this.#scaffoldPackageJson }
    });
    if (!result.ok) {
      throw new Error(`Unable to save scaffold package: ${result.error.message}`);
    }
    this.#status = "Scaffold package saved for this workspace.";
  }
  async #resetScaffoldPackage() {
    const previous = this.#scaffoldPackageJson;
    this.#scaffoldPackageJson = DEFAULT_SCAFFOLD_PACKAGE_JSON;
    try {
      await this.#saveScaffoldPackage();
    } catch (error) {
      this.#scaffoldPackageJson = previous;
      throw error;
    }
    this.#status = "Scaffold package reset to the plugin default.";
  }
  async #loadCustomTemplates() {
    const result = await this.#storage.get(CUSTOM_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn("Custom templates could not be read", {
        kind: result.error.kind,
        message: result.error.message
      });
      return;
    }
    if (!result.value) {
      return;
    }
    const decoded = 1 === result.value.schemaVersion ? decodeCustomTemplates(result.value.value) : null;
    if (!decoded) {
      await this.#storage.remove(CUSTOM_STORAGE_KEY);
      this.#context.logger?.warn("Invalid custom template storage was removed");
      return;
    }
    this.#customTemplates = [...decoded.templates];
    this.#nextCustomId = decoded.nextId;
  }
  async #persistCustomTemplates() {
    const result = await this.#storage.set(CUSTOM_STORAGE_KEY, {
      schemaVersion: 1,
      value: {
        nextId: this.#nextCustomId,
        templates: this.#customTemplates.map((template) => ({ ...template }))
      }
    });
    if (!result.ok) {
      throw new Error(`Unable to save custom templates: ${result.error.message}`);
    }
  }
  async #loadScaffoldPackage() {
    const result = await this.#storage.get(SCAFFOLD_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn("Scaffold package could not be read", {
        kind: result.error.kind,
        message: result.error.message
      });
      return;
    }
    const value = result.value?.value;
    if (!result.value || 1 !== result.value.schemaVersion || !isRecord2(value) || "string" !== typeof value.source) {
      return;
    }
    try {
      parseScaffoldPackage(value.source);
      this.#scaffoldPackageJson = value.source;
    } catch {
      await this.#storage.remove(SCAFFOLD_STORAGE_KEY);
      this.#context.logger?.warn("Invalid scaffold package storage was removed");
    }
  }
  async #loadResumeBatch() {
    const result = await this.#storage.get(RESUME_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn("Template continuation could not be read", {
        kind: result.error.kind,
        message: result.error.message
      });
      return;
    }
    if (!result.value) {
      return;
    }
    const decoded = 1 === result.value.schemaVersion ? decodeResumeBatch(result.value.value) : null;
    if (!decoded) {
      await this.#storage.remove(RESUME_STORAGE_KEY);
      this.#context.logger?.warn("Invalid Template continuation was removed");
      return;
    }
    this.#resumeBatch = decoded;
    this.#status = `Recovered an interrupted batch with ${decoded.created.length} prior creation(s).`;
  }
  async #persistResumeBatch(batch) {
    this.#resumeBatch = batch;
    const result = await this.#storage.set(RESUME_STORAGE_KEY, {
      schemaVersion: 1,
      value: {
        label: batch.label,
        operations: batch.operations.map((operation) => ({ ...operation })),
        created: [...batch.created]
      }
    });
    this.#resumePersisted = result.ok;
    if (!result.ok) {
      this.#context.logger?.warn("Template continuation could not be persisted", {
        kind: result.error.kind,
        message: result.error.message
      });
    }
  }
  async #clearResumeBatch() {
    this.#resumeBatch = null;
    this.#resumePersisted = true;
    const result = await this.#storage.remove(RESUME_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn("Template continuation could not be cleared", {
        kind: result.error.kind,
        message: result.error.message
      });
    }
  }
  #commonActions() {
    return [
      { id: "show-new", label: "New document" },
      { id: "show-scaffold", label: "Project scaffold" },
      { id: "show-manage", label: "Manage templates" },
      ...this.#resumeBatch ? [{ id: "continue-batch", label: "Resume interrupted batch", tone: "primary" }] : []
    ];
  }
  #render() {
    if (this.#disposed) {
      return;
    }
    switch (this.#mode) {
      case "new":
        this.#renderNew();
        break;
      case "scaffold":
        this.#renderScaffold();
        break;
      case "manage":
        this.#renderManage();
        break;
      case "preview":
        this.#renderPreview();
        break;
      case "result":
        this.#renderResult();
        break;
    }
  }
  #renderNew() {
    const templates = this.#templateDefinitions();
    if (!templates.some((template) => template.id === this.#selectedTemplateId)) {
      this.#selectedTemplateId = "builtin:plain";
    }
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "New from Template",
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: "new-path", kind: "text", label: "Workspace-relative path", value: this.#newPath, placeholder: "notes/example.md" },
        { id: "new-title", kind: "text", label: "Title", value: this.#newTitle, placeholder: "Defaults to filename" },
        {
          id: "template-id",
          kind: "select",
          label: "Template",
          value: this.#selectedTemplateId,
          options: templates.map((template) => ({ value: template.id, label: template.name }))
        },
        {
          id: "conflict-policy",
          kind: "select",
          label: "Existing path policy",
          value: this.#conflictPolicy,
          options: [
            { value: "fail-if-existing", label: "Stop on existing path" },
            { value: "skip-existing", label: "Skip existing path" }
          ]
        }
      ],
      actions: [
        { id: "preview-document", label: "Preview write plan", tone: "primary", disabled: this.#busy },
        ...this.#commonActions().filter((action) => "show-new" !== action.id)
      ],
      items: []
    });
  }
  #renderScaffold() {
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Project Scaffold",
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: "scaffold-prefix", kind: "text", label: "Destination prefix", value: this.#scaffoldPrefix, placeholder: "Empty means workspace root" },
        {
          id: "scaffold-preset",
          kind: "select",
          label: "Preset",
          value: this.#scaffoldPreset,
          options: [
            { value: "standard", label: "Docs + issues + changelog" },
            { value: "docs-only", label: "Documentation only" }
          ]
        },
        {
          id: "conflict-policy",
          kind: "select",
          label: "Existing path policy",
          value: this.#conflictPolicy,
          options: [
            { value: "fail-if-existing", label: "Stop on any existing path" },
            { value: "skip-existing", label: "Skip existing paths" }
          ]
        },
        {
          id: "scaffold-package",
          kind: "textarea",
          label: "Editable scaffold package JSON",
          value: this.#scaffoldPackageJson,
          rows: 16,
          description: "The package belongs to Templates; Core contains no project scaffold constants."
        }
      ],
      actions: [
        { id: "preview-scaffold", label: "Preview write plan", tone: "primary", disabled: this.#busy },
        { id: "save-scaffold-package", label: "Save package", disabled: this.#busy },
        { id: "reset-scaffold-package", label: "Reset package", tone: "danger", disabled: this.#busy },
        ...this.#commonActions().filter((action) => "show-scaffold" !== action.id)
      ],
      items: []
    });
  }
  #renderManage() {
    const items = this.#customTemplates.map((template) => ({
      id: `template:${template.id}`,
      title: template.name,
      description: `${template.body.length} characters \xB7 ${template.id}`,
      ...template.id === this.#editingCustomId ? { badges: ["editing"] } : {}
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Manage Templates",
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: "custom-name", kind: "text", label: "Template name", value: this.#manageName },
        {
          id: "custom-body",
          kind: "textarea",
          label: "Markdown body",
          value: this.#manageBody,
          rows: 12,
          description: "Variables: ${title}, ${date}, ${path}, ${filename}"
        }
      ],
      actions: [
        { id: "save-custom", label: this.#editingCustomId ? "Save changes" : "Add template", tone: "primary", disabled: this.#busy },
        { id: "new-custom", label: "Clear editor", disabled: this.#busy },
        { id: "delete-custom", label: "Delete selected", tone: "danger", disabled: this.#busy || !this.#editingCustomId },
        ...this.#commonActions().filter((action) => "show-manage" !== action.id)
      ],
      emptyMessage: "No custom templates yet.",
      items
    });
  }
  #renderPreview() {
    const pending = this.#pending;
    if (!pending) {
      this.#mode = "new";
      this.#status = "Write plan expired; preview again.";
      this.#renderNew();
      return;
    }
    const conflicts = pending.plan.entries.some((entry) => "conflict" === entry.disposition);
    const fields = 1 === pending.operations.length ? [{
      id: "preview-content",
      kind: "textarea",
      label: "Rendered content preview",
      value: pending.operations[0]?.content ?? "",
      rows: 12,
      readOnly: true
    }] : [];
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: `Write Plan \xB7 ${pending.label}`,
      status: this.#status,
      busy: this.#busy,
      fields,
      actions: [
        { id: "commit-plan", label: "Commit planned writes", tone: "primary", disabled: this.#busy || conflicts },
        { id: "cancel-preview", label: "Back without writing", disabled: this.#busy }
      ],
      items: pending.plan.entries.map((entry) => ({
        id: `plan:${entry.path}`,
        title: entry.path,
        description: `${entry.bytes} bytes`,
        badges: [entry.disposition]
      }))
    });
  }
  #renderResult() {
    const last = this.#lastResult;
    const items = [];
    if (last) {
      items.push(...last.result.created.map((path) => ({
        id: `created:${path}`,
        title: path,
        badges: ["created"]
      })));
      items.push(...last.result.skipped.map((path) => ({
        id: `skipped:${path}`,
        title: path,
        badges: ["skipped"]
      })));
      if ("partial" === last.result.status) {
        items.push({
          id: `failed:${last.result.failed.path}`,
          title: last.result.failed.path,
          description: last.result.failed.message,
          badges: ["failed", last.result.failed.kind]
        });
      }
    }
    const actions = [
      ...last?.result.rollbackId ? [{ id: "rollback-batch", label: "Roll back unchanged creations", tone: "danger", disabled: this.#busy }] : [],
      ...last && "partial" === last.result.status || this.#resumeBatch ? [{ id: "continue-batch", label: "Preview safe continuation", tone: "primary", disabled: this.#busy }] : [],
      ...this.#commonActions().filter((action) => "continue-batch" !== action.id)
    ];
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Template Batch Result",
      status: this.#status,
      busy: this.#busy,
      actions,
      emptyMessage: "No files were created.",
      items
    });
  }
};
var plugin = definePlugin({
  async activate(context) {
    if (!context.commands) {
      throw new Error("Templates requires commands");
    }
    if (!context.navigation) {
      throw new Error("Templates requires navigation.openMarkdown");
    }
    if (!context.storage) {
      throw new Error("Templates requires storage.workspace");
    }
    if (!context.views) {
      throw new Error("Templates requires ui.views");
    }
    if (!context.workspace?.planTextWrites || !context.workspace.commitTextWritePlan || !context.workspace.rollbackTextWrites) {
      throw new Error("Templates requires workspace.writeTextBatch");
    }
    const controller = new TemplatesController(context, {
      storage: context.storage,
      views: context.views,
      workspace: {
        planTextWrites: context.workspace.planTextWrites,
        commitTextWritePlan: context.workspace.commitTextWritePlan,
        rollbackTextWrites: context.workspace.rollbackTextWrites
      }
    });
    await controller.start();
    return controller;
  }
});
var index_default = plugin;
export {
  BUILTIN_DOCUMENT_TEMPLATES,
  DEFAULT_SCAFFOLD_PACKAGE,
  DEFAULT_SCAFFOLD_PACKAGE_JSON,
  TEMPLATE_LIMITS,
  index_default as default,
  parseScaffoldPackage,
  pluginManifest,
  renderDocumentOperation,
  renderScaffoldOperations,
  renderTemplateBody,
  templateVariables
};

export const pluginContentHash="sha256:2f05aa43c326d7bb48567fe7a11500836b4db01070d1fe993e8eda91c0a84ccf";
