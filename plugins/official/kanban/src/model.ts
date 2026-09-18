export const KANBAN_LIMITS = Object.freeze({
  maxIssues: 2_000,
  maxTotalBytes: 16 * 1024 * 1024,
  maxStatuses: 64,
  maxColumns: 64,
  maxPresets: 32,
  maxTitle: 200,
  maxDescription: 128 * 1024,
});

export interface StatusDefinition {
  readonly id: string;
  readonly label: string;
  readonly source: Readonly<Record<string, unknown>>;
}

export interface StatusConfig {
  readonly version: 1;
  readonly defaultStatus: string;
  readonly statuses: readonly StatusDefinition[];
  readonly source: Readonly<Record<string, unknown>>;
}

export interface BoardColumnDefinition {
  readonly id: string;
  readonly label: string;
  readonly statusId: string | null;
  readonly locked: boolean;
  readonly source: Readonly<Record<string, unknown>>;
}

export interface BoardConfig {
  readonly version: 1;
  readonly columns: readonly BoardColumnDefinition[];
  readonly source: Readonly<Record<string, unknown>>;
}

export interface IssueCard {
  readonly path: string;
  readonly title: string;
  readonly statusId: string;
  readonly statusLabel: string;
  readonly assignee: string;
  readonly priority: string;
  readonly tags: string;
  readonly date: string;
  readonly boardColumn: string;
  readonly columnId: string;
  readonly configured: boolean;
  readonly statusAssociated: boolean;
  readonly writable: boolean;
  readonly schemaVersion: number;
}

export interface KanbanFilter {
  readonly assignee: string;
  readonly tag: string;
  readonly priority: string;
}

export interface KanbanFilterPreset {
  readonly name: string;
  readonly filter: KanbanFilter;
}

