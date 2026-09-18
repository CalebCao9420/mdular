# Core and plugin boundary

This document describes the first executable V2 boundary. It is intentionally small: the legacy
application remains operational while new code is introduced behind host-neutral package APIs.

## Package roles

| Package | Owns | Must not own |
| --- | --- | --- |
| `@mdular/platform` | Workspace-relative path/key, opaque revision, snapshot and adapter contracts | Session policy, UI, DOM, Tauri, Node.js, engine APIs |
| `@mdular/core` | DocumentSession, save/conflict/recovery state and session identity | Native paths, UI, DOM, Tauri, Node.js, engine APIs |
| `@mdular/editor` | Pane/session ownership, per-pane view state and editor-session binding | Native paths, Tauri, legacy globals or workspace I/O |
| `@mdular/plugin-manifest` | Versioned plugin metadata and contribution declarations | Plugin execution or host services |
| `@mdular/plugin-sdk` | The only public capability surface available to plugins | Native paths, raw DOM, shell or host internals |
| `@mdular/plugin-runtime` | Activation, deactivation, rollback and subscription disposal | Downloading code or acting as a security sandbox |

Dependencies flow toward contracts:

```text
platform <- core <- editor

plugin-manifest <- plugin-sdk <- plugin-runtime
```

`core` is independent from the plugin system. A host adapts core operations into the narrower,
permission-aware services exposed by the plugin SDK.

## Current guarantees

- Platform paths are canonical, workspace-relative paths. Host-confirmed keys apply the actual
  filesystem's case/Unicode rules; native absolute paths stop at an adapter and never enter Core or
  plugin APIs.
- Core owns one `DocumentSession` per host-confirmed path key. Saves are serialized against an
  opaque expected revision; edits made during a save remain dirty, external changes become typed
  conflicts, and application renames rekey the same session.
- `PaneController` limits the model to primary/secondary panes, attaches both views of one document
  to the same `DocumentSession`, keeps selection/scroll/focus state per pane, falls back to primary
  when secondary is unavailable, and releases only clean, unreferenced sessions. The desktop binds
  both CodeMirror panes to this model; same-session panes use linked documents with shared history,
  different sessions remain isolated, and save still flows through the Core queue and recovery
  cleanup rather than calling filesystem commands from a view. Desktop layout preferences persist
  only `secondaryVisible` and `activePane` in a versioned localStorage record; paths, document
  content and session state are excluded. Malformed or unavailable storage falls back to the
  primary-only default, while a temporary narrow-window fallback does not erase the wide layout
  preference.
- Snapshots declare `read-write` or typed `read-only` access. Invalid UTF-8 may be exposed as a
  display-only replacement preview, but Core rejects edits so replacement characters can never be
  written back implicitly.
- Recovery writes are serialized per session. The host-independent coordinator schedules the
  two-second debounce and thirty-second dirty interval, flushes on lifecycle boundaries, and
  returns typed restart blockers for conflict, save and recovery failures. The host store remains
  responsible for checksums, two generations, quota, permissions and atomic app-data writes.
- The desktop close listener prevents the native close request synchronously, runs the same typed
  recovery gate, and only invokes the narrowly permitted forced window destroy after the gate is
  ready. The Rust-owned updater now invokes that same Core gate through a typed, one-request
  handshake before installation; recovery errors, conflicts and stale/duplicate responses fail
  closed.
- Workspace watch events are hints only. Core serializes overlapping refreshes, waits for an
  in-flight app save, re-reads through the adapter and applies only the host result; a delete hint
  does not become `missing` until the host confirms `not-found`.
- The desktop adapter registers only paths owned by open document sessions. The native host polls
  those explicit paths every 750 ms, hashes at most four regular files per tick in round-robin
  order, rejects links/reparse points and files above 16 MiB, and emits only created/changed/deleted
  hints. A rejected or unavailable watch never weakens the optimistic revision check on save.
- The desktop adapter validates every invoke/listen payload before branding paths, keys or
  revisions. The desktop composition root now owns the real `@tauri-apps/api` transport while the
  bridge remains dependency-injectable for contract tests, so malformed host data fails closed
  without introducing a second global edge.
