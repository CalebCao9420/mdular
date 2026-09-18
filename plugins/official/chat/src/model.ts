export const CHAT_LIMITS = Object.freeze({
  maxDocumentCharacters: 2 * 1024 * 1024,
  maxMessageCharacters: 64 * 1024,
  maxMessages: 20_000,
  maxRenderedMessages: 500,
  maxMutationMessages: 500,
});

const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);
const WEEKDAYS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

export interface ChatMessageLocator {
  readonly date: string;
  readonly timestamp: string;
  readonly text: string;
  readonly occurrence: number;
}

export interface ChatMessage extends ChatMessageLocator {
  readonly id: string;
  readonly index: number;
  readonly done: boolean;
}

export interface ChatMutationResult {
  readonly content: string;
  readonly changed: boolean;
  readonly affected: number;
  readonly missing: readonly ChatMessageLocator[];
}

function boundedDocument(content: string): string {
  if ('string' !== typeof content || CHAT_LIMITS.maxDocumentCharacters < content.length) {
    throw new Error('Chat document exceeds its character limit');
  }
  return content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

function boundedText(text: string): string {
  if ('string' !== typeof text) { throw new Error('Chat message must be text'); }
  const normalized = text.replace(/\r\n?/gu, '\n').trim();
  if ('' === normalized) { throw new Error('Chat message must not be empty'); }
  if (CHAT_LIMITS.maxMessageCharacters < normalized.length) {
    throw new Error('Chat message exceeds its character limit');
  }
  return normalized;
}

function identity(value: Pick<ChatMessageLocator, 'date' | 'timestamp' | 'text'>): string {
  return `${value.date}\u0000${value.timestamp}\u0000${value.text}`;
}

function decodeMessageText(value: string): string {
  const lines = value.split('\n');
  return lines.map((line, index) => {
    if (0 === index || !line.startsWith('\\')) { return line; }
    const candidate = line.slice(1);
    return candidate.startsWith('\\') || /^#### /u.test(candidate) || /^- \[[ xX]\] /u.test(candidate)
      ? candidate
      : line;
  }).join('\n');
}

function encodeMessageText(value: string): string {
  const lines = value.split('\n');
  return lines.map((line, index) =>
    0 < index && (line.startsWith('\\') || /^#### /u.test(line) || /^- \[[ xX]\] /u.test(line))
      ? `\\${line}`
      : line).join('\n');
}

export function chatDate(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Chat date is invalid');
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${WEEKDAYS[date.getDay()]}`;
}

export function chatTimestamp(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Chat timestamp is invalid');
  }
  return `${String(date.getHours()).padStart(2, '0')}:` +
    `${String(date.getMinutes()).padStart(2, '0')}`;
}

export function journalPath(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Journal date is invalid');
  }
  return `journal/${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')} ` +
    `${MONTHS[date.getMonth()]}.md`;
}

export function parseChatDocument(content: string, fallbackDate: string): readonly ChatMessage[] {
  const normalized = boundedDocument(content);
  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let currentBlock = '';
  for (const line of lines) {
    if (/^#### /u.test(line) || /^- \[[ xX]\] /u.test(line)) {
      if ('' !== currentBlock) { blocks.push(currentBlock.trim()); }
      currentBlock = line;
    } else if ('' !== currentBlock) {
      currentBlock += `\n${line}`;
    }
  }
  if ('' !== currentBlock) { blocks.push(currentBlock.trim()); }

  let currentDate = fallbackDate;
  const messages: ChatMessage[] = [];
  const occurrences = new Map<string, number>();
  for (const block of blocks) {
    if (block.startsWith('####')) {
      currentDate = block.replace(/^#+\s*/u, '').trim() || fallbackDate;
      continue;
    }
    const marker = /^- \[([ xX])\] /u.exec(block);
    if (!marker) { continue; }
    let rest = block.slice(marker[0].length);
    const timestampMatch = /^`(\d{2}:\d{2})` /u.exec(rest);
    const timestamp = timestampMatch?.[1] ?? '';
    if (timestampMatch) { rest = rest.slice(timestampMatch[0].length); }
    const text = decodeMessageText(rest.trim());
    if ('' === text) { continue; }
    if (CHAT_LIMITS.maxMessageCharacters < text.length) {
      throw new Error('Chat message exceeds its character limit');
    }
    if (CHAT_LIMITS.maxMessages <= messages.length) {
      throw new Error('Chat document contains too many messages');
    }
    const key = identity({ date: currentDate, timestamp, text });
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const index = messages.length;
    messages.push({
      id: `message-${index}`,
      index,
      done: 'x' === marker[1]?.toLocaleLowerCase('en-US'),
      text,
      timestamp,
      date: currentDate,
      occurrence,
    });
  }
  return messages;
}

export function serializeChatMessages(messages: readonly ChatMessage[]): string {
  if (!Array.isArray(messages) || CHAT_LIMITS.maxMessages < messages.length) {
    throw new Error('Chat message collection exceeds its limit');
  }
  const grouped = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const date = message.date.trim();
    const text = boundedText(message.text);
    if ('' === date || 256 < date.length || !/^\d{2}:\d{2}$/u.test(message.timestamp) &&
        '' !== message.timestamp) {
      throw new Error('Chat message metadata is invalid');
    }
    const group = grouped.get(date) ?? [];
    group.push({ ...message, date, text });
    grouped.set(date, group);
  }
  let content = '';
  for (const [date, group] of grouped) {
    if ('' !== content) { content += '\n'; }
    content += `#### ${date}\n`;
    for (const message of group) {
      const timestamp = '' === message.timestamp ? '' : `\`${message.timestamp}\` `;
      content += `- [${message.done ? 'x' : ' '}] ${timestamp}${encodeMessageText(message.text)}\n`;
    }
  }
  if (CHAT_LIMITS.maxDocumentCharacters < content.length) {
    throw new Error('Chat document exceeds its character limit');
  }
  return content;
}

export function messageLocator(message: ChatMessage): ChatMessageLocator {
  return {
    date: message.date,
    timestamp: message.timestamp,
    text: message.text,
    occurrence: message.occurrence,
  };
}

function findMessageIndex(
  messages: readonly ChatMessage[],
  locator: ChatMessageLocator,
): number {
  return messages.findIndex((message) =>
    message.date === locator.date &&
    message.timestamp === locator.timestamp &&
    message.text === locator.text &&
    message.occurrence === locator.occurrence);
}

export function appendChatMessage(
  content: string,
  text: string,
  date: string,
  timestamp: string,
): ChatMutationResult {
  const messages = [...parseChatDocument(content, date)];
  if (CHAT_LIMITS.maxMessages <= messages.length) {
    throw new Error('Chat document contains too many messages');
  }
  const normalizedText = boundedText(text);
  const occurrence = messages.filter((message) =>
    message.date === date && message.timestamp === timestamp && message.text === normalizedText).length;
  messages.push({
    id: `message-${messages.length}`,
    index: messages.length,
    date,
    timestamp,
    text: normalizedText,
    done: false,
    occurrence,
  });
  return {
    content: serializeChatMessages(messages),
    changed: true,
    affected: 1,
    missing: [],
  };
}

export function setChatMessageDone(
  content: string,
  locator: ChatMessageLocator,
  done: boolean,
  fallbackDate: string,
): ChatMutationResult {
  const messages = [...parseChatDocument(content, fallbackDate)];
  const index = findMessageIndex(messages, locator);
  if (-1 === index) {
    return { content: serializeChatMessages(messages), changed: false, affected: 0, missing: [locator] };
  }
  const current = messages[index]!;
  if (current.done === done) {
    return { content: serializeChatMessages(messages), changed: false, affected: 1, missing: [] };
  }
  messages[index] = { ...current, done };
  return {
    content: serializeChatMessages(messages),
    changed: true,
    affected: 1,
    missing: [],
  };
}

export function removeChatMessages(
  content: string,
  locators: readonly ChatMessageLocator[],
  fallbackDate: string,
): ChatMutationResult {
  if (!Array.isArray(locators) || CHAT_LIMITS.maxMutationMessages < locators.length) {
    throw new Error('Chat mutation exceeds its message limit');
  }
  const messages = [...parseChatDocument(content, fallbackDate)];
  const indexes = new Set<number>();
  const missing: ChatMessageLocator[] = [];
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
    missing,
  };
}

export function splitArchiveTitle(text: string, maximum = 100): {
  readonly title: string;
  readonly body: string;
} {
  const normalized = boundedText(text);
  const lines = normalized.split('\n');
  const first = lines.shift()?.trim() ?? '';
  const title = first.slice(0, maximum).trim() || 'untitled';
  const body = lines.join('\n').trim();
  return { title, body: '' === body ? normalized : body };
}

export function safeArchiveBasename(title: string): string {
  const safe = title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/gu, '');
  return '' === safe || '.' === safe || '..' === safe ? 'untitled' : safe;
}
