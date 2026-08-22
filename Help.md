# mdular

Local-first markdown workspace. Your notes stay as plain `.md` files on disk.

## First steps

1. Click **Open folder** and choose your notes or project docs directory.

2. Check **Allow on every visit** (Chrome/Edge) so the app can save files.

3. Press **Ctrl+Enter** to open **Chat** — quick capture for ideas and tasks.

4. Optional: install as PWA from the browser menu (*Install mdular*).

5. Optional plugins: add `.mdular/config.json` in your workspace (see below).

Without a bound folder, data may live in browser storage only (not recommended).

## Plugins

Enable plugins with `.mdular/config.json`:

```json
{
  "plugins": ["docs", "kanban"]
}
```

### Kanban (`issues/`)

- **Ctrl+Shift+B** — open the ticket board
- Toolbar: scaffold project docs, board/list toggle, column & status settings
- Filter by assignee, tag, or priority; save named filter presets
- **Chat archive**: **To Issues** (ticket frontmatter + status) or **To Docs** (plain doc in `docs/`)
- Config files: `issues/ticket-statuses.json`, `issues/ticket-board.json`

| Hotkey | Action |
| -------- | -------- |
| `[` | Insert a link to a file |
| `Cmd+K` / `Ctrl+K`| Open file search modal |
| `Cmd+N` / `Ctrl+N`| New file |
| `Cmd+M` / `Ctrl+M`| Move file |
| `Cmd+D` / `Ctrl+D`| Delete file |
| `Cmd+Enter` / `Ctrl+Enter`| Open chat |
| `Cmd+Shift+Enter` / `Ctrl+Shift+Enter`| Toggle chat dialog |
| `Cmd+[` / `Ctrl+[`| Go to previous file   |
| `Cmd+]` / `Ctrl+]`| Go to next file  |
| `Cmd+~` / `Ctrl+~`| Toggle sidebar |
| `Cmd+B` / `Ctrl+B`| Toggle **bold** formatting |
| `Cmd+I` / `Ctrl+I`| Toggle *italic* formatting |
| `Cmd` / `Ctrl` + `Click`| Copy from `code` element |
| `Cmd` / `Ctrl` + `Click`| Open a link  |
| `Ctrl` + `Cmd` + `Space`| Insert emoji (MacOS) |

## Markdown Guide

Create headers with `# header`.
Add more # symbols for smaller headers: `## smaller header`.

## Text Formatting
- **Bold text** using `**bold**` **(Cmd/Ctrl + B)**
- *Italic text* using `*italic*` **(Cmd/Ctrl + I)**
- ***Bold and italic*** using `***text***`
- ~~Strikethrough~~ using `~~text~~`
- `Inline code` using backticks

## Link
You can insert your own links by typing `[`.

## List
- First item
- Second item
  - Third item

1. First item
2. Second item
   1. Third item

## Checklist
- [x] Completed task
- [ ] Incomplete task

Syntax:
`- [ ] Item`

## Image
![](img/tomas_sanchez.jpg)

*You can paste your own images via `Cmd/Ctrl + V`*

## Blockquote
>This is a blockquote. It can span multiple lines and is great for highlighting important information or quotes from other sources.

Syntax:
`> This is a blockquote`

## Code Block
```
Here is some code.
```

## Math
$\LaTeX$ is fully supported: $e^{i\pi} + 1 = 0$

