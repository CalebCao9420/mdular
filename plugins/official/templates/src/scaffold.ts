import type { TextWriteOperation } from '@mdular/plugin-sdk';

import {
  normalizeTemplatePath,
  renderTemplateBody,
  templateVariables,
} from './engine.js';

export interface ScaffoldFileDefinition {
  readonly path: string;
  readonly content: string;
}

export interface ScaffoldPackageDefinition {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly files: readonly ScaffoldFileDefinition[];
}

const ticketStatuses = {
  version: 1,
  defaultStatus: 'pending-assign',
  statuses: [
    { id: 'pending-assign', label: '待分配' },
    { id: 'assigned-waiting', label: '已分配等待中' },
    { id: 'in-progress', label: '进行中' },
    { id: 'done-pending-review', label: '初版完成待验收' },
    { id: 'reviewing', label: '验收中' },
    { id: 'review-done-pending-test', label: '验收完成待测试' },
    { id: 'testing', label: '测试中' },
    { id: 'done', label: '验测完成' },
    { id: 'requirement-rejected', label: '需求驳回' },
    { id: 'review-failed', label: '验收不通过' },
    { id: 'test-failed', label: '测试不通过' },
  ],
};

const ticketBoard = {
  version: 1,
  columns: [
    { id: 'col-inbox', label: '收件箱', statusId: null, locked: false },
    ...ticketStatuses.statuses.map((status) => ({
      id: `col-${status.id}`,
      label: status.label,
      statusId: status.id,
      locked: false,
    })),
  ],
};

export const DEFAULT_SCAFFOLD_PACKAGE: ScaffoldPackageDefinition = Object.freeze({
  schemaVersion: 1,
  name: 'Standard project documentation',
  files: Object.freeze([
    Object.freeze({
      path: 'docs/README.md',
      content: [
        '# Project documentation',
        '',
        'Design notes, API references and decisions belong here.',
        '',
        '- `design/` — architecture and design',
        '- Other topics — Markdown files in this directory',
        '',
      ].join('\n'),
    }),
    Object.freeze({
      path: 'docs/design/README.md',
      content: '# Design documents\n\nArchitecture, module boundaries and interface agreements.\n',
    }),
    Object.freeze({
      path: 'issues/ticket-statuses.json',
      content: `${JSON.stringify(ticketStatuses, null, 2)}\n`,
    }),
    Object.freeze({
      path: 'issues/ticket-board.json',
      content: `${JSON.stringify(ticketBoard, null, 2)}\n`,
    }),
    Object.freeze({
      path: 'issues/README.md',
      content: [
        '# Issues',
        '',
        'Each Markdown file in this directory is a ticket.',
        '',
        '```yaml',
        '---',
        'status: pending-assign',
        'title: Example ticket',
        'boardColumn: col-inbox',
        'assignee:',
        'priority: medium',
        'tags: feature',
        'date: ${date}',
        '---',
        '```',
        '',
      ].join('\n'),
    }),
    Object.freeze({
      path: 'changelog/CHANGELOG.md',
      content: '# Changelog\n\n## Unreleased\n\n### Added\n\n- \n',
    }),
  ]),
});

export const DEFAULT_SCAFFOLD_PACKAGE_JSON = `${JSON.stringify(
  DEFAULT_SCAFFOLD_PACKAGE,
  null,
  2,
)}\n`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

export function parseScaffoldPackage(source: string): ScaffoldPackageDefinition {
  if ('string' !== typeof source || 48 * 1024 < source.length) {
    throw new Error('Scaffold package is malformed or exceeds the editor limit');
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Scaffold package JSON is invalid: ${error instanceof Error ? error.message : error}`);
  }
  if (
    !isRecord(value) ||
    1 !== value.schemaVersion ||
    'string' !== typeof value.name ||
    '' === value.name.trim() ||
    !Array.isArray(value.files) ||
    0 === value.files.length ||
    128 < value.files.length
  ) { throw new Error('Scaffold package shape is invalid'); }
  const seen = new Set<string>();
  const files = value.files.map((file) => {
    if (!isRecord(file) || 'string' !== typeof file.path || 'string' !== typeof file.content) {
      throw new Error('Scaffold package file is malformed');
    }
    const path = normalizeTemplatePath(file.path);
    const identity = path.toLocaleLowerCase('en-US');
    if (seen.has(identity)) { throw new Error(`Scaffold package repeats ${path}`); }
    seen.add(identity);
    return { path, content: file.content };
  });
  return { schemaVersion: 1, name: value.name.trim(), files };
}

function prefixedPath(prefixValue: string, path: string): string {
  const prefix = prefixValue.trim().replace(/^\/+|\/+$/gu, '');
  return normalizeTemplatePath('' === prefix ? path : `${prefix}/${path}`);
}

export function renderScaffoldOperations(options: {
  readonly packageDefinition: ScaffoldPackageDefinition;
  readonly prefix: string;
  readonly preset: 'standard' | 'docs-only';
  readonly date: string;
}): readonly TextWriteOperation[] {
  const files = 'docs-only' === options.preset
    ? options.packageDefinition.files.filter((file) => file.path.startsWith('docs/'))
    : options.packageDefinition.files;
  if (0 === files.length) { throw new Error('Selected scaffold preset has no files'); }
  return files.map((file) => {
    const path = prefixedPath(options.prefix, file.path);
    const variables = templateVariables(path, '', options.date);
    return { path, content: renderTemplateBody(file.content, variables) };
  });
}
