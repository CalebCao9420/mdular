// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
var DOCUMENT_POLICY_EXTENSION_POINT = "mdular.documents.policy";
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/chat/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.chat",
  name: "Chat",
  version: "0.1.0",
  entry: "chat.js",
  description: "Fast Markdown capture with completion, batch actions, and extensible archives.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "extensions.consume",
    "extensions.register",
    "ui.views",
    "workspace.readMarkdown",
    "workspace.modifyMarkdown",
    "workspace.writeTextBatch",
    "workspace.watchMarkdown"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.chat.open",
        title: "Open Chat",
        defaultKeybindings: [
          "Mod+Enter"
        ]
      },
      {
        id: "mdular.chat.quick-capture",
        title: "Quick Capture to Chat",
        defaultKeybindings: [
          "Mod+Shift+Enter"
        ]
      }
    ],
    views: [
      {
        id: "chat",
        title: "Chat",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/chat/src/model.ts
var CHAT_LIMITS = Object.freeze({
  maxDocumentCharacters: 2 * 1024 * 1024,
  maxMessageCharacters: 64 * 1024,
  maxMessages: 2e4,
  maxRenderedMessages: 500,
  maxMutationMessages: 500
});
var MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
]);
var WEEKDAYS = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);
function boundedDocument(content) {
  if ("string" !== typeof content || CHAT_LIMITS.maxDocumentCharacters < content.length) {
    throw new Error("Chat document exceeds its character limit");
  }
  return content.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}