export const DEFAULT_STATUSES: readonly Readonly<{ id: string; label: string }>[] = Object.freeze([
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
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if ('string' !== typeof value || '' === value.trim() || maximum < value.length) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function assertSupportedVersion(source: Record<string, unknown>, label: string): void {
  if (undefined === source.version || 1 === source.version) { return; }
  if ('number' === typeof source.version && source.version < 1) { return; }
  throw new Error(`${label} uses unsupported version ${String(source.version)}`);
}

export function defaultStatusConfig(): StatusConfig {
  const source = {
    version: 1,
    defaultStatus: DEFAULT_STATUSES[0]!.id,
    statuses: DEFAULT_STATUSES.map((status) => ({ ...status })),
  };
  return parseStatusConfig(source);
}

export function defaultBoardConfig(statuses = defaultStatusConfig()): BoardConfig {
  const source = {
    version: 1,
    columns: [
      { id: 'col-inbox', label: '收件箱', statusId: null, locked: false },
      ...statuses.statuses.map((status) => ({
        id: `col-${status.id}`,
        label: status.label,
        statusId: status.id,
        locked: false,
      })),
    ],
  };
  return parseBoardConfig(source);
}

export function parseStatusConfig(value: unknown): StatusConfig {
  if (!isRecord(value) || !Array.isArray(value.statuses) || 0 === value.statuses.length ||
      KANBAN_LIMITS.maxStatuses < value.statuses.length) {
    throw new Error('Ticket status configuration is invalid');
  }
  assertSupportedVersion(value, 'Ticket status configuration');
  const seen = new Set<string>();
  const statuses: StatusDefinition[] = [];
  for (const candidate of value.statuses) {
    if (!isRecord(candidate)) { throw new Error('Ticket status entry is invalid'); }
    const id = boundedText(candidate.id, 'Ticket status ID', 128);
    const label = boundedText(candidate.label, 'Ticket status label', 256);
    if (seen.has(id)) { throw new Error(`Ticket status ID is duplicated: ${id}`); }
    seen.add(id);
    statuses.push({ id, label, source: { ...candidate } });
  }
  const defaultStatus = 'string' === typeof value.defaultStatus && seen.has(value.defaultStatus)
    ? value.defaultStatus
    : statuses[0]!.id;
  return { version: 1, defaultStatus, statuses, source: { ...value } };
}

export function parseBoardConfig(value: unknown): BoardConfig {
  if (!isRecord(value) || !Array.isArray(value.columns) || 0 === value.columns.length ||
      KANBAN_LIMITS.maxColumns < value.columns.length) {
    throw new Error('Ticket board configuration is invalid');
  }
  assertSupportedVersion(value, 'Ticket board configuration');
  const ids = new Set<string>();
  const linkedStatuses = new Set<string>();
  const columns: BoardColumnDefinition[] = [];
  for (const candidate of value.columns) {
    if (!isRecord(candidate)) { throw new Error('Ticket board column is invalid'); }
    const id = boundedText(candidate.id, 'Ticket board column ID', 128);
    const label = boundedText(candidate.label, 'Ticket board column label', 256);
    if (ids.has(id)) { throw new Error(`Ticket board column ID is duplicated: ${id}`); }
    ids.add(id);
    let statusId: string | null = null;
    if (null !== candidate.statusId && undefined !== candidate.statusId && '' !== candidate.statusId) {
      statusId = boundedText(candidate.statusId, 'Ticket board status ID', 128);
      if (linkedStatuses.has(statusId)) {
        throw new Error(`Ticket board status is linked more than once: ${statusId}`);
      }
      linkedStatuses.add(statusId);
    }
    columns.push({
      id,
      label,
      statusId,
      locked: true === candidate.locked,
      source: { ...candidate },
    });
  }
  return { version: 1, columns, source: { ...value } };
}

export function serializeStatusConfig(config: StatusConfig): string {
  return `${JSON.stringify({
    ...config.source,
    version: 1,
    defaultStatus: config.defaultStatus,
    statuses: config.statuses.map((status) => ({
      ...status.source,
      id: status.id,
      label: status.label,
    })),
  }, null, 2)}\n`;
}

export function serializeBoardConfig(config: BoardConfig): string {
  return `${JSON.stringify({
    ...config.source,
    version: 1,
    columns: config.columns.map((column) => ({
      ...column.source,
      id: column.id,
      label: column.label,
      statusId: column.statusId,
      locked: column.locked,
    })),
  }, null, 2)}\n`;
}

interface FrontmatterDocument {
  readonly bom: string;
  readonly eol: string;
  readonly lines: string[];
  readonly close: number;
  readonly values: ReadonlyMap<string, string>;
  readonly schemaVersion: number;
}

function scalarValue(raw: string): string {
  const value = raw.trim();
  if (2 <= value.length && '"' === value[0] && '"' === value.at(-1)) {
    try {
      const parsed = JSON.parse(value);
      if ('string' === typeof parsed) { return parsed; }
    } catch { /* retain raw scalar */ }
  }
  if (2 <= value.length && "'" === value[0] && "'" === value.at(-1)) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseFrontmatter(content: string): FrontmatterDocument | null {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? content.slice(1) : content;
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  const lines = source.split(/\r\n|\n|\r/u);
  if ('---' !== lines[0]?.trim()) { return null; }
  const close = lines.findIndex((line, index) => 0 < index && '---' === line.trim());
  if (close < 1) { return null; }
  const values = new Map<string, string>();
  for (let index = 1; index < close; index += 1) {
    const match = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/u.exec(lines[index] ?? '');
    if (match && !values.has(match[1]!)) { values.set(match[1]!, scalarValue(match[2] ?? '')); }
  }
  const rawSchema = values.get('kanbanSchema');
  const schemaVersion = undefined === rawSchema || '' === rawSchema
    ? 0
    : /^[0-9]+$/u.test(rawSchema) ? Number(rawSchema) : Number.NaN;
  return { bom, eol, lines, close, values, schemaVersion };
}

function yamlScalar(value: string): string {
  if ('' === value) { return ''; }
  return /^[A-Za-z0-9_.@/+ -]+$/u.test(value) && value === value.trim()
    ? value
    : JSON.stringify(value);
}

export function patchIssueFrontmatter(
  content: string,
  changes: Readonly<Record<string, string | null>>,
): string {
  let parsed = parseFrontmatter(content);
  if (parsed && (!Number.isSafeInteger(parsed.schemaVersion) || 1 < parsed.schemaVersion)) {
    throw new Error(`Issue uses unsupported kanbanSchema ${String(parsed.schemaVersion)}`);
  }
  if (!parsed) {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? content.slice(1) : content;
    const eol = body.includes('\r\n') ? '\r\n' : body.includes('\r') ? '\r' : '\n';
    const prefix = `---${eol}kanbanSchema: 1${eol}---${eol}${eol}`;
    parsed = parseFrontmatter(`${bom}${prefix}${body}`)!;
  }
  const lines = [...parsed.lines];
  let close = parsed.close;
  const nextChanges = new Map<string, string | null>([
    ['kanbanSchema', '1'],
    ...Object.entries(changes),
  ]);
  for (const [key, value] of nextChanges) {
    const matches: number[] = [];
    for (let index = 1; index < close; index += 1) {
      if (new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:`, 'u').test(lines[index] ?? '')) {
        matches.push(index);
      }
    }
    if (null === value) {
      for (const index of matches.reverse()) { lines.splice(index, 1); close -= 1; }
      continue;
    }
    const rendered = `${key}: ${yamlScalar(value)}`;
    if (0 === matches.length) {
      lines.splice(close, 0, rendered);
      close += 1;
    } else {
      lines[matches[0]!] = rendered;
      for (const index of matches.slice(1).reverse()) { lines.splice(index, 1); close -= 1; }
    }
  }
  return `${parsed.bom}${lines.join(parsed.eol)}`;
}

function basename(path: string): string {
  return path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? path;
}

export function normalizeStatus(raw: string, statuses: StatusConfig): string {
  const key = raw.trim().toLocaleLowerCase('en-US');
  if (!key) { return statuses.defaultStatus; }
  return statuses.statuses.find((status) =>
    status.id.toLocaleLowerCase('en-US') === key ||
    status.label.toLocaleLowerCase('en-US') === key)?.id ?? raw.trim();
}

export function resolveIssueColumn(
  statusId: string,
  boardColumn: string,
  board: BoardConfig,
): string {
  return board.columns.find((column) => column.statusId === statusId)?.id ??
    board.columns.find((column) => column.id === boardColumn)?.id ??
    board.columns.find((column) => null === column.statusId)?.id ??
    board.columns[0]!.id;
}

export function parseIssueCard(
  path: string,
  content: string,
  statuses: StatusConfig,
  board: BoardConfig,
): IssueCard {
  const parsed = parseFrontmatter(content);
  const values = parsed?.values ?? new Map<string, string>();
  const schemaVersion = parsed?.schemaVersion ?? 0;
  const statusId = normalizeStatus((values.get('status') ?? '').slice(0, 128), statuses);
  const status = statuses.statuses.find((candidate) => candidate.id === statusId);
  const boardColumn = (values.get('boardColumn') ?? '').trim().slice(0, 128);
  const statusAssociated = board.columns.some((column) => column.statusId === statusId);
  return {
    path,
    title: ((values.get('title') ?? basename(path)).trim() || basename(path))
      .slice(0, KANBAN_LIMITS.maxTitle),
    statusId,
    statusLabel: status?.label ?? statusId,
    assignee: (values.get('assignee') ?? '').trim().slice(0, 120),
    priority: (values.get('priority') ?? '').trim().slice(0, 120),
    tags: (values.get('tags') ?? '').trim().slice(0, 1024),
    date: (values.get('date') ?? '').trim().slice(0, 64),
    boardColumn,
    columnId: resolveIssueColumn(statusId, boardColumn, board),
    configured: undefined !== status,
    statusAssociated,
    writable: Number.isSafeInteger(schemaVersion) && schemaVersion <= 1,
    schemaVersion,
  };
}

export function issueTags(raw: string): readonly string[] {
  return raw.split(/[,，\s]+/u)
    .map((tag) => tag.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
}

export function matchesIssueFilter(card: IssueCard, filter: KanbanFilter): boolean {
  if (filter.assignee && card.assignee.toLocaleLowerCase('en-US') !==
      filter.assignee.toLocaleLowerCase('en-US')) { return false; }
  if (filter.priority && card.priority.toLocaleLowerCase('en-US') !==
      filter.priority.toLocaleLowerCase('en-US')) { return false; }
  if (filter.tag) {
    const needle = filter.tag.toLocaleLowerCase('en-US');
    if (!issueTags(card.tags).some((tag) => tag === needle || tag.includes(needle))) { return false; }
  }
  return true;
}

export function groupIssuesByColumn(
  cards: readonly IssueCard[],
  board: BoardConfig,
): readonly Readonly<{ column: BoardColumnDefinition; cards: readonly IssueCard[] }>[] {
  const grouped = new Map(board.columns.map((column) => [column.id, [] as IssueCard[]]));
  for (const card of cards) {
    (grouped.get(card.columnId) ?? grouped.get(board.columns[0]!.id))?.push(card);
  }
  return board.columns.map((column) => ({ column, cards: grouped.get(column.id) ?? [] }));
}

export function groupIssuesByStatus(
  cards: readonly IssueCard[],
  statuses: StatusConfig,
): readonly Readonly<{ id: string; label: string; cards: readonly IssueCard[] }>[] {
  const grouped = new Map(statuses.statuses.map((status) => [status.id, [] as IssueCard[]]));
  const orphan: IssueCard[] = [];
  for (const card of cards) {
    const target = grouped.get(card.statusId);
    (target ?? orphan).push(card);
  }
  return [
    ...statuses.statuses.map((status) => ({
      id: `status:${status.id}`,
      label: status.label,
      cards: grouped.get(status.id) ?? [],
    })),
    ...(0 === orphan.length ? [] : [{ id: 'status:unconfigured', label: '未配置状态', cards: orphan }]),
  ];
}

export function buildIssueDocument(input: {
  readonly title: string;
  readonly status: string;
  readonly description?: string;
  readonly assignee?: string;
  readonly priority?: string;
  readonly tags?: string;
  readonly date: string;
}): string {
  const title = input.title.trim().slice(0, KANBAN_LIMITS.maxTitle);
  if (!title) { throw new Error('Issue title is required'); }
  const description = (input.description ?? '').trim().slice(0, KANBAN_LIMITS.maxDescription);
  return [
    '---',
    'kanbanSchema: 1',
    `status: ${yamlScalar(input.status)}`,
    `title: ${yamlScalar(title)}`,
    `priority: ${yamlScalar((input.priority ?? 'medium').trim().slice(0, 120))}`,
    `assignee: ${yamlScalar((input.assignee ?? '').trim().slice(0, 120))}`,
    `tags: ${yamlScalar((input.tags ?? '').trim().slice(0, 1024))}`,
    `date: ${yamlScalar(input.date.slice(0, 64))}`,
    '---',
    '',
    '## 描述',
    '',
    description,
    '',
  ].join('\n');
}

export function issuePathStem(title: string): string {
  const stem = title.normalize('NFC').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 100);
  return stem || 'untitled';
}

export function splitIssueArchiveText(text: string): { readonly title: string; readonly body: string } {
  const normalized = text.replace(/\r\n?/gu, '\n').trim();
  const lines = normalized.split('\n');
  const title = (lines.shift() ?? 'Untitled').trim().slice(0, 100) || 'Untitled';
  return { title, body: lines.join('\n').trim() };
}
