// Generated from src/ — edit TypeScript and run: npm run build
export const bundledPluginCatalog = Object.freeze([
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.docs","name":"Docs","version":"0.1.0","entry":"docs.js","description":"Official reading, outline, frontmatter and document browsing tools.","activationEvents":["onStartup"],"permissions":["commands","documents.editActive","documents.readActive","extensions.consume","extensions.register","navigation.openMarkdown","ui.documentHeader","ui.views","storage.workspace","workspace.readMarkdown","workspace.writeTextBatch","workspace.watchMarkdown"],"contributes":{"commands":[{"id":"mdular.docs.open-reader","title":"Docs: Open Reading View","defaultKeybindings":["Mod+Shift+R"]},{"id":"mdular.docs.open-outline","title":"Docs: Open Outline","defaultKeybindings":["Mod+Shift+O"]},{"id":"mdular.docs.browse","title":"Docs: Browse docs/","defaultKeybindings":["Mod+Shift+D"]},{"id":"mdular.docs.edit-frontmatter","title":"Docs: Edit Frontmatter"}],"documentHeaders":[{"id":"metadata","title":"Metadata"}],"views":[{"id":"docs","title":"Docs","location":"editor-pane"}]}}),
    entry: "docs.js",
    contentHash: "sha256:930eecd7b630d005071dd85fef9448f0e2b6a08e7fe9ade3c97391dfc37418f0",
    load: () => import("./plugins/docs.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.search","name":"Search","version":"0.1.0","entry":"search.js","description":"Private, incremental full-text search for authorized Markdown documents.","activationEvents":["onStartup"],"permissions":["commands","extensions.consume","navigation.openMarkdown","storage.workspace","ui.views","workspace.readMarkdown","workspace.watchMarkdown"],"contributes":{"commands":[{"id":"mdular.search.open","title":"Search","defaultKeybindings":["Mod+K","Mod+P"]}],"views":[{"id":"search-results","title":"Search","location":"editor-pane"}]}}),
    entry: "search.js",
    contentHash: "sha256:4c4981510313f185ebc210db3ebad88772ae3b3f4caf906a1dd3963ef37eeb49",
    load: () => import("./plugins/search.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.templates","name":"Templates","version":"0.1.0","entry":"templates.js","description":"Previewed document templates and resumable project scaffolds.","activationEvents":["onStartup"],"permissions":["commands","navigation.openMarkdown","storage.workspace","ui.views","workspace.writeTextBatch"],"contributes":{"commands":[{"id":"mdular.templates.new-document","title":"New from Template","defaultKeybindings":["Mod+Shift+N"]},{"id":"mdular.templates.scaffold","title":"Create Project Scaffold"},{"id":"mdular.templates.manage","title":"Manage Templates"}],"views":[{"id":"templates","title":"Templates","location":"editor-pane"}]}}),
    entry: "templates.js",
    contentHash: "sha256:2f05aa43c326d7bb48567fe7a11500836b4db01070d1fe993e8eda91c0a84ccf",
    load: () => import("./plugins/templates.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.chat","name":"Chat","version":"0.1.0","entry":"chat.js","description":"Fast Markdown capture with completion, batch actions, and extensible archives.","activationEvents":["onStartup"],"permissions":["commands","extensions.consume","extensions.register","ui.views","workspace.readMarkdown","workspace.modifyMarkdown","workspace.writeTextBatch","workspace.watchMarkdown"],"contributes":{"commands":[{"id":"mdular.chat.open","title":"Open Chat","defaultKeybindings":["Mod+Enter"]},{"id":"mdular.chat.quick-capture","title":"Quick Capture to Chat","defaultKeybindings":["Mod+Shift+Enter"]}],"views":[{"id":"chat","title":"Chat","location":"editor-pane"}]}}),
    entry: "chat.js",
    contentHash: "sha256:ebf706324f9c86e5cb839981109ccaac42c864fa528f1a049df4db3a090177a4",
    load: () => import("./plugins/chat.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.extended-markdown","name":"Extended Markdown","version":"0.1.0","entry":"extended-markdown.js","description":"Official Mermaid, KaTeX, emoji, wiki-link, code-language and table editing support.","activationEvents":["onStartup"],"permissions":["editor.extensions"]}),
    entry: "extended-markdown.js",
    contentHash: "sha256:5625929c6709a6a30475c04670ee1e58daa6a0c90543cec363d72572fc2fb44c",
    load: () => import("./plugins/extended-markdown.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.media","name":"Media","version":"0.1.0","entry":"media.js","description":"Official bounded paste, drop and workspace media preview support.","activationEvents":["onStartup"],"permissions":["editor.extensions","workspace.writeMedia"]}),
    entry: "media.js",
    contentHash: "sha256:4594e9aa2d2b9bd830c364e23460142b947aee0b165acf22c9c734ffa8226cbd",
    load: () => import("./plugins/media.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.kanban","name":"Kanban","version":"0.1.0","entry":"kanban.js","description":"Official issues board, workflow configuration, filtering and Chat archive target.","activationEvents":["onStartup"],"permissions":["commands","extensions.register","navigation.openMarkdown","storage.workspace","ui.views","workspace.readMarkdown","workspace.readText","workspace.modifyMarkdown","workspace.modifyText","workspace.writeTextBatch","workspace.watchMarkdown"],"contributes":{"commands":[{"id":"mdular.kanban.open","title":"Kanban: Open Issues","defaultKeybindings":["Mod+Shift+B"]},{"id":"mdular.kanban.new-issue","title":"Kanban: New Issue"},{"id":"mdular.kanban.configure","title":"Kanban: Configure Workflow"}],"views":[{"id":"kanban","title":"Kanban","location":"editor-pane"}]}}),
    entry: "kanban.js",
    contentHash: "sha256:86a553860c7bb7305bca4d568f0fa769023608d4cd148f7d5ff117f9ba5e72e8",
    load: () => import("./plugins/kanban.js"),
  }),
  Object.freeze({
    manifest: Object.freeze({"schemaVersion":1,"id":"mdular.vcs","name":"Version Control","version":"0.1.0","entry":"vcs.js","description":"Official bounded Git/SVN status, diff and external-client integration.","activationEvents":["onStartup"],"permissions":["commands","documents.readActive","process.vcs","storage.workspace","ui.views"],"contributes":{"commands":[{"id":"mdular.vcs.open","title":"Version Control: Open","defaultKeybindings":["Mod+Shift+G"]},{"id":"mdular.vcs.refresh","title":"Version Control: Refresh"},{"id":"mdular.vcs.open-external","title":"Version Control: Open External Client"}],"views":[{"id":"vcs","title":"Version Control","location":"editor-pane"}]}}),
    entry: "vcs.js",
    contentHash: "sha256:c61b9aa158628fcc1087f42912477b7c1140a1671c92a346b506dbd48205b87e",
    load: () => import("./plugins/vcs.js"),
  })
]);
