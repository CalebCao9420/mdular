const FRONTMATTER_FILTER_KEYS = new Set([
  'status',
  'tags',
  'tag',
  'title',
  'date',
  'author',
  'category',
  'priority',
  'assignee',
]);

export interface ParsedSearchQuery {
  readonly text: string;
  readonly folderPath: string | null;
  readonly filters: Readonly<Record<string, string>>;
  readonly browseFolder: string | null;
}

function normalizeFolder(raw: string): string | null {
  const normalized = raw.trim().replace(/^\/+|\/+$/gu, '');
  return '' === normalized ? null : normalized;
}

export function parseSearchQuery(
  raw: string,
  knownDirectories: ReadonlySet<string> = new Set(),
): ParsedSearchQuery {
  const input = raw.trim();
  if ('' === input) {
    return { text: '', folderPath: null, filters: {}, browseFolder: null };
  }
  if (input.endsWith('/') && !/\s/u.test(input)) {
    return {
      text: '',
      folderPath: null,
      filters: {},
      browseFolder: normalizeFolder(input),
    };
  }

  const filters: Record<string, string> = {};
  const textParts: string[] = [];
  let folderPath: string | null = null;
  for (const token of input.split(/\s+/u).filter(Boolean)) {
    const scope = token.match(/^(?:in|path):(.+)$/iu);
    if (scope?.[1]) {
      folderPath = normalizeFolder(scope[1]);
      continue;
    }
    const tag = token.match(/^#([^\s#]+)$/u);
    if (tag?.[1]) {
      filters.tags = tag[1].toLocaleLowerCase('en-US');
      continue;
    }
    const field = token.match(/^([a-z_.-]+):(.+)$/iu);
    if (field?.[1] && field[2] && FRONTMATTER_FILTER_KEYS.has(
      field[1].toLocaleLowerCase('en-US'),
    )) {
      const key = 'tag' === field[1].toLocaleLowerCase('en-US')
        ? 'tags'
        : field[1].toLocaleLowerCase('en-US');
      filters[key] = field[2].toLocaleLowerCase('en-US');
      continue;
    }
    if (
      !folderPath &&
      0 === textParts.length &&
      0 === Object.keys(filters).length &&
      token.includes('/')
    ) {
      const separator = token.lastIndexOf('/');
      const directory = normalizeFolder(token.slice(0, separator));
      const filename = token.slice(separator + 1);
      if (directory && filename) {
        folderPath = directory;
        textParts.push(filename);
        continue;
      }
    }
    textParts.push(token);
  }

  if (
    2 === textParts.length &&
    !folderPath &&
    0 === Object.keys(filters).length &&
    knownDirectories.has(textParts[0] ?? '')
  ) {
    folderPath = normalizeFolder(textParts.shift() ?? '');
  }

  return {
    text: textParts.join(' ').toLocaleLowerCase('en-US'),
    folderPath,
    filters,
    browseFolder: null,
  };
}

export function metadataMatches(
  metadata: Readonly<Record<string, string>>,
  filters: Readonly<Record<string, string>>,
): boolean {
  for (const [key, wanted] of Object.entries(filters)) {
    const value = (metadata[key] ?? '').toLocaleLowerCase('en-US');
    if ('tags' === key) {
      const tags = value
        .replace(/^\[|\]$/gu, '')
        .split(/[\s,]+/u)
        .map((tag) => tag.replace(/^['"]|['"]$/gu, ''))
        .filter(Boolean);
      if (!value.includes(wanted) && !tags.includes(wanted)) { return false; }
    } else if (!value.includes(wanted)) {
      return false;
    }
  }
  return true;
}
