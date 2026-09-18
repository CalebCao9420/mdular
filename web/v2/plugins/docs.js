// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function documentStorageKey(path, localKey) {
  if ("" === path || "" === localKey) {
    throw new Error("Document storage path and local key must not be empty");
  }
  return `document:${encodeURIComponent(path)}:${encodeURIComponent(localKey)}`;
}
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

// plugins/official/docs/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.docs",
  name: "Docs",
  version: "0.1.0",
  entry: "docs.js",
  description: "Official reading, outline, frontmatter and document browsing tools.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "documents.editActive",
    "documents.readActive",
    "extensions.consume",
    "extensions.register",
    "navigation.openMarkdown",
    "ui.documentHeader",
    "ui.views",
    "storage.workspace",
    "workspace.readMarkdown",
    "workspace.writeTextBatch",
    "workspace.watchMarkdown"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.docs.open-reader",
        title: "Docs: Open Reading View",
        defaultKeybindings: ["Mod+Shift+R"]
      },
      {
        id: "mdular.docs.open-outline",
        title: "Docs: Open Outline",
        defaultKeybindings: ["Mod+Shift+O"]
      },
      {
        id: "mdular.docs.browse",
        title: "Docs: Browse docs/",
        defaultKeybindings: ["Mod+Shift+D"]
      },
      {
        id: "mdular.docs.edit-frontmatter",
        title: "Docs: Edit Frontmatter"
      }
    ],
    documentHeaders: [
      {
        id: "metadata",
        title: "Metadata"
      }
    ],
    views: [
      {
        id: "docs",
        title: "Docs",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/docs/src/chat-archive.ts
var TITLE_MAX = 100;
var TEXT_MAX = 64 * 1024;
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function dateIso(now) {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function imageFallbackTitle(now) {
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `Img ${day}.${month}.${year} ${hour}:${minute}`;
}
function capitalize(value) {
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}
function splitTitleAndBody(text, now) {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const lines = normalized.split("\n");
  let title = capitalize((lines[0] ?? "").trim());
  if (/!\[.*?\]\(.*?\)/u.test(title)) {
    title = 1 < lines.length ? capitalize((lines[1] ?? "").trim()) : "";
    if ("" === title) {
      title = imageFallbackTitle(now);
    }
  }
  if (TITLE_MAX < [...title].length) {
    title = `${[...title].slice(0, TITLE_MAX).join("")}...`;
  }
  if ("" === title) {
    title = "Untitled";
  }
  let body = normalized;
  if (title === body) {
    body = "";
  } else if (body.startsWith(title)) {
    body = body.slice(title.length).trim();
  }
  return { title, body };
}
function archiveBasename(title) {
  const normalized = title.normalize("NFKC").replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/gu, "").replace(/[ ]+$/gu, "").replace(/[ \t]+/gu, " ").trim().slice(0, 120);
  if ("" === normalized || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(normalized)) {
    return "untitled";
  }
  return normalized;
}
function yamlScalar(value) {
  return value === value.trim() && !/[\r\n#:[\]{},&*!|>'"%@`]/u.test(value) && !/^(?:~|null|true|false|yes|no|on|off|[-+]?(?:\d+(?:\.\d+)?|\.inf|\.nan)|\d{4}-\d{2}-\d{2})$/iu.test(value) ? value : JSON.stringify(value);
}
function buildDocsArchiveContent(text, now = /* @__PURE__ */ new Date()) {
  const { title, body } = splitTitleAndBody(text, now);
  return {
    title,
    content: [
      "---",
      `title: ${yamlScalar(title)}`,
      `date: ${dateIso(now)}`,
      "tags:",
      "---",
      "",
      ...body ? [body, ""] : []
    ].join("\n")
  };
}
async function archiveChatMessageToDocs(request, workspace, now = /* @__PURE__ */ new Date()) {
  if (!isRecord(request) || 1 !== request.schemaVersion || "string" !== typeof request.text || "" === request.text.trim() || TEXT_MAX < request.text.length) {
    throw new Error("Docs archive request is malformed or exceeds the limit");
  }
  const built = buildDocsArchiveContent(request.text, now);
  const basename = archiveBasename(built.title);
  for (let index = 0; index < 1e3; index += 1) {
    const suffix = 0 === index ? "" : ` (${String(index)})`;
    const path = `docs/${basename}${suffix}.md`;
    const plan = await workspace.planTextWrites(
      [{ path, content: built.content }],
      "skip-existing"
    );
    const result = await workspace.commitTextWritePlan(plan.planId);
    if (result.created.includes(path)) {
      return { schemaVersion: 1, path };
    }
    if ("partial" === result.status && !/exist/iu.test(result.failed.kind)) {
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
  }
  throw new Error("No unique Docs archive filename was available");
}

// plugins/official/docs/src/frontmatter-roundtrip.ts
var FRONTMATTER_ROUNDTRIP_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * 1024 * 1024,
  maxFrontmatterBytes: 256 * 1024,
  maxFrontmatterLines: 2048,
  maxFieldValueLength: 4096,
  maxUpdates: 32
});
function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
function logicalLines(content) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if ("\n" !== character && "\r" !== character) {
      continue;
    }
    const eol = "\r" === character && "\n" === content[index + 1] ? "\r\n" : character;
    lines.push({ text: content.slice(start, index), start, end: index, eol });
    if ("\r\n" === eol) {
      index += 1;
    }
    start = index + 1;
  }
  lines.push({ text: content.slice(start), start, end: content.length, eol: "" });
  return lines;
}
function inlineCommentIndex(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ('"' === quote) {
      if (escaped) {
        escaped = false;
      } else if ("\\" === character) {
        escaped = true;
      } else if ('"' === character) {
        quote = null;
      }
      continue;
    }
    if ("'" === quote) {
      if ("'" === character && "'" === value[index + 1]) {
        index += 1;
      } else if ("'" === character) {
        quote = null;
      }
      continue;
    }
    if ('"' === character || "'" === character) {
      quote = character;
      continue;
    }
    if ("#" === character && (0 === index || /[ \t]/u.test(value[index - 1] ?? ""))) {
      return index;
    }
  }
  return -1;
}
function decodeScalar(raw) {
  const trimmed = raw.trim();
  if ("" === trimmed) {
    return { editable: true, value: "" };
  }
  if (/^(?:[|>{\[]|-[ \t]|[&*!?][^\s]?)/u.test(trimmed)) {
    return { editable: false };
  }
  if ('"' === trimmed[0]) {
    try {
      const decoded = JSON.parse(trimmed);
      return "string" === typeof decoded ? { editable: true, value: decoded } : { editable: false };
    } catch {
      return { editable: false };
    }
  }
  if ("'" === trimmed[0]) {
    if (2 > trimmed.length || "'" !== trimmed.at(-1)) {
      return { editable: false };
    }
    return { editable: true, value: trimmed.slice(1, -1).replaceAll("''", "'") };
  }
  return { editable: true, value: trimmed };
}
function parse(content) {
  if (FRONTMATTER_ROUNDTRIP_LIMITS.maxDocumentBytes < byteLength(content)) {
    return { kind: "invalid", reason: "document-limit" };
  }
  const bomOffset = content.startsWith("\uFEFF") ? 1 : 0;
  const source = content.slice(bomOffset);
  const lines = logicalLines(source);
  if ("---" !== lines[0]?.text) {
    return { kind: "none" };
  }
  let scannedBytes = byteLength(lines[0]?.text ?? "") + (lines[0]?.eol.length ?? 0);
  let close = null;
  const fields = [];
  const seen = /* @__PURE__ */ new Set();
  let lastField = null;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_ROUNDTRIP_LIMITS.maxFrontmatterLines <= index) {
      return { kind: "invalid", reason: "frontmatter-limit" };
    }
    const sourceLine = lines[index];
    const line = {
      ...sourceLine,
      start: sourceLine.start + bomOffset,
      end: sourceLine.end + bomOffset
    };
    scannedBytes += byteLength(sourceLine.text) + sourceLine.eol.length;
    if (FRONTMATTER_ROUNDTRIP_LIMITS.maxFrontmatterBytes < scannedBytes) {
      return { kind: "invalid", reason: "frontmatter-limit" };
    }
    if ("---" === sourceLine.text) {
      close = line;
      break;
    }
    if ("" === sourceLine.text.trim() || sourceLine.text.trimStart().startsWith("#")) {
      continue;
    }
    if (/^[ \t]/u.test(sourceLine.text) || /^-[ \t]/u.test(sourceLine.text)) {
      if (lastField && "" === lastField.value) {
        Object.assign(lastField, { editable: false, value: void 0 });
      }
      continue;
    }
    const declaration = /^([A-Za-z0-9_.-]+)(:[ \t]*)(.*)$/u.exec(sourceLine.text);
    if (!declaration) {
      lastField = null;
      continue;
    }
    const key = declaration[1] ?? "";
    if (seen.has(key)) {
      return { kind: "invalid", reason: "duplicate-key", duplicateKey: key };
    }
    seen.add(key);
    const raw = declaration[3] ?? "";
    const commentIndex = inlineCommentIndex(raw);
    const valuePart = -1 === commentIndex ? raw : raw.slice(0, commentIndex);
    const trailing = /[ \t]*$/u.exec(valuePart)?.[0] ?? "";
    const scalar = decodeScalar(valuePart.slice(0, valuePart.length - trailing.length));
    const field = {
      key,
      ...scalar,
      line,
      prefix: `${declaration[1] ?? ""}${declaration[2] ?? ":"}`,
      suffix: `${trailing}${-1 === commentIndex ? "" : raw.slice(commentIndex)}`
    };
    fields.push(field);
    lastField = field;
  }
  if (!close) {
    return { kind: "invalid", reason: "missing-close" };
  }
  return {
    fields,
    close,
    eol: lines[0]?.eol || close.eol || "\n"
  };
}
function isParsed(value) {
  return !("kind" in value);
}
function parseRoundTripFrontmatter(content) {
  const parsed = parse(content);
  if (!isParsed(parsed)) {
    return parsed;
  }
  return {
    kind: "frontmatter",
    fields: parsed.fields.map(({ key, value, editable }) => ({
      key,
      editable,
      ...void 0 === value ? {} : { value }
    }))
  };
}
function encodedScalar(value) {
  if ("" === value) {
    return "";
  }
  if (value === value.trim() && !/[\r\n#:[\]{},&*!|>'"%@`]/u.test(value) && !/^(?:-|\?|:)[ \t]/u.test(value) && !/^(?:~|null|true|false|yes|no|on|off|[-+]?(?:\d+(?:\.\d+)?|\.inf|\.nan)|\d{4}-\d{2}-\d{2})$/iu.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
function updateRoundTripFrontmatter(content, updates) {
  const entries = Object.entries(updates);
  if (FRONTMATTER_ROUNDTRIP_LIMITS.maxUpdates < entries.length || entries.some(([key, value]) => !/^[A-Za-z0-9_.-]+$/u.test(key) || "string" !== typeof value || FRONTMATTER_ROUNDTRIP_LIMITS.maxFieldValueLength < value.length)) {
    return { ok: false, reason: "Frontmatter updates are malformed or exceed the limit" };
  }
  const parsed = parse(content);
  if (!isParsed(parsed)) {
    return {
      ok: false,
      reason: "none" === parsed.kind ? "Document has no frontmatter" : `Frontmatter is not safely editable: ${parsed.reason}`
    };
  }
  const byKey = new Map(parsed.fields.map((field) => [field.key, field]));
  for (const [key] of entries) {
    const existing = byKey.get(key);
    if (existing && !existing.editable) {
      return { ok: false, reason: `Frontmatter field is complex and cannot be edited: ${key}` };
    }
  }
  const replacements = entries.flatMap(([key, value]) => {
    const existing = byKey.get(key);
    return existing ? [{
      start: existing.line.start,
      end: existing.line.end,
      text: `${existing.prefix}${encodedScalar(value)}${existing.suffix}`
    }] : [];
  }).sort((left, right) => right.start - left.start);
  let result = content;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  const missing = entries.filter(([key]) => !byKey.has(key));
  if (0 < missing.length) {
    const shift = replacements.filter((replacement) => replacement.start < parsed.close.start).reduce((total, replacement) => total + replacement.text.length - (replacement.end - replacement.start), 0);
    const insertionAt = parsed.close.start + shift;
    const insertion = missing.map(([key, value]) => `${key}: ${encodedScalar(value)}${parsed.eol}`).join("");
    result = result.slice(0, insertionAt) + insertion + result.slice(insertionAt);
  }
  return { ok: true, content: result, changed: result !== content };
}

// plugins/official/docs/src/reading.ts
var DOCS_READER_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxDocuments: 16,
  maxDepth: 3,
  maxBlocks: 500,
  maxOutline: 256,
  maxParagraphLength: 64 * 1024
});
function byteLength2(value) {
  return new TextEncoder().encode(value).byteLength;
}
function normalizeWorkspacePath(value, basePath = "") {
  if ("string" !== typeof value || "" === value || value.includes("\\")) {
    return null;
  }
  let raw = value.trim();
  if (raw.startsWith("<") && raw.endsWith(">")) {
    raw = raw.slice(1, -1).trim();
  }
  if ("" === raw || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw) || raw.startsWith("//")) {
    return null;
  }
  const rootRelative = raw.startsWith("/");
  const segments = (rootRelative ? raw.slice(1) : `${basePath}${raw}`).split("/");
  const normalized = [];
  for (const segment of segments) {
    if ("" === segment || "." === segment) {
      continue;
    }
    if (".." === segment) {
      if (0 === normalized.length) {
        return null;
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return 0 === normalized.length ? null : normalized.join("/");
}
function directoryOf(path) {
  const index = path.lastIndexOf("/");
  return -1 === index ? "" : path.slice(0, index + 1);
}
function filenameTitle(path) {
  const basename = path.split("/").at(-1) ?? path;
  return basename.replace(/\.md$/iu, "") || "Untitled";
}
function frontmatterBody(content) {
  const bomLength = content.startsWith("\uFEFF") ? 1 : 0;
  const source = content.slice(bomLength);
  const opener = /^(---)(\r\n|\n|\r)/u.exec(source);
  if (!opener) {
    return source;
  }
  let offset = opener[0].length;
  while (offset <= source.length) {
    const end = source.slice(offset).search(/\r\n|\n|\r/u);
    const lineEnd = -1 === end ? source.length : offset + end;
    if ("---" === source.slice(offset, lineEnd)) {
      if (-1 === end) {
        return "";
      }
      const eol2 = /^(?:\r\n|\n|\r)/u.exec(source.slice(lineEnd))?.[0] ?? "";
      return source.slice(lineEnd + eol2.length);
    }
    if (-1 === end) {
      break;
    }
    const eol = /^(?:\r\n|\n|\r)/u.exec(source.slice(lineEnd))?.[0] ?? "";
    offset = lineEnd + eol.length;
  }
  return source;
}
function scalarFields(content) {
  const parsed = parseRoundTripFrontmatter(content);
  if ("frontmatter" !== parsed.kind) {
    return /* @__PURE__ */ new Map();
  }
  return new Map(parsed.fields.flatMap((field) => field.editable && void 0 !== field.value ? [[field.key, field.value]] : []));
}
function coverFocus(value) {
  if (!value || "center" === value.trim().toLocaleLowerCase("en-US")) {
    return { x: 50, y: 50 };
  }
  const matches = value.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  return {
    x: Math.max(0, Math.min(100, matches[0] ?? 50)),
    y: Math.max(0, Math.min(100, matches[1] ?? 50))
  };
}
function coverFromFields(path, fields, presentation) {
  const raw = fields.get("cover")?.trim();
  if (!raw) {
    return void 0;
  }
  const resolved = normalizeWorkspacePath(raw, directoryOf(path));
  if (!resolved) {
    return void 0;
  }
  const focus = coverFocus(fields.get("cover_focus"));
  return {
    path: resolved,
    alt: fields.get("cover_alt") ?? fields.get("title") ?? filenameTitle(path),
    presentation,
    focusX: focus.x,
    focusY: focus.y
  };
}
function firstHeading(content) {
  let inFence = false;
  let fence = "";
  for (const line of frontmatterBody(content).split(/\r\n|\n|\r/u)) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!inFence) {
        inFence = true;
        fence = marker[0] ?? "";
      } else if (marker[0] === fence) {
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (heading?.[2]?.trim()) {
      return heading[2].trim();
    }
  }
  return void 0;
}
function summarizeDocsDocument(path, content) {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized || !normalized.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("Docs document path is invalid");
  }
  if (DOCS_READER_LIMITS.maxDocumentBytes < byteLength2(content)) {
    throw new Error("Document exceeds the Docs reader limit");
  }
  const fields = scalarFields(content);
  const cover = coverFromFields(normalized, fields, "thumbnail");
  return {
    path: normalized,
    title: fields.get("title")?.trim() || firstHeading(content) || filenameTitle(normalized),
    ...cover ? { cover } : {}
  };
}
function nextId(budget, prefix) {
  budget.blockId += 1;
  return `${prefix}-${String(budget.blockId)}`;
}
function pushBlock(budget, block) {
  if (DOCS_READER_LIMITS.maxBlocks <= budget.blocks.length) {
    budget.truncated = true;
    return false;
  }
  budget.blocks.push(block);
  if ("heading" === block.kind) {
    if (budget.outline.length < DOCS_READER_LIMITS.maxOutline) {
      budget.outline.push({ id: block.id, label: block.text, level: block.level });
    } else {
      budget.truncated = true;
    }
  }
  return true;
}
function markdownImage(line, documentPath) {
  const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:[ \t]+["']([^"']*)["'])?\)[ \t]*$/u.exec(
    line.trim()
  );
  if (!match) {
    return null;
  }
  const target = match[2] ?? match[3] ?? "";
  const path = normalizeWorkspacePath(target, directoryOf(documentPath));
  if (!path) {
    return null;
  }
  const alt = match[1] ?? "";
  const caption = match[4] || alt || void 0;
  return {
    image: { path, alt, presentation: "content", focusX: 50, focusY: 50 },
    ...caption ? { caption } : {}
  };
}
function nestedPath(line, documentPath) {
  const match = /^!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\][ \t]*$/u.exec(line.trim());
  if (!match) {
    return null;
  }
  const raw = match[1]?.trim() ?? "";
  const withExtension = raw.toLocaleLowerCase("en-US").endsWith(".md") ? raw : `${raw}.md`;
  const resolved = normalizeWorkspacePath(withExtension, directoryOf(documentPath));
  return resolved?.toLocaleLowerCase("en-US").endsWith(".md") ? resolved : null;
}
async function appendDocument(path, content, depth, readMarkdown, budget) {
  const lines = frontmatterBody(content).split(/\r\n|\n|\r/u);
  let paragraph = [];
  let quote = [];
  let list = [];
  let ordered = false;
  let code = null;
  let codeFence = "";
  let codeLanguage = "";
  const flushParagraph = () => {
    if (0 === paragraph.length) {
      return;
    }
    pushBlock(budget, {
      id: nextId(budget, "paragraph"),
      kind: "paragraph",
      text: paragraph.join("\n").slice(0, DOCS_READER_LIMITS.maxParagraphLength)
    });
    paragraph = [];
  };
  const flushQuote = () => {
    if (0 === quote.length) {
      return;
    }
    pushBlock(budget, {
      id: nextId(budget, "quote"),
      kind: "quote",
      text: quote.join("\n").slice(0, DOCS_READER_LIMITS.maxParagraphLength)
    });
    quote = [];
  };
  const flushList = () => {
    if (0 === list.length) {
      return;
    }
    pushBlock(budget, {
      id: nextId(budget, "list"),
      kind: "list",
      items: list.slice(0, 128),
      ...ordered ? { ordered: true } : {}
    });
    list = [];
  };
  const flushText = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };
  for (const line of lines) {
    if (budget.truncated && DOCS_READER_LIMITS.maxBlocks <= budget.blocks.length) {
      break;
    }
    if (code) {
      if (new RegExp(`^\\s*${codeFence}[ \\t]*$`, "u").test(line)) {
        pushBlock(budget, {
          id: nextId(budget, "code"),
          kind: "code",
          text: code.join("\n").slice(0, DOCS_READER_LIMITS.maxParagraphLength),
          ...codeLanguage ? { language: codeLanguage } : {}
        });
        code = null;
        codeFence = "";
        codeLanguage = "";
      } else {
        code.push(line);
      }
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})[ \t]*([^\s]*)/u.exec(line);
    if (fence) {
      flushText();
      code = [];
      codeFence = fence[1] ?? "```";
      codeLanguage = (fence[2] ?? "").slice(0, 64);
      continue;
    }
    if ("" === line.trim()) {
      flushText();
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (heading) {
      flushText();
      const text = (heading[2] ?? "").replace(/\s*\[#+\]\([^)]*\)\s*$/u, "").trim();
      if (text) {
        pushBlock(budget, {
          id: nextId(budget, "heading"),
          kind: "heading",
          level: heading[1]?.length ?? 1,
          text
        });
      }
      continue;
    }
    const includePath = nestedPath(line, path);
    if (includePath) {
      flushText();
      pushBlock(budget, {
        id: nextId(budget, "nested"),
        kind: "nested",
        text: `Included document: ${includePath}`
      });
      if (depth >= DOCS_READER_LIMITS.maxDepth || budget.documents >= DOCS_READER_LIMITS.maxDocuments || budget.visited.has(includePath)) {
        budget.truncated = true;
        continue;
      }
      try {
        const nested = await readMarkdown(includePath);
        const bytes = byteLength2(nested);
        if (DOCS_READER_LIMITS.maxDocumentBytes < bytes || DOCS_READER_LIMITS.maxTotalBytes < budget.bytes + bytes) {
          budget.truncated = true;
          continue;
        }
        budget.documents += 1;
        budget.bytes += bytes;
        budget.visited.add(includePath);
        await appendDocument(includePath, nested, depth + 1, readMarkdown, budget);
        budget.visited.delete(includePath);
      } catch {
        pushBlock(budget, {
          id: nextId(budget, "nested-error"),
          kind: "nested",
          text: `Nested document unavailable: ${includePath}`
        });
      }
      continue;
    }
    const image = markdownImage(line, path);
    if (image) {
      flushText();
      pushBlock(budget, {
        id: nextId(budget, "image"),
        kind: "image",
        ...image
      });
      continue;
    }
    const quoteMatch = /^[ \t]*>[ \t]?(.*)$/u.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1] ?? "");
      continue;
    }
    const listMatch = /^[ \t]*(?:(-)|\d+\.)[ \t]+(.+)$/u.exec(line);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      const nextOrdered = void 0 === listMatch[1];
      if (0 < list.length && ordered !== nextOrdered) {
        flushList();
      }
      ordered = nextOrdered;
      list.push((listMatch[2] ?? "").slice(0, 4096));
      if (128 <= list.length) {
        flushList();
      }
      continue;
    }
    flushQuote();
    flushList();
    paragraph.push(line);
  }
  if (code) {
    pushBlock(budget, {
      id: nextId(budget, "code"),
      kind: "code",
      text: code.join("\n").slice(0, DOCS_READER_LIMITS.maxParagraphLength),
      ...codeLanguage ? { language: codeLanguage } : {}
    });
  }
  flushText();
}
async function buildDocsReaderDocument(path, content, readMarkdown) {
  const summary = summarizeDocsDocument(path, content);
  const rootBytes = byteLength2(content);
  if (DOCS_READER_LIMITS.maxDocumentBytes < rootBytes) {
    throw new Error("Document exceeds the Docs reader limit");
  }
  const budget = {
    documents: 1,
    bytes: rootBytes,
    blockId: 0,
    truncated: false,
    visited: /* @__PURE__ */ new Set([summary.path]),
    blocks: [],
    outline: []
  };
  await appendDocument(summary.path, content, 0, readMarkdown, budget);
  return {
    ...summary,
    ...summary.cover ? {
      cover: { ...summary.cover, presentation: "cover" }
    } : {},
    blocks: budget.blocks,
    outline: budget.outline,
    status: budget.truncated ? `${String(budget.documents)} document(s) \xB7 bounded preview truncated` : `${String(budget.documents)} document(s) \xB7 ${String(budget.blocks.length)} block(s)`
  };
}