function boundedText(text) {
  if ("string" !== typeof text) {
    throw new Error("Chat message must be text");
  }
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if ("" === normalized) {
    throw new Error("Chat message must not be empty");
  }
  if (CHAT_LIMITS.maxMessageCharacters < normalized.length) {
    throw new Error("Chat message exceeds its character limit");
  }
  return normalized;
}
function identity(value) {
  return `${value.date}\0${value.timestamp}\0${value.text}`;
}
function decodeMessageText(value) {
  const lines = value.split("\n");
  return lines.map((line, index) => {
    if (0 === index || !line.startsWith("\\")) {
      return line;
    }
    const candidate = line.slice(1);
    return candidate.startsWith("\\") || /^#### /u.test(candidate) || /^- \[[ xX]\] /u.test(candidate) ? candidate : line;
  }).join("\n");
}
function encodeMessageText(value) {
  const lines = value.split("\n");
  return lines.map((line, index) => 0 < index && (line.startsWith("\\") || /^#### /u.test(line) || /^- \[[ xX]\] /u.test(line)) ? `\\${line}` : line).join("\n");
}
function chatDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Chat date is invalid");
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${WEEKDAYS[date.getDay()]}`;
}
function chatTimestamp(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Chat timestamp is invalid");
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function journalPath(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Journal date is invalid");
  }
  return `journal/${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")} ${MONTHS[date.getMonth()]}.md`;
}
function parseChatDocument(content, fallbackDate) {
  const normalized = boundedDocument(content);
  const lines = normalized.split("\n");
  const blocks = [];
  let currentBlock = "";
  for (const line of lines) {
    if (/^#### /u.test(line) || /^- \[[ xX]\] /u.test(line)) {
      if ("" !== currentBlock) {
        blocks.push(currentBlock.trim());
      }
      currentBlock = line;
    } else if ("" !== currentBlock) {
      currentBlock += `
${line}`;
    }
  }
  if ("" !== currentBlock) {
    blocks.push(currentBlock.trim());
  }
  let currentDate = fallbackDate;
  const messages = [];
  const occurrences = /* @__PURE__ */ new Map();
  for (const block of blocks) {
    if (block.startsWith("####")) {
      currentDate = block.replace(/^#+\s*/u, "").trim() || fallbackDate;
      continue;
    }
    const marker = /^- \[([ xX])\] /u.exec(block);
    if (!marker) {
      continue;
    }
    let rest = block.slice(marker[0].length);
    const timestampMatch = /^`(\d{2}:\d{2})` /u.exec(rest);
    const timestamp = timestampMatch?.[1] ?? "";
    if (timestampMatch) {
      rest = rest.slice(timestampMatch[0].length);
    }
    const text = decodeMessageText(rest.trim());
    if ("" === text) {
      continue;
    }
    if (CHAT_LIMITS.maxMessageCharacters < text.length) {
      throw new Error("Chat message exceeds its character limit");
    }
    if (CHAT_LIMITS.maxMessages <= messages.length) {
      throw new Error("Chat document contains too many messages");
    }
    const key = identity({ date: currentDate, timestamp, text });
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const index = messages.length;
    messages.push({
      id: `message-${index}`,
      index,
      done: "x" === marker[1]?.toLocaleLowerCase("en-US"),
      text,
      timestamp,
      date: currentDate,
      occurrence
    });
  }
  return messages;
}
function serializeChatMessages(messages) {
  if (!Array.isArray(messages) || CHAT_LIMITS.maxMessages < messages.length) {
    throw new Error("Chat message collection exceeds its limit");
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const message of messages) {
    const date = message.date.trim();
    const text = boundedText(message.text);
    if ("" === date || 256 < date.length || !/^\d{2}:\d{2}$/u.test(message.timestamp) && "" !== message.timestamp) {
      throw new Error("Chat message metadata is invalid");
    }
    const group = grouped.get(date) ?? [];
    group.push({ ...message, date, text });
    grouped.set(date, group);
  }
  let content = "";
  for (const [date, group] of grouped) {
    if ("" !== content) {
      content += "\n";
    }
    content += `#### ${date}
`;
    for (const message of group) {
      const timestamp = "" === message.timestamp ? "" : `\`${message.timestamp}\` `;
      content += `- [${message.done ? "x" : " "}] ${timestamp}${encodeMessageText(message.text)}
`;
    }
  }
  if (CHAT_LIMITS.maxDocumentCharacters < content.length) {
    throw new Error("Chat document exceeds its character limit");
  }
  return content;
}
function messageLocator(message) {
  return {
    date: message.date,
    timestamp: message.timestamp,
    text: message.text,
    occurrence: message.occurrence
  };
}
function findMessageIndex(messages, locator) {
  return messages.findIndex((message) => message.date === locator.date && message.timestamp === locator.timestamp && message.text === locator.text && message.occurrence === locator.occurrence);
}
function appendChatMessage(content, text, date, timestamp) {
  const messages = [...parseChatDocument(content, date)];
  if (CHAT_LIMITS.maxMessages <= messages.length) {
    throw new Error("Chat document contains too many messages");
  }
  const normalizedText = boundedText(text);
  const occurrence = messages.filter((message) => message.date === date && message.timestamp === timestamp && message.text === normalizedText).length;
  messages.push({
    id: `message-${messages.length}`,
    index: messages.length,
    date,
    timestamp,
    text: normalizedText,
    done: false,
    occurrence
  });
  return {
    content: serializeChatMessages(messages),
    changed: true,
    affected: 1,
    missing: []
  };
}
function setChatMessageDone(content, locator, done, fallbackDate) {
  const messages = [...parseChatDocument(content, fallbackDate)];
  const index = findMessageIndex(messages, locator);
  if (-1 === index) {
    return { content: serializeChatMessages(messages), changed: false, affected: 0, missing: [locator] };
  }
  const current = messages[index];
  if (current.done === done) {
    return { content: serializeChatMessages(messages), changed: false, affected: 1, missing: [] };
  }
  messages[index] = { ...current, done };
  return {
    content: serializeChatMessages(messages),
    changed: true,
    affected: 1,
    missing: []
  };
}
function removeChatMessages(content, locators, fallbackDate) {
  if (!Array.isArray(locators) || CHAT_LIMITS.maxMutationMessages < locators.length) {
    throw new Error("Chat mutation exceeds its message limit");
  }
  const messages = [...parseChatDocument(content, fallbackDate)];
  const indexes = /* @__PURE__ */ new Set();
  const missing = [];
  for (const locator of locators) {
    const index = findMessageIndex(messages, locator);
    if (-1 === index || indexes.has(index)) {
      missing.push(locator);
    } else {
      indexes.add(index);
    }
  }
  const remaining = messages.filter((_message, index) => !indexes.has(index));
  return {
    content: serializeChatMessages(remaining),
    changed: 0 < indexes.size,
    affected: indexes.size,
    missing
  };
}
function splitArchiveTitle(text, maximum = 100) {
  const normalized = boundedText(text);
  const lines = normalized.split("\n");
  const first = lines.shift()?.trim() ?? "";
  const title = first.slice(0, maximum).trim() || "untitled";
  const body = lines.join("\n").trim();
  return { title, body: "" === body ? normalized : body };
}
function safeArchiveBasename(title) {
  const safe = title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").replace(/\s+/gu, " ").replace(/[. ]+$/gu, "").trim().slice(0, 100).replace(/[. ]+$/gu, "");
  return "" === safe || "." === safe || ".." === safe ? "untitled" : safe;
}

// plugins/official/chat/src/index.ts
var VIEW_ID = "chat";
var OPEN_COMMAND = "mdular.chat.open";
var QUICK_CAPTURE_COMMAND = "mdular.chat.quick-capture";
var CHAT_PATH = "Chat.md";
var ARCHIVE_POINT = "mdular.chat.archive-targets";
var MAX_EDIT_ATTEMPTS = 4;
var pluginManifest = definePluginManifest(plugin_default);
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function messageFrom(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
function isNotFound(error) {
  return /(?:^|\s)not-found:/u.test(messageFrom(error));
}
function normalizeMarkdownPath(value) {
  if ("string" !== typeof value || "" === value || 1024 < value.length || value.startsWith("/") || value.includes("\\") || !value.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("Archive provider returned an invalid Markdown path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => "" === segment || "." === segment || ".." === segment || segment.includes("\0"))) {
    throw new Error("Archive provider returned a non-canonical Markdown path");
  }
  return value;
}
function appendAtEnd(content, line) {
  const prefix = content.replace(/\r\n?/gu, "\n").trimEnd();
  return `${"" === prefix ? "" : `${prefix}
`}${line}
`;
}
function appendUnderHeading(content, heading, text) {
  const normalized = content.replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  while (0 < lines.length && "" === lines.at(-1)) {
    lines.pop();
  }
  const headingIndex = lines.findIndex((line) => line.trimEnd() === heading);
  if (-1 === headingIndex) {
    if (0 < lines.length) {
      lines.push("");
    }
    lines.push(heading, text);
    return `${lines.join("\n")}
`;
  }
  const level = /^#+/u.exec(heading)?.[0].length ?? 1;
  let insertion = headingIndex + 1;
  while (insertion < lines.length) {
    const nextLevel = /^(#+)\s/u.exec(lines[insertion] ?? "")?.[1]?.length;
    if (void 0 !== nextLevel && nextLevel <= level) {
      break;
    }
    insertion += 1;
  }
  while (headingIndex + 1 < insertion && "" === lines[insertion - 1]) {
    insertion -= 1;
  }
  lines.splice(insertion, 0, text);
  return `${lines.join("\n")}
`;
}
function capitalize(text) {
  return `${text.slice(0, 1).toLocaleUpperCase()}${text.slice(1)}`;
}
var ChatController = class {
  #context;
  #extensions;
  #views;
  #workspace;
  #messages = [];
  #selected = /* @__PURE__ */ new Set();
  #capture = "";
  #archiveTarget = "journal";
  #archiveOptions = [
    { value: "journal", label: "Journal" },
    { value: "later", label: "Later checklist" },
    { value: "read", label: "Read checklist" },
    { value: "watch", label: "Watch checklist" },
    { value: "shop", label: "Shop checklist" },
    { value: "archive", label: "New archive document" }
  ];
  #status = "Loading Chat.md\u2026";
  #queue = Promise.resolve();
  #busy = false;
  #disposed = false;
  constructor(context, services) {
    this.#context = context;
    this.#extensions = services.extensions;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }
  start() {
    this.#context.subscriptions.add(this.#extensions.register(DOCUMENT_POLICY_EXTENSION_POINT, {
      id: "mdular.chat",
      label: "Chat document policy",
      order: 0,
      data: {
        schemaVersion: 1,
        paths: [CHAT_PATH],
        search: "exclude",
        metadata: "exclude"
      }
    }));
    this.#context.subscriptions.add(this.#extensions.onDidChange(ARCHIVE_POINT, () => {
      this.#enqueue(() => this.#refreshArchiveOptions());
    }));
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands.register(OPEN_COMMAND, async () => {
      await this.#show("Chat ready. Idle auto-switch is disabled.");
      return void 0;
    }));
    this.#context.subscriptions.add(this.#context.commands.register(
      QUICK_CAPTURE_COMMAND,
      async () => {
        await this.#show("Quick capture ready. Enter sends; Shift+Enter adds a line.");
        return void 0;
      }
    ));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      if ("reset" === change.kind || CHAT_PATH.toLocaleLowerCase("en-US") === change.path.toLocaleLowerCase("en-US")) {
        this.#enqueue(() => this.#loadChat());
      } else {
        this.#enqueue(() => this.#refreshArchiveOptions());
      }
    }));
    this.#render();
    this.#enqueue(async () => {
      await this.#loadChat();
      await this.#refreshArchiveOptions();
    });
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#selected.clear();
    this.#messages = [];
    this.#views.hide(VIEW_ID);
  }
  async #show(status) {
    this.#status = status;
    this.#render();
    await this.#views.reveal(VIEW_ID);
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
      this.#status = `Chat refresh failed: ${messageFrom(error)}`;
      this.#context.logger?.warn("Chat refresh failed", { message: messageFrom(error) });
      this.#render();
    });
  }
  async #handleAction(action) {
    if ("field" === action.type) {
      const id = payloadString(action, "id");
      const value = payloadString(action, "value");
      if (null === id || null === value) {
        throw new Error("Chat field action is malformed");
      }
      if ("capture" === id) {
        this.#capture = value;
      } else if ("archive-target" === id) {
        if (!this.#archiveOptions.some((option) => option.value === value)) {
          throw new Error("Chat archive target is unavailable");
        }
        this.#archiveTarget = value;
      } else {
        throw new Error(`Unknown Chat field: ${id}`);
      }
      return;
    }
    if ("activate" === action.type) {
      const id = payloadString(action, "id");
      if (!id || !this.#messages.some((message) => message.id === id)) {
        throw new Error("Chat selection action is malformed");
      }
      if (this.#selected.has(id)) {
        this.#selected.delete(id);
      } else {
        this.#selected.add(id);
      }
      this.#status = `${this.#selected.size} message${1 === this.#selected.size ? "" : "s"} selected.`;
      this.#render();
      return;
    }
    if ("item-command" === action.type) {
      const id = payloadString(action, "id");
      const command2 = payloadString(action, "actionId");
      const message = this.#messages.find((candidate) => candidate.id === id);
      if (!message || !command2) {
        throw new Error("Chat item action is malformed");
      }
      await this.#run(command2, async () => {
        if ("complete" === command2) {
          await this.#setDone(message, true);
        } else if ("restore" === command2) {
          await this.#setDone(message, false);
        } else if ("delete" === command2) {
          await this.#delete([message]);
        } else if ("archive" === command2) {
          await this.#archive([message]);
        } else {
          throw new Error(`Unknown Chat item action: ${command2}`);
        }
      });
      return;
    }
    if ("command" !== action.type) {
      return;
    }
    const command = payloadString(action, "id");
    if (!command) {
      throw new Error("Chat command action is malformed");
    }
    await this.#run(command, async () => {
      switch (command) {
        case "send":
          await this.#send();
          break;
        case "select-all":
          this.#selectAll();
          break;
        case "clear-selection":
          this.#selected.clear();
          this.#status = "Selection cleared.";
          break;
        case "delete-selected":
          await this.#delete(this.#selectedMessages());
          break;
        case "archive-selected":
          await this.#archive(this.#selectedMessages());
          break;
        case "refresh":
          await this.#loadChat();
          await this.#refreshArchiveOptions();
          break;
        default:
          throw new Error(`Unknown Chat view command: ${command}`);
      }
    });
  }
  async #run(action, task) {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    this.#render();
    try {
      await task();
    } catch (error) {
      this.#status = `${action} failed: ${messageFrom(error)}`;
      this.#context.logger?.warn("Chat action failed", {
        action,
        message: messageFrom(error)
      });
    } finally {
      this.#busy = false;
      this.#render();
    }
  }
  async #loadChat() {
    try {
      const content = await this.#workspace.readMarkdown(CHAT_PATH);
      if (this.#disposed) {
        return;
      }
      this.#adoptContent(content);
      this.#status = `${this.#messages.length} Chat message${1 === this.#messages.length ? "" : "s"}.`;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      this.#messages = [];
      this.#selected.clear();
      this.#status = "Chat.md will be created on first capture.";
    }
    this.#render();
  }
  async #refreshArchiveOptions() {
    const builtins = [
      { value: "journal", label: "Journal" },
      { value: "later", label: "Later checklist" },
      { value: "read", label: "Read checklist" },
      { value: "watch", label: "Watch checklist" },
      { value: "shop", label: "Shop checklist" },
      { value: "archive", label: "New archive document" }
    ];
    const recent = (await this.#workspace.listMarkdownEntries()).filter((entry) => {
      const path = entry.path.toLocaleLowerCase("en-US");
      return path !== "chat.md" && !["later.md", "read.md", "watch.md", "shop.md"].includes(path) && entry.path.length <= 480;
    }).sort((left, right) => right.lastModifiedMs - left.lastModifiedMs || left.path.localeCompare(right.path)).slice(0, 1).map((entry) => ({
      value: `recent:${entry.path}`,
      label: `Recent \xB7 ${entry.path}`.slice(0, 256)
    }));
    const extensions = this.#extensions.list(ARCHIVE_POINT).filter((contribution) => contribution.execute && contribution.id.length <= 200).slice(0, 56).map((contribution) => ({
      value: `extension:${contribution.id}`,
      label: contribution.label.slice(0, 256)
    }));
    this.#archiveOptions = [...builtins, ...recent, ...extensions];
    if (!this.#archiveOptions.some((option) => option.value === this.#archiveTarget)) {
      this.#archiveTarget = "journal";
    }
    this.#render();
  }
  #adoptContent(content) {
    this.#messages = parseChatDocument(content, chatDate(/* @__PURE__ */ new Date()));
    this.#selected.clear();
  }
  #visibleMessages() {
    return this.#messages.slice(-CHAT_LIMITS.maxRenderedMessages);
  }
  #selectedMessages() {
    return this.#visibleMessages().filter((message) => this.#selected.has(message.id));
  }
  #selectAll() {
    const visible = this.#visibleMessages();
    this.#selected = new Set(visible.map((message) => message.id));
    this.#status = `${visible.length} visible message${1 === visible.length ? "" : "s"} selected.`;
  }
  async #send() {
    const text = this.#capture.trim();
    if ("" === text) {
      throw new Error("Enter a message first");
    }
    const journalSuffix = /\s(?:jj|\?\?)$/iu.exec(text);
    if (journalSuffix) {
      const direct = text.slice(0, journalSuffix.index).trim();
      if ("" === direct) {
        throw new Error("Enter text before the Journal suffix");
      }
      const path = await this.#archiveOne("journal", direct);
      this.#capture = "";
      this.#status = `Captured directly to ${path}.`;
      await this.#refreshArchiveOptions();
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const mutation = await this.#mutateChat((content) => appendChatMessage(content, text, chatDate(now), chatTimestamp(now)));
    this.#adoptContent(mutation.content);
    this.#capture = "";
    this.#status = "Message captured.";
  }
  async #setDone(message, done) {
    const locator = messageLocator(message);
    const mutation = await this.#mutateChat((content) => setChatMessageDone(content, locator, done, chatDate(/* @__PURE__ */ new Date())), false);
    this.#adoptContent(mutation.content);
    this.#status = 0 === mutation.affected ? "Message changed externally; nothing was overwritten." : done ? "Message completed." : "Message restored.";
  }
  async #delete(messages) {
    if (0 === messages.length) {
      throw new Error("Select at least one message");
    }
    const locators = messages.map(messageLocator);
    const mutation = await this.#mutateChat((content) => removeChatMessages(content, locators, chatDate(/* @__PURE__ */ new Date())), false);
    this.#adoptContent(mutation.content);
    this.#status = `${mutation.affected} message${1 === mutation.affected ? "" : "s"} deleted${0 < mutation.missing.length ? `; ${mutation.missing.length} changed externally` : ""}.`;
  }
  async #archive(messages) {
    if (0 === messages.length) {
      throw new Error("Select at least one message");
    }
    const archived = [];
    let failed = null;
    for (const message of messages) {
      try {
        archived.push({
          locator: messageLocator(message),
          path: await this.#archiveOne(this.#archiveTarget, message.text)
        });
      } catch (error) {
        failed = messageFrom(error);
        break;
      }
    }
    if (0 === archived.length) {
      throw new Error(failed ?? "No messages were archived");
    }
    const mutation = await this.#mutateChat((content) => removeChatMessages(
      content,
      archived.map((entry) => entry.locator),
      chatDate(/* @__PURE__ */ new Date())
    ), false);
    this.#adoptContent(mutation.content);
    await this.#refreshArchiveOptions();
    const uniquePaths = [...new Set(archived.map((entry) => entry.path))];
    const notes = [
      `${archived.length} archived to ${uniquePaths.join(", ")}`,
      ...0 < mutation.missing.length ? [`${mutation.missing.length} source message${1 === mutation.missing.length ? "" : "s"} changed before removal`] : [],
      ...failed ? [`batch stopped: ${failed}`] : []
    ];
    this.#status = `${notes.join("; ")}.`;
  }
  async #archiveOne(target, text) {
    const now = /* @__PURE__ */ new Date();
    if ("journal" === target) {
      const path = journalPath(now);
      await this.#editMarkdown(path, (content) => appendUnderHeading(content, `## ${chatDate(now)}`, capitalize(text)));
      return path;
    }
    const checklistPaths = {
      later: "Later.md",
      read: "Read.md",
      watch: "Watch.md",
      shop: "Shop.md"
    };
    const checklistPath = checklistPaths[target];
    if (checklistPath) {
      await this.#editMarkdown(checklistPath, (content) => appendAtEnd(content, `- [ ] ${text}`));
      return checklistPath;
    }
    if ("archive" === target) {
      return this.#createArchiveDocument(text);
    }
    if (target.startsWith("recent:")) {
      const path = normalizeMarkdownPath(target.slice("recent:".length));
      if (CHAT_PATH.toLocaleLowerCase("en-US") === path.toLocaleLowerCase("en-US")) {
        throw new Error("Chat.md cannot archive into itself");
      }
      await this.#editMarkdown(path, (content) => appendUnderHeading(content, `#### ${chatDate(now)}`, text));
      return path;
    }
    if (target.startsWith("extension:")) {
      const id = target.slice("extension:".length);
      const contribution = this.#extensions.list(ARCHIVE_POINT).find((candidate) => candidate.id === id && candidate.execute);
      if (!contribution?.execute) {
        throw new Error("Archive extension is no longer available");
      }
      return this.#decodeArchiveResponse(await contribution.execute({ schemaVersion: 1, text })).path;
    }
    throw new Error("Archive target is unavailable");
  }
  #decodeArchiveResponse(value) {
    if (!isRecord(value) || 1 !== value.schemaVersion) {
      throw new Error("Archive provider returned a malformed response");
    }
    return { path: normalizeMarkdownPath(value.path) };
  }
  async #createArchiveDocument(text) {
    const { title, body } = splitArchiveTitle(text);
    const basename = safeArchiveBasename(title);
    for (let index = 0; index < 1e3; index += 1) {
      const suffix = 0 === index ? "" : ` (${index})`;
      const path = `archive/${basename}${suffix}.md`;
      const plan = await this.#workspace.planTextWrites(
        [{ path, content: `${body.trim()}
` }],
        "skip-existing"
      );
      const result = await this.#workspace.commitTextWritePlan(plan.planId);
      if (result.created.includes(path)) {
        return path;
      }
      if ("partial" === result.status && !/exist/iu.test(result.failed.kind)) {
        throw new Error(`${result.failed.kind}: ${result.failed.message}`);
      }
    }
    throw new Error("No unique archive filename was available");
  }
  async #editMarkdown(path, update) {
    let draft;
    try {
      draft = await this.#workspace.beginMarkdownEdit(path);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      const content = update("");
      if (await this.#createText(path, content)) {
        return content;
      }
      draft = await this.#workspace.beginMarkdownEdit(path);
    }
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const content = update(draft.content);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, content);
      if ("written" === result.status) {
        return result.content;
      }
      draft = result.current;
    }
    throw new Error(`Concurrent edits to ${path} did not settle`);
  }
  async #mutateChat(transform, createIfMissing = true) {
    let draft;
    try {
      draft = await this.#workspace.beginMarkdownEdit(CHAT_PATH);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      const mutation = transform("");
      if (!createIfMissing) {
        return mutation;
      }
      if (await this.#createText(CHAT_PATH, mutation.content)) {
        return mutation;
      }
      draft = await this.#workspace.beginMarkdownEdit(CHAT_PATH);
    }
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const mutation = transform(draft.content);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, mutation.content);
      if ("written" === result.status) {
        return { ...mutation, content: result.content };
      }
      draft = result.current;
    }
    throw new Error("Concurrent Chat.md edits did not settle");
  }
  async #createText(path, content) {
    const plan = await this.#workspace.planTextWrites([{ path, content }], "skip-existing");
    const result = await this.#workspace.commitTextWritePlan(plan.planId);
    if ("partial" === result.status) {
      if (/exist/iu.test(result.failed.kind)) {
        return false;
      }
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
    return result.created.includes(path);
  }
  #render() {
    if (this.#disposed) {
      return;
    }
    const visible = this.#visibleMessages();
    const items = visible.map((message) => ({
      id: message.id,
      title: message.text.slice(0, 4096),
      description: `${message.date}${message.timestamp ? ` \xB7 ${message.timestamp}` : ""}`.slice(0, 4096),
      badges: [message.done ? "done" : "open"],
      selected: this.#selected.has(message.id),
      appearance: message.done ? "completed" : "default",
      actions: [
        {
          id: message.done ? "restore" : "complete",
          label: message.done ? "Undo" : "Done",
          disabled: this.#busy
        },
        { id: "archive", label: "Archive", disabled: this.#busy },
        { id: "delete", label: "Delete", tone: "danger", disabled: this.#busy }
      ]
    }));
    const archiveOptions = this.#archiveOptions.map((option) => ({
      value: option.value,
      label: option.label
    }));
    const hidden = this.#messages.length - visible.length;
    const selected = this.#selectedMessages().length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "Chat",
      fields: [
        {
          id: "capture",
          kind: "textarea",
          label: "Capture",
          value: this.#capture,
          placeholder: "Capture a thought\u2026",
          description: "Enter sends. Shift+Enter adds a line. Suffix jj or ?? sends directly to Journal.",
          rows: 3,
          submitActionId: "send"
        },
        {
          id: "archive-target",
          kind: "select",
          label: "Archive selected messages to",
          value: this.#archiveTarget,
          options: archiveOptions
        }
      ],
      actions: [
        { id: "send", label: "Send", tone: "primary", disabled: this.#busy },
        { id: "select-all", label: "Select visible", disabled: this.#busy || 0 === visible.length },
        { id: "clear-selection", label: "Clear selection", disabled: this.#busy || 0 === selected },
        { id: "archive-selected", label: "Archive selected", disabled: this.#busy || 0 === selected },
        {
          id: "delete-selected",
          label: "Delete selected",
          tone: "danger",
          disabled: this.#busy || 0 === selected
        },
        { id: "refresh", label: "Refresh", disabled: this.#busy }
      ],
      status: `${this.#status}${0 < hidden ? ` \xB7 showing newest ${visible.length} of ${this.#messages.length}` : ""}`,
      busy: this.#busy,
      emptyMessage: "No Chat messages yet.",
      items
    });
  }
};
var plugin = definePlugin({
  activate(context) {
    if (!context.commands) {
      throw new Error("Chat requires commands");
    }
    if (!context.extensions) {
      throw new Error("Chat requires extension consume/register access");
    }
    if (!context.views) {
      throw new Error("Chat requires ui.views");
    }
    if (!context.workspace?.readMarkdown || !context.workspace.listMarkdownEntries || !context.workspace.watchMarkdown || !context.workspace.beginMarkdownEdit || !context.workspace.commitMarkdownEdit || !context.workspace.planTextWrites || !context.workspace.commitTextWritePlan) {
      throw new Error("Chat requires workspace read, watch, modify, and create access");
    }
    const controller = new ChatController(context, {
      extensions: context.extensions,
      views: context.views,
      workspace: {
        readMarkdown: context.workspace.readMarkdown,
        listMarkdownEntries: context.workspace.listMarkdownEntries,
        watchMarkdown: context.workspace.watchMarkdown,
        beginMarkdownEdit: context.workspace.beginMarkdownEdit,
        commitMarkdownEdit: context.workspace.commitMarkdownEdit,
        planTextWrites: context.workspace.planTextWrites,
        commitTextWritePlan: context.workspace.commitTextWritePlan
      }
    });
    controller.start();
    return controller;
  }
});
var index_default = plugin;
export {
  CHAT_LIMITS,
  appendChatMessage,
  chatDate,
  chatTimestamp,
  index_default as default,
  journalPath,
  messageLocator,
  parseChatDocument,
  pluginManifest,
  removeChatMessages,
  safeArchiveBasename,
  serializeChatMessages,
  setChatMessageDone,
  splitArchiveTitle
};

export const pluginContentHash="sha256:ebf706324f9c86e5cb839981109ccaac42c864fa528f1a049df4db3a090177a4";
