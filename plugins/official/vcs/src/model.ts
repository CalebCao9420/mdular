import type {
  PluginDocumentSaveState,
  PluginReaderBlock,
  PluginVcsDiffResult,
  PluginVcsStatusEntry,
} from '@mdular/plugin-sdk';

export const VCS_LIMITS = Object.freeze({
  renderedStatusEntries: 500,
  renderedDiffBytes: 512 * 1024,
  diffBlockCharacters: 60 * 1024,
});

export interface VcsDisplayEntry {
  readonly path: string;
  readonly status?: PluginVcsStatusEntry;
  readonly unsaved: boolean;
}

export function mergeVcsStatus(
  entries: readonly PluginVcsStatusEntry[],
  documents: readonly PluginDocumentSaveState[],
): readonly VcsDisplayEntry[] {
  const byPath = new Map<string, VcsDisplayEntry>();
  for (const entry of entries) {
    if (!byPath.has(entry.path)) {
      byPath.set(entry.path, { path: entry.path, status: entry, unsaved: false });
    }
  }
  for (const openState of documents) {
    if (!openState.dirty) { continue; }
    const current = byPath.get(openState.path);
    byPath.set(openState.path, current
      ? { ...current, unsaved: true }
      : { path: openState.path, unsaved: true });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function visibleStatusCode(entry: PluginVcsStatusEntry): string {
  return entry.status.replaceAll(' ', '·').replaceAll('.', '·');
}

function boundedPrefix(text: string, maximumBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maximumBytes) {
    return { text, truncated: false };
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { text: text.slice(0, low), truncated: true };
}

export function diffReaderBlocks(result: PluginVcsDiffResult): {
  readonly blocks: readonly PluginReaderBlock[];
  readonly truncated: boolean;
} {
  const blocks: PluginReaderBlock[] = [];
  let remaining = VCS_LIMITS.renderedDiffBytes;
  let truncated = false;
  for (const section of result.sections) {
    if (0 >= remaining) {
      truncated = truncated || 0 < section.text.length;
      continue;
    }
    const bounded = boundedPrefix(section.text, remaining);
    remaining -= new TextEncoder().encode(bounded.text).byteLength;
    truncated = truncated || bounded.truncated || section.truncated;
    if ('' === bounded.text) { continue; }
    blocks.push({
      id: `section-${String(blocks.length)}`,
      kind: 'heading',
      level: 2,
      text: 'staged' === section.kind ? 'Staged changes' : 'Working tree changes',
    });
    for (let offset = 0; offset < bounded.text.length; offset += VCS_LIMITS.diffBlockCharacters) {
      blocks.push({
        id: `diff-${String(blocks.length)}`,
        kind: 'code',
        language: 'diff',
        text: bounded.text.slice(offset, offset + VCS_LIMITS.diffBlockCharacters),
      });
    }
  }
  return { blocks, truncated };
}
