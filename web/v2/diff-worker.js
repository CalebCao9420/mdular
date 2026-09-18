// Generated from src/ — edit TypeScript and run: npm run build


// packages/editor/src/pane-controller.ts
var EMPTY_VIEW = Object.freeze({
  selectionAnchor: 0,
  selectionHead: 0,
  scrollLeft: 0,
  scrollTop: 0,
  focused: false
});

// packages/editor/src/line-diff.ts
var LINE_DIFF_LIMITS = Object.freeze({
  maxMiddleLines: 2e4,
  maxInputBytes: 2 * 1024 * 1024,
  maxEditDistance: 2e3,
  maxComputeMs: 250,
  contextLines: 3
});
function normalizeContent(content) {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  return withoutBom.replace(/\r\n?/gu, "\n");
}
function splitLines(content) {
  return "" === content ? [] : content.split("\n");
}
function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4;
  }
  return bytes;
}
function countLines(content) {
  if ("" === content) {
    return 0;
  }
  let lines = 1;
  for (const character of content) {
    if ("\n" === character) {
      lines += 1;
    }
  }
  return lines;
}
function changedBlock(reason, oldStart, oldLines, newStart, newLines) {
  return { kind: "changed-block", reason, oldStart, oldLines, newStart, newLines };
}
function readLimit(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || 0 > result) {
    throw new Error(`Line diff ${name} must be a non-negative safe integer`);
  }
  return result;
}
function resolveLimits(options) {
  return {
    maxMiddleLines: readLimit(
      options.limits?.maxMiddleLines,
      LINE_DIFF_LIMITS.maxMiddleLines,
      "maxMiddleLines"
    ),
    maxInputBytes: readLimit(
      options.limits?.maxInputBytes,
      LINE_DIFF_LIMITS.maxInputBytes,
      "maxInputBytes"
    ),
    maxEditDistance: readLimit(
      options.limits?.maxEditDistance,
      LINE_DIFF_LIMITS.maxEditDistance,
      "maxEditDistance"
    ),
    maxComputeMs: readLimit(
      options.limits?.maxComputeMs,
      LINE_DIFF_LIMITS.maxComputeMs,
      "maxComputeMs"
    ),
    contextLines: readLimit(
      options.limits?.contextLines,
      LINE_DIFF_LIMITS.contextLines,
      "contextLines"
    )
  };
}
function backtrack(trace, saved, current) {
  let x = saved.length;
  let y = current.length;
  const edits = [];
  for (let distance = trace.length - 1; 0 <= distance; distance -= 1) {
    const diagonal = x - y;
    const previous = trace[distance];
    const previousDiagonal = diagonal === -distance || diagonal !== distance && (previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) < (previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY) ? diagonal + 1 : diagonal - 1;
    const previousX = previous.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      edits.push({ kind: "unchanged", text: saved[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (0 === distance) {
      break;
    }
    if (x === previousX) {
      edits.push({ kind: "add", text: current[previousY] });
    } else {
      edits.push({ kind: "delete", text: saved[previousX] });
    }
    x = previousX;
    y = previousY;
  }
  return edits.reverse();
}
function myersDiff(saved, current, limits, now, startedAt) {
  const maximumDistance = saved.length + current.length;
  if (Math.abs(saved.length - current.length) > limits.maxEditDistance) {
    return "edit-distance";
  }
  let frontier = /* @__PURE__ */ new Map([[1, 0]]);
  const trace = [];
  for (let distance = 0; distance <= Math.min(maximumDistance, limits.maxEditDistance); distance += 1) {
    if (now() - startedAt > limits.maxComputeMs) {
      return "time";
    }
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const moveDown = diagonal === -distance || diagonal !== distance && (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) < (frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY);
      let x = moveDown ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      let snakeSteps = 0;
      while (x < saved.length && y < current.length && saved[x] === current[y]) {
        x += 1;
        y += 1;
        snakeSteps += 1;
        if (0 === snakeSteps % 256 && now() - startedAt > limits.maxComputeMs) {
          return "time";
        }
      }
      frontier.set(diagonal, x);
      if (x >= saved.length && y >= current.length) {
        return backtrack(trace, saved, current);
      }
    }
  }
  return "edit-distance";
}
function positionEdits(edits, oldStart, newStart) {
  let oldCursor = oldStart;
  let newCursor = newStart;
  return edits.map((edit) => {
    const positioned = {
      ...edit,
      oldLine: "add" === edit.kind ? null : oldCursor,
      newLine: "delete" === edit.kind ? null : newCursor,
      oldCursor,
      newCursor
    };
    if ("add" !== edit.kind) {
      oldCursor += 1;
    }
    if ("delete" !== edit.kind) {
      newCursor += 1;
    }
    return positioned;
  });
}
function toHunk(lines) {
  const first = lines[0];
  return {
    oldStart: first.oldLine ?? first.oldCursor,
    oldLines: lines.filter((line) => "add" !== line.kind).length,
    newStart: first.newLine ?? first.newCursor,
    newLines: lines.filter((line) => "delete" !== line.kind).length,
    lines: lines.map(({ kind, text, oldLine, newLine }) => ({
      kind,
      text,
      oldLine,
      newLine
    }))
  };
}
function createHunks(lines, contextLines) {
  const changes = lines.map((line, index) => ({ line, index })).filter(({ line }) => "unchanged" !== line.kind).map(({ index }) => index);
  if (0 === changes.length) {
    return [];
  }
  const ranges = [];
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
function computeLineDiff(savedContent, buffer, options = {}) {
  const limits = resolveLimits(options);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const savedNormalized = normalizeContent(savedContent);
  const currentNormalized = normalizeContent(buffer);
  if (savedNormalized === currentNormalized) {
    return { kind: "identical" };
  }
  if (utf8ByteLength(savedNormalized) + utf8ByteLength(currentNormalized) > limits.maxInputBytes) {
    return changedBlock(
      "input-bytes",
      1,
      countLines(savedNormalized),
      1,
      countLines(currentNormalized)
    );
  }
  const savedLines = splitLines(savedNormalized);
  const currentLines = splitLines(currentNormalized);
  let prefix = 0;
  while (prefix < savedLines.length && prefix < currentLines.length && savedLines[prefix] === currentLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < savedLines.length - prefix && suffix < currentLines.length - prefix && savedLines[savedLines.length - suffix - 1] === currentLines[currentLines.length - suffix - 1]) {
    suffix += 1;
  }
  const savedMiddle = savedLines.slice(prefix, savedLines.length - suffix);
  const currentMiddle = currentLines.slice(prefix, currentLines.length - suffix);
  if (savedMiddle.length + currentMiddle.length > limits.maxMiddleLines) {
    return changedBlock(
      "middle-lines",
      prefix + 1,
      savedMiddle.length,
      prefix + 1,
      currentMiddle.length
    );
  }
  const middle = myersDiff(savedMiddle, currentMiddle, limits, now, startedAt);
  if ("string" === typeof middle) {
    return changedBlock(
      middle,
      prefix + 1,
      savedMiddle.length,
      prefix + 1,
      currentMiddle.length
    );
  }
  const contextStart = Math.max(0, prefix - limits.contextLines);
  const prefixContext = savedLines.slice(contextStart, prefix).map((text) => ({ kind: "unchanged", text }));
  const suffixContext = savedLines.slice(savedLines.length - suffix, savedLines.length - suffix + limits.contextLines).map((text) => ({ kind: "unchanged", text }));
  const positioned = positionEdits(
    [...prefixContext, ...middle, ...suffixContext],
    contextStart + 1,
    contextStart + 1
  );
  const hunks = createHunks(positioned, limits.contextLines);
  return 0 === hunks.length ? { kind: "identical" } : { kind: "hunks", hunks };
}

// apps/desktop/src/diff-worker.ts
var workerScope = globalThis;
workerScope.onmessage = (event) => {
  const request = event.data;
  const response = {
    requestId: request.requestId,
    bufferVersion: request.bufferVersion,
    result: computeLineDiff(request.savedContent, request.buffer)
  };
  workerScope.postMessage(response);
};