- Rust `workspace_read_document` and `workspace_stat_document` commands enforce V2-relative paths,
  reject link/reparse components, hash original bytes with SHA-256 for opaque revisions, derive an
  opaque key from the host-canonical path, and preserve BOM/EOL/trailing-newline facts separately
  from normalized editor content. Invalid UTF-8 is returned only as a typed read-only preview.
- `workspace_write_document_if_revision` re-reads the byte revision immediately before commit,
  returns a typed conflict instead of overwriting a changed file, writes a private sibling temp,
  syncs it, atomically replaces the target, syncs the directory, and re-reads the committed bytes.
  macOS fixtures prove ordinary mode, ACL and xattr preservation plus cleanup on permission,
  short-write, flush, sync and replace failures. Linux has a native xattr preservation fixture;
  Windows has native named-stream preservation and sharing-violation cleanup fixtures. Candidate
  runners execute the Rust suite before packaging, but target-platform evidence remains open until
  those jobs actually pass. This is optimistic protection, not a cross-process linearizable
  compare-and-swap.
- Atomic writes use an exact private sibling name. The first watched document in a bound workspace
  performs one bounded, link-safe scan that skips `.git`/`.svn` and removes only exact internal
  regular-file names whose embedded creation time and filesystem modification time are both older
  than seven days. Malformed, recent, linked and VCS-contained entries are retained.
- Desktop recovery records live under a versioned, opaque workspace directory in app-data. The
  host validates checksums, retains current/previous generations, applies a fail-closed 256 MiB
  workspace quota, uses atomic private writes and enforces Unix directory/file modes `0700/0600`.
  The Tauri recovery adapter validates records again before branding them for Core. On startup,
  the desktop root discovers records only for the host-confirmed workspace and requires an
  explicit Restore, Later or confirmed Discard choice before that workspace may be rebound.
  Restore re-reads the host document into a fresh session: an exact saved revision becomes a clean
  session, a changed disk revision becomes an explicit external-change conflict while retaining
  the recovered buffer, and a stale record is removed.
- The active conflict surface keeps overwrite-style save disabled. `Keep buffer as recovery copy`
  flushes the current buffer without resolving the conflict; confirmed `Reload disk` re-reads host
  truth before replacing the buffer and cleaning recovery; continuing to edit leaves the typed
  conflict intact.
- Diff compares only a session's saved snapshot with its current buffer. The host-neutral bounded
  Myers model strips BOM/normalizes logical LF, trims common edges and enforces 20,000 middle
  lines, 2 MiB combined input, edit distance 2,000 and 250 ms. Limit hits return one typed changed
  block. Desktop computation runs in a cancellable module worker keyed by request ID and
  `bufferVersion`; missing/failed workers use only the bounded changed-block fallback on the UI
  thread, and rendering assigns user text through `textContent`.
- The browser-preview adapter declares session-memory persistence, memory-assignment replacement
  and adapter-local watch hints. Its UTF-8/BOM/EOL and optimistic-conflict fixtures exercise the
  same typed Core contract without claiming desktop filesystem parity.
- Plugin manifests declare versioned permissions and contribution metadata. The desktop host
  constructs only services that are both declared and host-granted; unknown permissions, malformed
  entry basenames and manifest/module/catalog identity mismatches fail closed. The current public
  surface includes immutable active-document snapshots/events, declarative document headers and
  collection/form/reader views, manifest-declared commands/keybindings, Markdown-only read/watch
  access, version-checked active-buffer edits, planned create-only text batches, Markdown
  navigation, declarative editor features and versioned JSON workspace storage; plugins never
  receive CodeMirror instances, mount elements, browser events, raw DOM, native paths, object URLs
  or Tauri handles. Media editor features require both `editor.extensions` and the independent
  `workspace.writeMedia` permission.
- Plugin storage is namespaced by plugin ID plus a SHA-256 workspace identity. Values are bounded
  to 64 KiB and each namespace to 1 MiB, with serialization, quota and unavailable failures returned
  as typed results. Document-scoped state moves only when an application-owned rename explicitly
  requests a rollback-safe migration; an external rename is intentionally treated as a new document.
