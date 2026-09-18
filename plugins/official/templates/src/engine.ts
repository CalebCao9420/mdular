import type { TextWriteOperation } from '@mdular/plugin-sdk';

export const TEMPLATE_LIMITS = Object.freeze({
  maxCustomTemplates: 32,
  maxTemplateNameCharacters: 80,
  maxTemplateCharacters: 32 * 1024,
  maxCustomTemplateCharacters: 40 * 1024,
});

export interface DocumentTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly builtIn: boolean;
}

export interface TemplateVariables {
  readonly title: string;
  readonly date: string;
  readonly path: string;
  readonly filename: string;
}

export const BUILTIN_DOCUMENT_TEMPLATES: readonly DocumentTemplateDefinition[] = Object.freeze([
  Object.freeze({
    id: 'builtin:plain',
    name: 'Plain Markdown',
    body: '',
    builtIn: true,
  }),
  Object.freeze({
    id: 'builtin:frontmatter',
    name: 'Frontmatter document',
    body: [
      '---',
      'status: draft',
      'title: ${title}',
      'tags:',
      'date: ${date}',
      '---',
      '',
      '',
    ].join('\n'),
    builtIn: true,
  }),
]);

const VARIABLE_NAMES = new Set<keyof TemplateVariables>([
  'title',
  'date',
  'path',
  'filename',
]);

export function normalizeTemplatePath(value: string): string {
  if ('string' !== typeof value) { throw new Error('Template path must be a string'); }
  const path = value.trim();
  if (
    '' === path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    /^[A-Za-z]:\//u.test(path)
  ) { throw new Error('Template path must be workspace-relative'); }
  const segments = path.split('/');
  if (segments.some((segment) => '' === segment || '.' === segment || '..' === segment)) {
    throw new Error('Template path contains an invalid segment');
  }
  const extension = segments.at(-1)?.split('.').at(-1)?.toLocaleLowerCase('en-US');
  if (!['md', 'json', 'txt', 'yaml', 'yml'].includes(extension ?? '')) {
    throw new Error('Template output must be Markdown, JSON, text or YAML');
  }
  return path;
}

export function templateVariables(pathValue: string, titleValue: string, date: string): TemplateVariables {
  const path = normalizeTemplatePath(pathValue);
  const filename = path.split('/').at(-1) ?? path;
  const inferredTitle = filename.replace(/\.[^.]+$/u, '');
  const title = String(titleValue || inferredTitle).replace(/[\r\n]+/gu, ' ').trim();
  return { title, date, path, filename };
}

export function renderTemplateBody(body: string, variables: TemplateVariables): string {
  if ('string' !== typeof body || TEMPLATE_LIMITS.maxTemplateCharacters < body.length) {
    throw new Error('Template body is malformed or exceeds the limit');
  }
  const unknown = new Set<string>();
  body.replace(/\$\{([A-Za-z][A-Za-z0-9_-]*)\}/gu, (_match, name: string) => {
    if (!VARIABLE_NAMES.has(name as keyof TemplateVariables)) { unknown.add(name); }
    return '';
  });
  if (0 < unknown.size) {
    throw new Error(`Unknown template variable: ${[...unknown].sort().join(', ')}`);
  }
  return body.replace(
    /\$\{(title|date|path|filename)\}/gu,
    (_match, name: keyof TemplateVariables) => variables[name],
  );
}

export function renderDocumentOperation(options: {
  readonly path: string;
  readonly title: string;
  readonly date: string;
  readonly body: string;
}): TextWriteOperation {
  const variables = templateVariables(options.path, options.title, options.date);
  return {
    path: variables.path,
    content: renderTemplateBody(options.body, variables),
  };
}
