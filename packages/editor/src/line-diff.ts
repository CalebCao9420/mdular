export const LINE_DIFF_LIMITS = Object.freeze({
  maxMiddleLines: 20_000,
  maxInputBytes: 2 * 1024 * 1024,
  maxEditDistance: 2_000,
  maxComputeMs: 250,
  contextLines: 3,
});

export interface LineDiffLimits {
  readonly maxMiddleLines: number;
  readonly maxInputBytes: number;
  readonly maxEditDistance: number;
  readonly maxComputeMs: number;
  readonly contextLines: number;
}

export type LineDiffLimitReason =
  | 'input-bytes'
  | 'middle-lines'
  | 'edit-distance'
  | 'time';

export interface UnifiedDiffLine {
  readonly kind: 'unchanged' | 'add' | 'delete';
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface UnifiedDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly UnifiedDiffLine[];
}

export type LineDiffResult =
  | { readonly kind: 'identical' }
  | { readonly kind: 'hunks'; readonly hunks: readonly UnifiedDiffHunk[] }
  | {
      readonly kind: 'changed-block';
      readonly reason: LineDiffLimitReason | 'worker-unavailable';
      readonly oldStart: number;
      readonly oldLines: number;
      readonly newStart: number;
      readonly newLines: number;
    };

export interface LineDiffOptions {
  readonly limits?: Partial<LineDiffLimits>;
  readonly now?: () => number;
}

export interface LineDiffWorkerRequest {
  readonly requestId: number;
  readonly bufferVersion: number;
  readonly savedContent: string;
  readonly buffer: string;
}

export interface LineDiffWorkerResponse {
  readonly requestId: number;
  readonly bufferVersion: number;
  readonly result: LineDiffResult;
}

type EditKind = UnifiedDiffLine['kind'];

interface Edit {
  readonly kind: EditKind;
  readonly text: string;
}

interface PositionedLine extends UnifiedDiffLine {
  readonly oldCursor: number;
  readonly newCursor: number;
}

function normalizeContent(content: string): string {
  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return withoutBom.replace(/\r\n?/gu, '\n');
}

function splitLines(content: string): readonly string[] {
  return '' === content ? [] : content.split('\n');
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) as number;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function countLines(content: string): number {
  if ('' === content) { return 0; }
  let lines = 1;
  for (const character of content) {
    if ('\n' === character) { lines += 1; }
  }
  return lines;
}

function changedBlock(
  reason: LineDiffLimitReason | 'worker-unavailable',
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
): LineDiffResult {
  return { kind: 'changed-block', reason, oldStart, oldLines, newStart, newLines };
}

export function createWorkerUnavailableDiff(
  savedContent: string,
  buffer: string,
): LineDiffResult {
  const saved = normalizeContent(savedContent);
  const current = normalizeContent(buffer);
  if (saved === current) { return { kind: 'identical' }; }
  return changedBlock(
    'worker-unavailable',
    1,
    countLines(saved),
    1,
    countLines(current),
  );
}

function readLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || 0 > result) {
    throw new Error(`Line diff ${name} must be a non-negative safe integer`);
  }
  return result;
}

function resolveLimits(options: LineDiffOptions): LineDiffLimits {
  return {
    maxMiddleLines: readLimit(
      options.limits?.maxMiddleLines,
      LINE_DIFF_LIMITS.maxMiddleLines,
      'maxMiddleLines',
    ),
    maxInputBytes: readLimit(
      options.limits?.maxInputBytes,
      LINE_DIFF_LIMITS.maxInputBytes,
      'maxInputBytes',
    ),
    maxEditDistance: readLimit(
      options.limits?.maxEditDistance,
      LINE_DIFF_LIMITS.maxEditDistance,
      'maxEditDistance',
    ),
    maxComputeMs: readLimit(
      options.limits?.maxComputeMs,
      LINE_DIFF_LIMITS.maxComputeMs,
      'maxComputeMs',
    ),
    contextLines: readLimit(
      options.limits?.contextLines,
      LINE_DIFF_LIMITS.contextLines,
      'contextLines',
    ),
  };
}

function backtrack(
  trace: readonly ReadonlyMap<number, number>[],
  saved: readonly string[],
  current: readonly string[],
): readonly Edit[] {
  let x = saved.length;
  let y = current.length;
  const edits: Edit[] = [];
  for (let distance = trace.length - 1; 0 <= distance; distance -= 1) {
    const diagonal = x - y;
    const previous = trace[distance] as ReadonlyMap<number, number>;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        (previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) <
          (previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = previous.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      edits.push({ kind: 'unchanged', text: saved[x - 1] as string });
      x -= 1;
      y -= 1;
    }
    if (0 === distance) { break; }
    if (x === previousX) {
      edits.push({ kind: 'add', text: current[previousY] as string });
    } else {
      edits.push({ kind: 'delete', text: saved[previousX] as string });
    }
    x = previousX;
    y = previousY;
  }
  return edits.reverse();
}