- The runtime owns discovery and lifecycle cleanup. Build emits each official plugin as a separate
  asset plus a deterministic catalog containing a validated manifest, entry basename, content hash
  and literal loader. Failed activation rolls back collected subscriptions; provider/render failure
  disables only the owning plugin and disposes its resources; normal deactivation runs in reverse
  registration order. The host also force-releases plugin-owned commands, views, document
  providers/listeners and workspace watchers when activation or disposal code fails. Repeated
  discovery is idempotent and never silently retries a failed plugin.
- Official plugins may import only `@mdular/plugin-sdk` plus their own source and manifest data;
  package dependency and forbidden-global rules are checked by `npm run check:architecture`.
- Cross-package imports must use an entry declared by the target package's `exports` map. Relative
  cross-package paths, hidden package subpaths and Node.js builtins are rejected.
- Platform and Core compile under strict TypeScript with no DOM library types. Application
  composition roots compile separately with DOM types; only `apps/desktop` may import Tauri APIs.

## Runtime migration edge

`src/index.html` is the HTML source authority. The generated page initially loads only the build
stamp and `runtime-bootstrap.js`; the bootstrap resolves `legacy|v2` before either application root
registers listeners or mutates the DOM. Desktop resolution uses app-config `runtime-mode.json` with
an optional process-only environment override. Browser preview uses a namespaced localStorage
mirror. Invalid values fail safe to `legacy` and are not rewritten automatically.

Before V2 activation, an idempotent migration copies an allowlist of v0.0.5 localStorage
preferences into a versioned import namespace and writes its completion marker last. The original
keys remain untouched. Tauri setup separately validates versioned app-config inputs and writes a
private atomic app-data inventory ledger; any read, schema or persistence failure forces the
current process to legacy. The complete store and rollback inventory is defined in
[`v0.1.0-storage-migration.md`](./v0.1.0-storage-migration.md).

Legacy scripts load in their characterized V1 order and finish in the single
`legacy-bootstrap.js` edge. V2 dynamically loads only its namespaced stylesheet plus the existing
CodeMirror 5 base/Markdown mode before exactly one bundled composition root: `apps/desktop` for
Tauri or the explicitly degraded `apps/web` preview. This leaves the characterized legacy DOM and
script order unchanged. Switching modes requires a restart.

The desktop V2 root now exposes an explicit workspace picker/file refresh, a validated
workspace-relative path input, primary/secondary CodeMirror panes and explicit save. A user edit is
covered end-to-end through `SessionEditorBinding`, `DocumentSession`, optimistic host write and
recovery removal. The CodeMirror model spike plus desktop fixture prove
`linkedDoc({ sharedHist: true })` content/history sharing, different-session isolation, independent
view fields, unlink/close behavior and narrow-layout fallback. Real WebView IME, focus/scroll
restoration and two-pane visual interaction remain acceptance gates. Each pane also owns an
explicit read-only Diff toggle that does not consume the secondary pane; close restores the
captured editor view, and edits cancel stale worker requests before starting a new version.

The first bundled consumer is the Docs Metadata slice. It recognizes only a bounded lexical
frontmatter envelope (512 lines or 64 KiB), reports duplicate/missing-close/limit failures as an
explicit invalid summary, and renders scalar previews through declarative text-only view models.
Non-Markdown documents, paths excluded by the shared document-policy extension point and documents
without frontmatter contribute no header. The Chat plugin contributes `Chat.md` to that policy; if
Chat is disabled, Docs treats the file as ordinary Markdown again. New
documents start collapsed; expansion is isolated by workspace and document path and is shared by
both panes because it is plugin state rather than editor state. This parser is read-only and is not
the future round-trip frontmatter writer. The production build and watch paths both regenerate the
separate plugin asset, catalog hash and launcher stamp.

The second bundled consumer is Search. It owns a private, bounded full-text index (10,000 Markdown
documents, 2 MiB per document, 32 MiB indexed text, 100 displayed results) and a storage cache that
stays below the plugin storage value quota. Filename/path/body matching, `in:`/`path:` scope,
folder browse, `#tag` and supported frontmatter fields are parsed inside the plugin. The host polls
the symlink-safe Markdown inventory and emits only relative created/changed/deleted/reset hints;
the plugin re-reads host truth and treats a rename as delete plus create. A malformed cache is
removed and rebuilt, document-policy exclusions are rebuilt dynamically, and no Workspace bytes
are changed. Chat owns the `Chat.md` exclusion; disabling it makes that document searchable without
leaving a Search special case. Results are bounded
declarative text/highlight models: the host creates all DOM with `textContent`, owns focus and
keyboard behavior, and opens a selected relative Markdown path through the navigation capability.
Deactivation removes its toolbar command, `Mod+K`/`Mod+P` shortcuts, overlay state, index work and
poll watcher; Core's path input and open/save flow remain independent.

