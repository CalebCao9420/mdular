# Core and plugin boundary

This document describes the first executable V2 boundary. It is intentionally small: the legacy
application remains operational while new code is introduced behind host-neutral package APIs.

## Package roles

| Package | Owns | Must not own |
| --- | --- | --- |
| `@mdular/core` | Workspace-relative path and document invariants | UI, DOM, Tauri, Node.js, engine APIs |
| `@mdular/plugin-manifest` | Versioned plugin metadata and contribution declarations | Plugin execution or host services |
| `@mdular/plugin-sdk` | The only public capability surface available to plugins | Native paths, raw DOM, shell or host internals |
| `@mdular/plugin-runtime` | Activation, deactivation, rollback and subscription disposal | Downloading code or acting as a security sandbox |

Dependencies flow toward contracts:

```text
core

plugin-manifest <- plugin-sdk <- plugin-runtime
```

`core` is independent from the plugin system. A host adapts core operations into the narrower,
permission-aware services exposed by the plugin SDK.

## Current guarantees

- Core paths are canonical, workspace-relative paths. Native absolute paths stop at a platform
  adapter and never enter plugin APIs.
- Plugins receive commands, Markdown workspace access, navigation, declarative view state and a
  logger through `PluginContext`; they do not receive a mount element or browser event objects.
- The runtime owns lifecycle cleanup. Failed activation rolls back collected subscriptions, and
  normal deactivation disposes them in reverse registration order.
- Official plugins must import only `@mdular/plugin-sdk`; package dependency rules are checked by
  `npm run check:architecture`.
- Cross-package imports must use an entry declared by the target package's `exports` map. Relative
  cross-package paths, hidden package subpaths and Node.js builtins are rejected.
- V2 packages compile under strict TypeScript without DOM library types.

## Deliberately deferred

The current runtime accepts only trusted modules that a host has already bundled. Manifest schema
validation, permission enforcement, installation, signatures and isolation are separate host
boundaries and must exist before third-party plugins can be enabled.

The existing Chat, Docs, Kanban and other V1 modules are not moved in this slice. They continue to
run through the legacy application while the shell and public view primitives are built; migration
will then happen one official plugin at a time.
