// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/extended-markdown/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.extended-markdown",
  name: "Extended Markdown",
  version: "0.1.0",
  entry: "extended-markdown.js",
  description: "Official Mermaid, KaTeX, emoji, wiki-link, code-language and table editing support.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "editor.extensions"
  ]
};

// plugins/official/extended-markdown/src/index.ts
var pluginManifest = definePluginManifest(plugin_default);
var plugin = definePlugin({
  activate(context) {
    const editor = context.editor;
    if (!editor) {
      throw new Error("Extended Markdown requires editor.extensions");
    }
    context.subscriptions.add(editor.registerExtension({
      schemaVersion: 1,
      id: "mdular.extended-markdown.features",
      features: [
        "code-languages",
        "emoji",
        "math",
        "mermaid",
        "tables",
        "wiki-links"
      ]
    }));
  }
});
var index_default = plugin;
export {
  index_default as default,
  pluginManifest
};

export const pluginContentHash="sha256:5625929c6709a6a30475c04670ee1e58daa6a0c90543cec363d72572fc2fb44c";