The third bundled consumer is Templates. Built-in plain/frontmatter definitions, user custom
Markdown templates and the editable docs/issues/changelog scaffold package are plugin-owned data;
Core contains none of those product defaults. `${title}`, `${date}`, `${path}` and `${filename}`
are the only accepted variables, and generated content plus every destination/disposition is shown
before commit. The public batch service validates at most 128 workspace-relative text targets,
2 MiB per file and 8 MiB total, then returns an opaque plugin-owned plan token. Commit reaches a
native create-new-only command, stops at the first race or I/O failure and returns the exact created
set without overwriting an existing file. Current-session rollback deletes only receipts whose
SHA-256 still matches the bytes created by that batch; user-modified files are retained. A partial
batch stores a bounded private continuation record, so a later session can re-plan with existing
paths visibly skipped, while rollback correctly remains unavailable after the host token is gone.
Deactivation releases unused plan/rollback tokens and declarative form state; it never deletes
workspace files automatically.

The fourth bundled consumer is Chat. `Mod+Enter` and `Mod+Shift+Enter` reveal its independent
declarative view; no idle timer changes the active view. Its bounded V1-compatible Markdown model
owns timestamps, completion, multiline escaping, duplicate-safe locators, visible batch selection,
deletion and archive actions. Existing Markdown changes use plugin-owned optimistic edit tokens;
conflicts are rebased against fresh host truth up to a fixed bound, and destructive actions never
recreate an externally deleted `Chat.md`. Missing destinations use create-new-only text plans, so
Journal/checklist/recent-file/archive writes cannot overwrite a raced file creation.

Archive providers use the namespaced `mdular.chat.archive-targets` extension point and exchange
bounded JSON only. Provider failure leaves the source message intact; a destination success followed
by a source conflict is reported as a partial result rather than hidden. Chat also registers its
`Chat.md` Search/Metadata exclusions through `mdular.documents.policy`, which Docs and Search consume
dynamically. The host owns DOM, plain-text rendering, item motion and reduced-motion behavior.
Deactivation removes both shortcuts, view/listener/watcher state, edit/plan tokens and extension
registrations; Core contains no Chat path, timer or save branch.

The fifth bundled consumer completes Docs. Its reading surface converts bounded Markdown into
plain-text heading, paragraph, quote, list, code, nested-document and workspace-image models; the
host alone renders DOM, resolves images and owns lightbox behavior. `![[relative.md]]` includes are
limited to depth 3, 16 documents, 4 MiB total input, 500 rendered blocks and a cycle-safe visited
set. The same view provides an internal TOC plus a docs/ browser; outline activation scrolls only
to host-owned block IDs, and selecting a document opens it through the navigation capability.

Cover and body images accept only canonical workspace-relative PNG/JPEG/GIF/WebP/AVIF/BMP paths.
The native resolver rejects traversal, links and reparse points; the desktop asset host keys cached
object URLs by path plus host mtime, limits files to 8 MiB, the cache to 32 MiB/64 entries and loads
to three concurrent files. Images use browser lazy loading, one consistent unavailable placeholder,
host-owned focus/alt/cover/thumbnail presentation and leases that revoke object URLs on view close,
workspace reset or application disposal. SVG and arbitrary/data/network URLs are not accepted.

Frontmatter writing deliberately uses a separate 2 MiB/2,048-line round-trip parser. It changes
only selected safe top-level scalars while retaining BOM/EOL, unknown fields, comments, ordering,
delimiters, complex YAML and the entire body. A preview is required before apply. Apply is an
optimistic `path + bufferVersion` edit of the active Core session, not a filesystem write; stale
buffers are returned without overwrite, the editor remains dirty until explicit Save, recovery is
scheduled, and pane selections are remapped across the replacement. Documents without frontmatter
show neither the Metadata header nor a frontmatter form. Metadata expansion remains versioned
workspace-and-document plugin state.

