import type {
  Disposable,
  PrepareForRestartResult,
  RestartBlockReason,
} from '@mdular/core';

import type { DesktopBridge } from './workspace-adapter.js';

interface PrepareRestartRequest {
  readonly requestId: string;
  readonly version: string;
  readonly timeoutMs: 60_000;
}

interface PrepareRestartReason {
  readonly kind: RestartBlockReason['kind'] | 'unsaved-changes';
  readonly message?: string;
}

type PrepareRestartResponse =
  | { readonly kind: 'ready' }
  | { readonly kind: 'blocked'; readonly reasons: readonly PrepareRestartReason[] }
  | { readonly kind: 'cancelled' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function decodeRequest(value: unknown): PrepareRestartRequest | null {
  if (!isRecord(value)) { return null; }
  if (
    'string' !== typeof value.requestId ||
    !/^restart-[1-9][0-9]*$/u.test(value.requestId) ||
    128 < value.requestId.length ||
    'string' !== typeof value.version ||
    '' === value.version.trim() ||
    60_000 !== value.timeoutMs
  ) { return null; }
  return {
    requestId: value.requestId,
    version: value.version,
    timeoutMs: 60_000,
  };
}

function reasonForHost(reason: RestartBlockReason): PrepareRestartReason {
  if ('save-error' === reason.kind || 'recovery-error' === reason.kind) {
    return { kind: reason.kind, message: reason.message.slice(0, 512) };
  }
  return { kind: reason.kind };
}

function responseForHost(result: PrepareForRestartResult): PrepareRestartResponse {
  return 'ready' === result.kind
    ? { kind: 'ready' }
    : { kind: 'blocked', reasons: result.reasons.map(reasonForHost) };
}

/**
 * Installs the sole V2 response path for the Rust-owned updater. The updater never grants the
 * frontend direct download/install/restart capability; this listener may only answer a current
 * request after Core has flushed recovery or returned typed blockers.
 */
export async function installUpdaterRestartHandshake(
  bridge: DesktopBridge,
  prepareForRestart: () => Promise<PrepareForRestartResult>,
): Promise<Disposable> {
  let disposed = false;
  const inFlight = new Set<string>();
  const unlisten = await bridge.listen<unknown>('update-prepare-restart', (payload) => {
    const request = decodeRequest(payload);
    if (!request || disposed || inFlight.has(request.requestId)) { return; }
    inFlight.add(request.requestId);
    void (async () => {
      let result: PrepareRestartResponse;
      try {
        result = responseForHost(await prepareForRestart());
      } catch {
        result = {
          kind: 'blocked',
          reasons: [{
            kind: 'recovery-error',
            message: 'Application restart preparation failed',
          }],
        };
      }
      if (disposed) { return; }
      try {
        await bridge.invoke('updater_respond_prepare_restart', {
          requestId: request.requestId,
          result,
        });
      } catch {
        // A late response after the host timeout is intentionally ignored.
      } finally {
        inFlight.delete(request.requestId);
      }
    })();
  });
  return {
    dispose() {
      if (disposed) { return; }
      disposed = true;
      inFlight.clear();
      unlisten();
    },
  };
}