function myersDiff(
  saved: readonly string[],
  current: readonly string[],
  limits: LineDiffLimits,
  now: () => number,
  startedAt: number,
): readonly Edit[] | LineDiffLimitReason {
  const maximumDistance = saved.length + current.length;
  if (Math.abs(saved.length - current.length) > limits.maxEditDistance) {
    return 'edit-distance';
  }
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: ReadonlyMap<number, number>[] = [];
  for (
    let distance = 0;
    distance <= Math.min(maximumDistance, limits.maxEditDistance);
    distance += 1
  ) {
    if (now() - startedAt > limits.maxComputeMs) { return 'time'; }
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const moveDown =
        diagonal === -distance ||
        (diagonal !== distance &&
          (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) <
            (frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY));
      let x = moveDown
        ? frontier.get(diagonal + 1) ?? 0
        : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      let snakeSteps = 0;
      while (x < saved.length && y < current.length && saved[x] === current[y]) {
        x += 1;
        y += 1;
        snakeSteps += 1;
        if (0 === snakeSteps % 256 && now() - startedAt > limits.maxComputeMs) {
          return 'time';
        }
      }
      frontier.set(diagonal, x);
      if (x >= saved.length && y >= current.length) {
        return backtrack(trace, saved, current);
      }
    }
  }
  return 'edit-distance';
}

function positionEdits(
  edits: readonly Edit[],
  oldStart: number,
  newStart: number,
): readonly PositionedLine[] {
  let oldCursor = oldStart;
  let newCursor = newStart;
  return edits.map((edit) => {
    const positioned: PositionedLine = {
      ...edit,
      oldLine: 'add' === edit.kind ? null : oldCursor,
      newLine: 'delete' === edit.kind ? null : newCursor,
      oldCursor,
      newCursor,
    };
    if ('add' !== edit.kind) { oldCursor += 1; }
    if ('delete' !== edit.kind) { newCursor += 1; }
    return positioned;
  });
}

function toHunk(lines: readonly PositionedLine[]): UnifiedDiffHunk {
  const first = lines[0] as PositionedLine;
  return {
    oldStart: first.oldLine ?? first.oldCursor,
    oldLines: lines.filter((line) => 'add' !== line.kind).length,
    newStart: first.newLine ?? first.newCursor,
    newLines: lines.filter((line) => 'delete' !== line.kind).length,
    lines: lines.map(({ kind, text, oldLine, newLine }) => ({
      kind,
      text,
      oldLine,
      newLine,
    })),
  };
}

function createHunks(
  lines: readonly PositionedLine[],
  contextLines: number,
): readonly UnifiedDiffHunk[] {
  const changes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => 'unchanged' !== line.kind)
    .map(({ index }) => index);
  if (0 === changes.length) { return []; }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const change of changes) {
    const start = Math.max(0, change - contextLines);
    const end = Math.min(lines.length, change + contextLines + 1);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges.map(({ start, end }) => toHunk(lines.slice(start, end)));
}

export function computeLineDiff(
  savedContent: string,
  buffer: string,
  options: LineDiffOptions = {},
): LineDiffResult {
  const limits = resolveLimits(options);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const savedNormalized = normalizeContent(savedContent);
  const currentNormalized = normalizeContent(buffer);
  if (savedNormalized === currentNormalized) { return { kind: 'identical' }; }
  if (
    utf8ByteLength(savedNormalized) + utf8ByteLength(currentNormalized) >
    limits.maxInputBytes
  ) {
    return changedBlock(
      'input-bytes',
      1,
      countLines(savedNormalized),
      1,
      countLines(currentNormalized),
    );
  }

  const savedLines = splitLines(savedNormalized);
  const currentLines = splitLines(currentNormalized);
  let prefix = 0;
  while (
    prefix < savedLines.length &&
    prefix < currentLines.length &&
    savedLines[prefix] === currentLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < savedLines.length - prefix &&
    suffix < currentLines.length - prefix &&
    savedLines[savedLines.length - suffix - 1] ===
      currentLines[currentLines.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const savedMiddle = savedLines.slice(prefix, savedLines.length - suffix);
  const currentMiddle = currentLines.slice(prefix, currentLines.length - suffix);
  if (savedMiddle.length + currentMiddle.length > limits.maxMiddleLines) {
    return changedBlock(
      'middle-lines',
      prefix + 1,
      savedMiddle.length,
      prefix + 1,
      currentMiddle.length,
    );
  }

  const middle = myersDiff(savedMiddle, currentMiddle, limits, now, startedAt);
  if ('string' === typeof middle) {
    return changedBlock(
      middle,
      prefix + 1,
      savedMiddle.length,
      prefix + 1,
      currentMiddle.length,
    );
  }

  const contextStart = Math.max(0, prefix - limits.contextLines);
  const prefixContext: Edit[] = savedLines
    .slice(contextStart, prefix)
    .map((text) => ({ kind: 'unchanged', text }));
  const suffixContext: Edit[] = savedLines
    .slice(savedLines.length - suffix, savedLines.length - suffix + limits.contextLines)
    .map((text) => ({ kind: 'unchanged', text }));
  const positioned = positionEdits(
    [...prefixContext, ...middle, ...suffixContext],
    contextStart + 1,
    contextStart + 1,
  );
  const hunks = createHunks(positioned, limits.contextLines);
  return 0 === hunks.length ? { kind: 'identical' } : { kind: 'hunks', hunks };
}