Docs also registers `To Docs` through `mdular.chat.archive-targets`. It creates a unique
`docs/<title>.md` only through the create-new batch service and returns success before Chat removes
the source. Core has no docs/ path, reader, YAML, image or archive special case. Reader blocks,
cover focus, nested boundaries, form transitions and the lightbox use host-owned motion styles;
reduced-motion disables movement while focus, selection and loading/error state remain visible.

The sixth and seventh bundled consumers are Extended Markdown and Media. Extended Markdown
registers only a declarative feature set. The desktop editor adapter owns the CodeMirror mode and
table keymap, bounded Mermaid/KaTeX widgets, lazy known-language scripts and wiki-link navigation.
Mermaid is initialized with strict security and HTML labels disabled; returned SVG is parsed as
SVG, active/foreign elements, event attributes, external URLs and unsafe CSS are removed before the
host adopts nodes. KaTeX runs with trust disabled. A missing or failed renderer leaves the Markdown
source editable and removes stale widgets on document changes or plugin deactivation.

Media likewise registers only the `media` editor feature. The host accepts an allowlisted
image/audio/video MIME set from paste or drop, reads at most 16 MiB, generates one normalized
`media/<timestamp>-<name>.<ext>` target and invokes a native create-new-only write. The native host
independently checks the path, MIME/extension pair, base64 bound, regular directory ancestry and
link/reparse policy, then flushes and syncs the new file and returns a SHA-256 receipt. Only after
that receipt does the desktop apply the link to the expected Core `bufferVersion` and synchronously
persist recovery. A stale buffer or recovery failure reverts the in-memory edit and asks native
rollback to delete only a byte-identical receipt; a concurrently changed asset is retained. This is
a bounded recoverable workflow, not a claim of a cross-filesystem atomic transaction.

Media previews accept only direct local `media/` paths. The native read double-checks type,
regular-file status, 16 MiB size and mtime before/after reading. The shared object-URL cache is
limited to 32 MiB, 64 entries and three concurrent loads; leases are released on rerender,
deactivation, workspace reset and application disposal. The host owns image lazy loading, muted
looping video, controlled audio and a focus-returning ESC/backdrop lightbox. Reduced-motion removes
the lightbox transition without removing its focus or state feedback.

The eighth bundled consumer is Kanban. It owns the `issues/` convention, the version 1 status and
column configurations, board/list grouping, filters, workspace-scoped presets and new-issue
defaults; Core contains none of those workflow rules. The public view adapter accepts only bounded
board columns, cards, fields and actions. The host creates text-only DOM, owns every drag listener
and clears drag state on rerender, hide, plugin release or disposal. Both host and plugin recheck
locked columns and card eligibility before a drop becomes a write.

Issue updates use plugin-owned optimistic Markdown edit tokens and replay a scalar frontmatter
patch against fresh host truth up to a fixed bound. The patch adds `kanbanSchema: 1` when needed,
rejects future schemas, and retains BOM, dominant EOL, body, comments, complex YAML and unknown
fields. Status/column JSON uses separately permissioned bounded text reads and edits; Markdown and
text tokens cannot be exchanged. Unknown JSON properties survive validation and serialization,
future versions fail closed, and an unreadable or over-budget configuration cannot be saved.
Missing configuration stays an in-memory default until the user explicitly creates or saves it.

New issues and the optional Chat `To Issues` provider use create-new-only text plans, with collision
suffixes and no direct dependency on Chat internals, legacy globals or the scaffold implementation.
Kanban caps issue count and aggregate text, stores only versioned layout/filter/preset state, and
releases its command shortcuts, declarative view, drag DOM, watcher, extension contribution and
owned edit/plan tokens on deactivation. Disabling it leaves ordinary `issues/*.md` documents
available to Core as normal Markdown.

The ninth bundled consumer is VCS. Core exposes only immutable save state for the currently open
sessions; it does not detect repositories, compute repository dirty state, own branch names or run
commands. The plugin merges those save-state flags with host-returned Git/SVN status and renders
status and diff through existing declarative collection/reader views. It never receives an
executable, argument array, shell string, absolute workspace path or cwd.