// plugins/official/docs/src/controller.ts
var VIEW_ID = "docs";
var CHAT_ARCHIVE_POINT = "mdular.chat.archive-targets";
var OPEN_READER_COMMAND = "mdular.docs.open-reader";
var OPEN_OUTLINE_COMMAND = "mdular.docs.open-outline";
var BROWSE_COMMAND = "mdular.docs.browse";
var EDIT_FRONTMATTER_COMMAND = "mdular.docs.edit-frontmatter";
var MAX_BROWSE_DOCUMENTS = 200;
var BROWSE_CONCURRENCY = 4;
var EDITABLE_FIELDS = [
  "title",
  "status",
  "tags",
  "date",
  "author",
  "category",
  "cover",
  "cover_alt",
  "cover_focus"
];
function isRecord2(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord2(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function messageFrom(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
function isMarkdownSnapshot(snapshot) {
  return null !== snapshot && snapshot.path.toLocaleLowerCase("en-US").endsWith(".md");
}
function frontmatterExcerpt(content) {
  const match = /^(?:\uFEFF)?---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?=\r\n|\n|\r|$)/u.exec(content);
  return (match?.[0] ?? content).slice(0, 64 * 1024);
}
async function mapConcurrent(values, concurrency, map) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await map(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}
var DocsController = class {
  #context;
  #documents;
  #extensions;
  #navigation;
  #views;
  #workspace;
  #mode = "reader";
  #visible = false;
  #busy = false;
  #refreshRequested = false;
  #disposed = false;
  #generation = 0;
  #reader = null;
  #frontmatter = null;
  constructor(context, services) {
    this.#context = context;
    this.#documents = services.documents;
    this.#extensions = services.extensions;
    this.#navigation = services.navigation;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }
  start() {
    this.#context.subscriptions.add(this.#extensions.register(CHAT_ARCHIVE_POINT, {
      id: "mdular.docs",
      label: "To Docs",
      order: 11,
      execute: (request) => archiveChatMessageToDocs(request, this.#workspace)
    }));
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands.register(
      OPEN_READER_COMMAND,
      async () => {
        await this.#show("reader");
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#context.commands.register(
      OPEN_OUTLINE_COMMAND,
      async () => {
        await this.#show("outline");
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#context.commands.register(
      BROWSE_COMMAND,
      async () => {
        await this.#show("browse");
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#context.commands.register(
      EDIT_FRONTMATTER_COMMAND,
      async () => {
        const snapshot = this.#documents.getActiveSnapshot();
        if (!isMarkdownSnapshot(snapshot) || "none" === parseRoundTripFrontmatter(snapshot.content).kind) {
          this.#context.logger?.info("Frontmatter editor remains hidden because the active document has no frontmatter");
          return void 0;
        }
        await this.#show("frontmatter");
        return void 0;
      }
    ));
    const refreshActive = () => {
      this.#reader = null;
      this.#frontmatter = null;
      if (this.#visible && "browse" !== this.#mode) {
        void this.#refresh();
      }
    };
    this.#context.subscriptions.add(this.#documents.onDidOpen(refreshActive));
    this.#context.subscriptions.add(this.#documents.onDidChange(refreshActive));
    this.#context.subscriptions.add(this.#documents.onDidActivatePane(refreshActive));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown(() => {
      if (this.#visible) {
        void this.#refresh();
      }
    }));
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    this.#reader = null;
    this.#frontmatter = null;
    this.#views.hide(VIEW_ID);
  }
  async #show(mode) {
    if (this.#disposed) {
      return;
    }
    this.#mode = mode;
    this.#visible = true;
    await this.#refresh();
    if (!this.#disposed && this.#visible) {
      await this.#views.reveal(VIEW_ID);
    }
  }
  async #refresh() {
    if (this.#disposed) {
      return;
    }
    if (this.#busy) {
      this.#refreshRequested = true;
      this.#generation += 1;
      return;
    }
    const generation = ++this.#generation;
    this.#busy = true;
    this.#renderLoading();
    try {
      if ("browse" === this.#mode) {
        await this.#renderBrowse(generation);
      } else if ("frontmatter" === this.#mode) {
        this.#renderFrontmatter();
      } else {
        await this.#renderReaderOrOutline(generation);
      }
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) {
        return;
      }
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: "collection",
        title: "Docs",
        status: `Docs failed: ${messageFrom(error)}`,
        emptyMessage: "The document was left unchanged.",
        items: [],
        actions: this.#navigationActions()
      });
    } finally {
      this.#busy = false;
      if (this.#refreshRequested && !this.#disposed) {
        this.#refreshRequested = false;
        void this.#refresh();
      }
    }
  }
  #renderLoading() {
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Docs",
      status: "Loading bounded document view\u2026",
      busy: true,
      items: []
    });
  }
  async #loadReader() {
    const snapshot = this.#documents.getActiveSnapshot();
    if (!isMarkdownSnapshot(snapshot)) {
      throw new Error("Open a Markdown document first");
    }
    const reader = await buildDocsReaderDocument(
      snapshot.path,
      snapshot.content,
      (path) => this.#workspace.readMarkdown(path)
    );
    this.#reader = reader;
    return reader;
  }
  async #renderReaderOrOutline(generation) {
    const reader = this.#reader ?? await this.#loadReader();
    if (generation !== this.#generation || this.#disposed) {
      return;
    }
    const snapshot = this.#documents.getActiveSnapshot();
    const hasFrontmatter = isMarkdownSnapshot(snapshot) && "frontmatter" === parseRoundTripFrontmatter(snapshot.content).kind;
    if ("reader" === this.#mode) {
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: "reader",
        title: reader.title,
        sourcePath: reader.path,
        status: reader.status,
        ...reader.cover ? { cover: reader.cover } : {},
        outline: reader.outline,
        blocks: reader.blocks,
        actions: this.#navigationActions(hasFrontmatter)
      });
      return;
    }
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: `Outline \xB7 ${reader.title}`,
      status: `${String(reader.outline.length)} heading(s)`,
      emptyMessage: "No headings outside fenced code blocks.",
      items: reader.outline.map((heading) => ({
        id: heading.id,
        title: heading.label,
        badges: [`H${String(heading.level)}`]
      })),
      actions: this.#navigationActions(hasFrontmatter)
    });
  }
  async #renderBrowse(generation) {
    const paths = (await this.#workspace.listMarkdown("docs")).slice().sort((left, right) => left.localeCompare(right)).slice(0, MAX_BROWSE_DOCUMENTS);
    const summaries = [...await mapConcurrent(paths, BROWSE_CONCURRENCY, async (path) => {
      try {
        return summarizeDocsDocument(path, await this.#workspace.readMarkdown(path));
      } catch {
        return { path, title: path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path };
      }
    })].sort((left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path));
    if (generation !== this.#generation || this.#disposed) {
      return;
    }
    const items = summaries.map((summary) => ({
      id: summary.path,
      title: summary.title,
      description: summary.path,
      badges: ["docs"],
      ...summary.cover ? { image: summary.cover } : {}
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Browse Docs",
      status: `${String(items.length)} document(s)${MAX_BROWSE_DOCUMENTS === paths.length ? " \xB7 bounded list" : ""}`,
      emptyMessage: "No Markdown documents were found under docs/.",
      items,
      actions: this.#navigationActions()
    });
  }
  #createFrontmatterDraft(snapshot) {
    const parsed = parseRoundTripFrontmatter(snapshot.content);
    if ("frontmatter" !== parsed.kind) {
      return null;
    }
    const byKey = new Map(parsed.fields.map((field) => [field.key, field]));
    const original = /* @__PURE__ */ new Map();
    const values = /* @__PURE__ */ new Map();
    for (const key of EDITABLE_FIELDS) {
      const field = byKey.get(key);
      const value = field?.editable ? field.value ?? "" : "";
      original.set(key, field ? value : null);
      values.set(key, value);
    }
    return { snapshot, fields: parsed.fields, original, values, previewContent: null };
  }
  #renderFrontmatter(status) {
    const snapshot = this.#documents.getActiveSnapshot();
    if (!isMarkdownSnapshot(snapshot)) {
      throw new Error("Open a Markdown document first");
    }
    const parsed = parseRoundTripFrontmatter(snapshot.content);
    if ("none" === parsed.kind) {
      this.#frontmatter = null;
      this.#visible = false;
      this.#views.hide(VIEW_ID);
      return;
    }
    if ("invalid" === parsed.kind) {
      this.#frontmatter = null;
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: "collection",
        title: `Frontmatter \xB7 ${snapshot.path}`,
        status: `Frontmatter is not safely editable: ${parsed.reason}`,
        emptyMessage: "The document was left unchanged.",
        items: [],
        actions: this.#navigationActions()
      });
      return;
    }
    if (!this.#frontmatter || this.#frontmatter.snapshot.path !== snapshot.path || this.#frontmatter.snapshot.bufferVersion !== snapshot.bufferVersion) {
      this.#frontmatter = this.#createFrontmatterDraft(snapshot);
    }
    const draft = this.#frontmatter;
    if (!draft) {
      throw new Error("Frontmatter draft could not be created");
    }
    const byKey = new Map(draft.fields.map((field) => [field.key, field]));
    const fields = EDITABLE_FIELDS.map((key) => {
      const field = byKey.get(key);
      return {
        id: key,
        kind: "text",
        label: key,
        value: field && !field.editable ? "[complex value preserved]" : draft.values.get(key) ?? "",
        placeholder: field ? "" : "Optional; leave empty to keep absent",
        ...field && !field.editable ? { readOnly: true, description: "Complex YAML is preserved byte-for-byte and is not edited here." } : {}
      };
    });
    if (draft.previewContent) {
      fields.push({
        id: "preview",
        kind: "textarea",
        label: "Round-trip preview",
        value: frontmatterExcerpt(draft.previewContent),
        rows: 10,
        readOnly: true,
        description: "Unknown fields, comments, ordering, delimiters and body remain in place."
      });
    }
    const unknown = draft.fields.filter((field) => !EDITABLE_FIELDS.includes(
      field.key
    )).length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: `Frontmatter \xB7 ${snapshot.path}`,
      status: status ?? `${String(unknown)} unknown field(s) preserved \xB7 changes stay in the editor until Save`,
      fields,
      items: [],
      actions: [
        { id: "preview-frontmatter", label: "Preview" },
        {
          id: "apply-frontmatter",
          label: "Apply to editor",
          tone: "primary",
          disabled: null === draft.previewContent
        },
        ...this.#navigationActions()
      ]
    });
  }
  #frontmatterUpdates(draft) {
    return Object.fromEntries(EDITABLE_FIELDS.flatMap((key) => {
      const before = draft.original.get(key) ?? null;
      const after = draft.values.get(key) ?? "";
      if (null === before && "" === after) {
        return [];
      }
      return before === after ? [] : [[key, after]];
    }));
  }
  #previewFrontmatter() {
    const draft = this.#frontmatter;
    if (!draft) {
      throw new Error("Frontmatter editor is unavailable");
    }
    const result = updateRoundTripFrontmatter(
      draft.snapshot.content,
      this.#frontmatterUpdates(draft)
    );
    if (!result.ok) {
      throw new Error(result.reason);
    }
    draft.previewContent = result.changed ? result.content : null;
    this.#renderFrontmatter(result.changed ? "Preview ready \xB7 review before applying to the active editor" : "No frontmatter changes to apply");
  }
  async #applyFrontmatter() {
    const draft = this.#frontmatter;
    if (!draft?.previewContent) {
      throw new Error("Preview frontmatter changes first");
    }
    const apply = this.#documents.applyActiveEdit;
    if (!apply) {
      throw new Error("Active document editing permission is unavailable");
    }
    const result = await apply({
      path: draft.snapshot.path,
      expectedBufferVersion: draft.snapshot.bufferVersion,
      content: draft.previewContent
    });
    if ("stale" === result.status) {
      this.#frontmatter = result.current ? this.#createFrontmatterDraft(result.current) : null;
      this.#renderFrontmatter(
        "Document changed before apply \xB7 no overwrite occurred; review the fresh fields and retry"
      );
      return;
    }
    if ("read-only" === result.status) {
      throw new Error(result.message);
    }
    this.#frontmatter = this.#createFrontmatterDraft(result.snapshot);
    this.#renderFrontmatter("Frontmatter applied to the editor \xB7 use Save to persist it");
  }
  async #handleAction(action) {
    if ("dismiss" === action.type) {
      this.#visible = false;
      this.#generation += 1;
      return;
    }
    if ("field" === action.type && "frontmatter" === this.#mode) {
      const id = payloadString(action, "id");
      const value = payloadString(action, "value");
      if (!id || null === value || !EDITABLE_FIELDS.includes(id)) {
        throw new Error("Frontmatter field action is malformed");
      }
      if (4096 < value.length) {
        throw new Error("Frontmatter field exceeds the value limit");
      }
      const field = this.#frontmatter?.fields.find((candidate) => candidate.key === id);
      if (field && !field.editable) {
        throw new Error(`Complex field cannot be edited: ${id}`);
      }
      this.#frontmatter?.values.set(id, value);
      if (this.#frontmatter) {
        this.#frontmatter.previewContent = null;
      }
      return;
    }
    if ("activate" === action.type) {
      const id = payloadString(action, "id");
      if (!id) {
        throw new Error("Docs activation is malformed");
      }
      if ("browse" === this.#mode) {
        await this.#navigation.openMarkdown(id);
        this.#reader = null;
        await this.#show("reader");
        return;
      }
      if ("outline" === this.#mode) {
        const reader = this.#reader;
        if (!reader || !reader.outline.some((heading) => heading.id === id)) {
          throw new Error("Outline heading is unavailable");
        }
        this.#mode = "reader";
        await this.#renderReaderOrOutline(this.#generation);
        await this.#views.reveal(VIEW_ID);
        this.#views.revealReaderBlock(VIEW_ID, id);
      }
      return;
    }
    if ("command" !== action.type) {
      return;
    }
    const command = payloadString(action, "id");
    if (!command) {
      throw new Error("Docs command action is malformed");
    }
    if ("preview-frontmatter" === command) {
      this.#previewFrontmatter();
      return;
    }
    if ("apply-frontmatter" === command) {
      await this.#applyFrontmatter();
      return;
    }
    const mode = "reader" === command ? "reader" : "outline" === command ? "outline" : "browse" === command ? "browse" : "frontmatter" === command ? "frontmatter" : null;
    if ("refresh" === command) {
      this.#reader = null;
      this.#frontmatter = null;
      await this.#refresh();
      return;
    }
    if (!mode) {
      throw new Error(`Unknown Docs action: ${command}`);
    }
    if ("frontmatter" === mode) {
      const snapshot = this.#documents.getActiveSnapshot();
      if (!isMarkdownSnapshot(snapshot) || "none" === parseRoundTripFrontmatter(snapshot.content).kind) {
        return;
      }
    }
    await this.#show(mode);
  }
  #navigationActions(hasFrontmatter = false) {
    return [
      { id: "reader", label: "Read", disabled: "reader" === this.#mode },
      { id: "outline", label: "Outline", disabled: "outline" === this.#mode },
      { id: "browse", label: "Browse Docs", disabled: "browse" === this.#mode },
      ...hasFrontmatter ? [{ id: "frontmatter", label: "Frontmatter" }] : [],
      { id: "refresh", label: "Refresh" }
    ];
  }
};
var DOCS_COMMANDS = Object.freeze({
  openReader: OPEN_READER_COMMAND,
  openOutline: OPEN_OUTLINE_COMMAND,
  browse: BROWSE_COMMAND,
  editFrontmatter: EDIT_FRONTMATTER_COMMAND
});

// plugins/official/docs/src/metadata.ts
var METADATA_SCAN_LIMITS = Object.freeze({
  maxLines: 512,
  maxBytes: 64 * 1024
});
function logicalLines2(content) {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  return withoutBom.split(/\r\n|\n|\r/u);
}
function byteLength3(value) {
  return new TextEncoder().encode(value).byteLength;
}
function scalarValue(value) {
  const trimmed = value.trim();
  if ("" === trimmed) {
    return { kind: "empty" };
  }
  if (/^(?:[|>{\[]|-[ \t]|[&*!?][^\s]?)/u.test(trimmed)) {
    return { kind: "complex" };
  }
  const quote = trimmed[0];
  if ('"' === quote || "'" === quote) {
    if (trimmed.length < 2 || trimmed.at(-1) !== quote) {
      return { kind: "complex" };
    }
    return { kind: "scalar", value: trimmed.slice(1, -1) };
  }
  return { kind: "scalar", value: trimmed };
}
function parseDocumentMetadata(content) {
  const lines = logicalLines2(content);
  if ("---" !== lines[0]) {
    return { kind: "none" };
  }
  let scannedBytes = byteLength3(lines[0]) + 1;
  const fields = [];
  const seen = /* @__PURE__ */ new Set();
  let lastField = null;
  for (let index = 1; index < lines.length; index += 1) {
    if (index >= METADATA_SCAN_LIMITS.maxLines) {
      return { kind: "invalid", reason: "line-limit" };
    }
    const line = lines[index] ?? "";
    scannedBytes += byteLength3(line) + 1;
    if (scannedBytes > METADATA_SCAN_LIMITS.maxBytes) {
      return { kind: "invalid", reason: "byte-limit" };
    }
    if ("---" === line) {
      const result = {
        kind: "metadata",
        fields,
        ...safeSummaryScalars(fields)
      };
      return result;
    }
    if ("" === line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^[ \t]/u.test(line) || /^-[ \t]/u.test(line)) {
      if (lastField && "empty" === lastField.kind) {
        lastField.kind = "nested";
      }
      continue;
    }
    const declaration = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/u.exec(line);
    if (!declaration) {
      lastField = null;
      continue;
    }
    const key = declaration[1] ?? "";
    if (seen.has(key)) {
      return { kind: "invalid", reason: "duplicate-key", duplicateKey: key };
    }
    seen.add(key);
    const scalar = scalarValue(declaration[2] ?? "");
    const field = "scalar" === scalar.kind ? { key, kind: scalar.kind, value: scalar.value } : { key, kind: scalar.kind };
    fields.push(field);
    lastField = field;
  }
  return { kind: "invalid", reason: "missing-close" };
}
function safeSummaryScalars(fields) {
  const status = fields.find((field) => "status" === field.key && "scalar" === field.kind)?.value;
  const updated = fields.find((field) => "updated" === field.key && "scalar" === field.kind)?.value;
  return {
    ...void 0 === status ? {} : { status },
    ...void 0 === updated ? {} : { updated }
  };
}

// plugins/official/docs/src/index.ts
var EXPANDED_STATE_KEY = "metadata-expanded";
var pluginManifest = definePluginManifest(plugin_default);
async function readExpanded(storage, path) {
  const result = await storage.get(documentStorageKey(path, EXPANDED_STATE_KEY));
  return result.ok && 1 === result.value?.schemaVersion && true === result.value.value;
}
function fieldsForView(fields) {
  return fields.map((field) => ({
    key: field.key,
    kind: field.kind,
    ...void 0 === field.value ? {} : { value: field.value }
  }));
}
function createMetadataProvider(context) {
  const storage = context.storage;
  if (!storage) {
    throw new Error("Docs Metadata requires storage.workspace");
  }
  const extensions = context.extensions;
  if (!extensions) {
    throw new Error("Docs Metadata requires extensions.consume");
  }
  return {
    id: "metadata",
    async provide(snapshot) {
      const normalizedPath = snapshot.path.toLocaleLowerCase("en-US");
      if (!normalizedPath.endsWith(".md") || excludedDocumentPaths(extensions, "metadata").has(normalizedPath)) {
        return null;
      }
      const parsed = parseDocumentMetadata(snapshot.content);
      if ("none" === parsed.kind) {
        return null;
      }
      const expanded = await readExpanded(storage, snapshot.path);
      if ("invalid" === parsed.kind) {
        return {
          title: "Metadata",
          summary: "invalid",
          expanded,
          fields: expanded ? [{ key: parsed.duplicateKey ?? parsed.reason, kind: "complex" }] : [],
          toggleAction: "toggle"
        };
      }
      return {
        title: "Metadata",
        summary: `${parsed.fields.length} field${1 === parsed.fields.length ? "" : "s"}`,
        expanded,
        badges: [
          ...parsed.status ? [{ label: `status: ${parsed.status}`, tone: "info" }] : [],
          ...parsed.updated ? [{ label: `updated: ${parsed.updated}`, tone: "neutral" }] : []
        ],
        fields: expanded ? fieldsForView(parsed.fields) : [],
        toggleAction: "toggle"
      };
    },
    async onAction(action, snapshot) {
      if ("toggle" !== action.type) {
        return;
      }
      const expanded = await readExpanded(storage, snapshot.path);
      const result = await storage.set(documentStorageKey(snapshot.path, EXPANDED_STATE_KEY), {
        schemaVersion: 1,
        value: !expanded
      });
      if (!result.ok) {
        context.logger?.warn("Unable to persist Metadata expansion state", {
          kind: result.error.kind,
          message: result.error.message
        });
      }
    }
  };
}
var plugin = definePlugin({
  activate(context) {
    if (!context.documents) {
      throw new Error("Docs Metadata requires documents.readActive");
    }
    if (!context.extensions) {
      throw new Error("Docs Metadata requires extensions.consume");
    }
    if (!context.ui) {
      throw new Error("Docs Metadata requires ui.documentHeader");
    }
    const provider = createMetadataProvider(context);
    if (!context.commands) {
      throw new Error("Docs requires commands");
    }
    if (!context.documents.applyActiveEdit) {
      throw new Error("Docs requires documents.editActive");
    }
    if (!context.navigation) {
      throw new Error("Docs requires navigation.openMarkdown");
    }
    if (!context.views) {
      throw new Error("Docs requires ui.views");
    }
    const workspace = context.workspace;
    if (!workspace?.readMarkdown || !workspace.listMarkdown || !workspace.watchMarkdown || !workspace.planTextWrites || !workspace.commitTextWritePlan) {
      throw new Error("Docs requires bounded workspace read, watch and text batch services");
    }
    context.subscriptions.add(context.ui.registerDocumentHeaderProvider(provider));
    const controller = new DocsController(context, {
      documents: context.documents,
      extensions: context.extensions,
      navigation: context.navigation,
      views: context.views,
      workspace
    });
    context.subscriptions.add(controller);
    controller.start();
  }
});
var index_default = plugin;
export {
  DOCS_COMMANDS,
  DOCS_READER_LIMITS,
  DocsController,
  FRONTMATTER_ROUNDTRIP_LIMITS,
  archiveChatMessageToDocs,
  buildDocsArchiveContent,
  buildDocsReaderDocument,
  index_default as default,
  parseDocumentMetadata,
  parseRoundTripFrontmatter,
  pluginManifest,
  summarizeDocsDocument,
  updateRoundTripFrontmatter
};

export const pluginContentHash="sha256:930eecd7b630d005071dd85fef9448f0e2b6a08e7fe9ade3c97391dfc37418f0";
