// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/media/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.media",
  name: "Media",
  version: "0.1.0",
  entry: "media.js",
  description: "Official bounded paste, drop and workspace media preview support.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "editor.extensions",
    "workspace.writeMedia"
  ]
};

// plugins/official/media/src/index.ts
var pluginManifest = definePluginManifest(plugin_default);
var plugin = definePlugin({
  activate(context) {
    const editor = context.editor;
    if (!editor) {
      throw new Error("Media requires editor.extensions");
    }
    context.subscriptions.add(editor.registerExtension({
      schemaVersion: 1,
      id: "mdular.media.editor",
      features: ["media"]
    }));
  }
});
var index_default = plugin;
export {
  index_default as default,
  pluginManifest
};

export const pluginContentHash="sha256:4594e9aa2d2b9bd830c364e23460142b947aee0b165acf22c9c734ffa8226cbd";