`process.vcs` is a separate manifest permission and the desktop composition root grants its service
only to the exact bundled `mdular.vcs` identity/version/entry. The native broker detects real
`.git`/`.svn` directories (Git wins), rejects linked marker directories, chooses executables from a
small platform-specific absolute allowlist outside the workspace and runs only fixed status/diff
subcommands with the workspace root as cwd. User-controlled diff input is a validated workspace-
relative path placed after `--`; Git external diff/textconv and fsmonitor are disabled. Commands
have a five-second timeout, bounded stdout/stderr, at most 2,000 status entries and at most 2 MiB
per diff section. SVN uses its internal diff and ignores externals.

External clients are likewise an enum, not a command line: platform default, SourceGit,
TortoiseGit, Explorer or Finder. The native side resolves only fixed application/executable
locations, rejects links and workspace-contained executables, fixes every argument and launches
with the bound workspace as cwd. Unsupported platform/client combinations fail closed. Plugin
release revokes an ownership generation so retained or pre-reactivation service references cannot
invoke later. Disabling VCS removes its commands, document listeners and view without changing the
workspace or Core save behavior.

## Updater and release boundary

The native host exclusively owns update discovery, download, signature verification and install.
Rust and npm pin updater `2.10.1` exactly. The WebView has neither the updater default capability
nor process/restart capability; it may only answer the current host-owned
`update-prepare-restart` request through `updater_respond_prepare_restart`. One install and one
handshake may be active. The host downloads and verifies bytes in memory, waits up to 60 seconds
for Core to flush current recovery, and discards the bytes on timeout, cancellation, conflict,
save/recovery failure, malformed response or stale request. Installation starts only after a
typed `ready` response. The legacy root provides a conservative compatibility responder that
blocks while either editor/Chat is dirty or a save/mutation is active.

macOS in-app installation remains unconditionally disabled until restore-on-failure behavior is
independently proven. Discovery may report a newer version, but the user is directed to the manual
DMG path; this code does not interpret successful compilation or signature verification as proof
that the old `.app` survives every installer failure.

The desktop workflow separates two authorities:

- A manually dispatched candidate matrix receives no signing secret, overlays
  `tauri.ci.json`, asserts that no `.sig`, `.app.tar.gz` or `latest.json` exists, and uploads only
  short-lived installers. Each runner executes the Rust all-target suite before packaging so Linux
  xattr and Windows named-stream/sharing fixtures become native candidate gates.
- A matching version tag enters a protected release environment. Four isolated jobs build signed
  Windows x64, macOS arm64/x86_64 and Linux x64 artifacts with the immutable
  `tauri-action@action-v1.0.0`, but do not create or mutate a Release.
- One aggregator requires all four inventories, verifies hashes, validates exact platform
  coverage/URLs/notes/date, cryptographically verifies every artifact with the configured
  Minisign public key, and emits the sole `latest.json`.
- Only that aggregator may create or update an existing Draft. It refuses a non-Draft Release and
  never publishes; tag creation, asset review and Publish remain release-owner actions.

## Deliberately deferred

An isolated macOS spike of `atomic-write-file 0.3.1` passed normal commit, discard, drop cleanup and
Unix mode preservation, but lost timestamps/xattrs and left a sibling temporary file after a
commit-stage replacement failure. It is therefore not a repository dependency; the in-repository
implementation owns failure cleanup and platform metadata handling directly. Abrupt process death
may still leave a private `.workspace-write-*` sibling; the bounded seven-day cleanup handles that
namespace on a later session without following links. Native watch emission is implemented, while
manual IME/focus/scroll/Split/Diff visual acceptance is still pending. Updater handshake and release
assembly are implemented, but real four-runner CI, installer behavior, macOS restore-on-failure and
public upgrade acceptance remain separate gates.

The current runtime accepts only trusted modules that the host has already bundled. Manifest schema
validation and capability brokerage protect host boundaries but do not make in-process code a
security sandbox. Installation, Registry/download trust, signatures and process isolation remain
separate requirements before third-party plugins can be enabled.

Docs, Search, Templates, Chat, Extended Markdown, Media, Kanban and VCS have moved through public
SDK boundaries. Their legacy implementations remain reachable only through the explicit legacy
runtime rollback path. Disabling all official plugins continues to leave Core document editing and
saving operational.
