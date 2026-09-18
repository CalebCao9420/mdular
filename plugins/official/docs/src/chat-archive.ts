import type { JsonValue, PluginWorkspaceService } from '@mdular/plugin-sdk';

const TITLE_MAX = 100;
const TEXT_MAX = 64 * 1024;

type ArchiveWorkspace = Required<Pick<
  PluginWorkspaceService,
  'planTextWrites' | 'commitTextWritePlan'
>>;

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function dateIso(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function imageFallbackTitle(now: Date): string {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `Img ${day}.${month}.${year} ${hour}:${minute}`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}

function splitTitleAndBody(
  text: string,
  now: Date,
): { readonly title: string; readonly body: string } {
  const normalized = text.replace(/\r\n?/gu, '\n').trim();
  const lines = normalized.split('\n');
  let title = capitalize((lines[0] ?? '').trim());
  if (/!\[.*?\]\(.*?\)/u.test(title)) {
    title = 1 < lines.length ? capitalize((lines[1] ?? '').trim()) : '';
    if ('' === title) { title = imageFallbackTitle(now); }
  }
  if (TITLE_MAX < [...title].length) {
    title = `${[...title].slice(0, TITLE_MAX).join('')}...`;
  }
  if ('' === title) { title = 'Untitled'; }
  let body = normalized;
  if (title === body) {
    body = '';
  } else if (body.startsWith(title)) {
    body = body.slice(title.length).trim();
  }
  return { title, body };
}

function archiveBasename(title: string): string {
  const normalized = title.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/gu, '')
    .replace(/[ ]+$/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .trim()
    .slice(0, 120);
  if ('' === normalized || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(normalized)) {
    return 'untitled';
  }
  return normalized;
}

function yamlScalar(value: string): string {
  return value === value.trim() &&
    !/[\r\n#:[\]{},&*!|>'"%@`]/u.test(value) &&
    !/^(?:~|null|true|false|yes|no|on|off|[-+]?(?:\d+(?:\.\d+)?|\.inf|\.nan)|\d{4}-\d{2}-\d{2})$/iu.test(value)
    ? value
    : JSON.stringify(value);
}

export function buildDocsArchiveContent(text: string, now = new Date()): {
  readonly title: string;
  readonly content: string;
} {
  const { title, body } = splitTitleAndBody(text, now);
  return {
    title,
    content: [
      '---',
      `title: ${yamlScalar(title)}`,
      `date: ${dateIso(now)}`,
      'tags:',
      '---',
      '',
      ...(body ? [body, ''] : []),
    ].join('\n'),
  };
}

export async function archiveChatMessageToDocs(
  request: JsonValue,
  workspace: ArchiveWorkspace,
  now = new Date(),
): Promise<JsonValue> {
  if (
    !isRecord(request) ||
    1 !== request.schemaVersion ||
    'string' !== typeof request.text ||
    '' === request.text.trim() ||
    TEXT_MAX < request.text.length
  ) { throw new Error('Docs archive request is malformed or exceeds the limit'); }
  const built = buildDocsArchiveContent(request.text, now);
  const basename = archiveBasename(built.title);
  for (let index = 0; index < 1_000; index += 1) {
    const suffix = 0 === index ? '' : ` (${String(index)})`;
    const path = `docs/${basename}${suffix}.md`;
    const plan = await workspace.planTextWrites(
      [{ path, content: built.content }],
      'skip-existing',
    );
    const result = await workspace.commitTextWritePlan(plan.planId);
    if (result.created.includes(path)) {
      return { schemaVersion: 1, path };
    }
    if ('partial' === result.status && !/exist/iu.test(result.failed.kind)) {
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
  }
  throw new Error('No unique Docs archive filename was available');
}
