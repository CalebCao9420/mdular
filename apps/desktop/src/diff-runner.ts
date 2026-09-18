import { createWorkerUnavailableDiff } from '@mdular/editor';
import type {
  Disposable,
} from '@mdular/core';
import type {
  LineDiffResult,
  LineDiffWorkerRequest,
  LineDiffWorkerResponse,
} from '@mdular/editor';

export interface DiffWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: LineDiffWorkerRequest): void;
  terminate(): void;
}

export type DiffWorkerFactory = () => DiffWorkerPort;

export interface LineDiffCompletion {
  readonly bufferVersion: number;
  readonly result: LineDiffResult;
}

function decodeResponse(value: unknown): LineDiffWorkerResponse | null {
  if (!value || 'object' !== typeof value) { return null; }
  const response = value as Partial<LineDiffWorkerResponse>;
  if (
    !Number.isSafeInteger(response.requestId) ||
    !Number.isSafeInteger(response.bufferVersion) ||
    !response.result ||
    'object' !== typeof response.result
  ) {
    return null;
  }
  const kind = (response.result as Partial<LineDiffResult>).kind;
  if ('identical' !== kind && 'hunks' !== kind && 'changed-block' !== kind) { return null; }
  return response as LineDiffWorkerResponse;
}

export class LineDiffTaskRunner implements Disposable {
  readonly #factory: DiffWorkerFactory;
  #nextRequestId = 1;
  #active: { readonly requestId: number; readonly worker: DiffWorkerPort } | null = null;
  #disposed = false;

  public constructor(factory: DiffWorkerFactory) {
    this.#factory = factory;
  }

  public request(
    savedContent: string,
    buffer: string,
    bufferVersion: number,
    complete: (completion: LineDiffCompletion) => void,
  ): Disposable {
    if (this.#disposed) { throw new Error('Cannot request diff from a disposed runner'); }
    this.#cancelActive();
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    let worker: DiffWorkerPort;
    try {
      worker = this.#factory();
    } catch {
      complete({
        bufferVersion,
        result: createWorkerUnavailableDiff(savedContent, buffer),
      });
      return { dispose() {} };
    }
    this.#active = { requestId, worker };
    worker.onmessage = (event): void => {
      const response = decodeResponse(event.data);
      if (
        !response ||
        this.#active?.worker !== worker ||
        response.requestId !== requestId ||
        response.bufferVersion !== bufferVersion
      ) {
        return;
      }
      this.#active = null;
      worker.terminate();
      complete({ bufferVersion, result: response.result });
    };
    worker.onerror = (event): void => {
      event.preventDefault();
      if (this.#active?.worker !== worker) { return; }
      this.#active = null;
      worker.terminate();
      complete({
        bufferVersion,
        result: createWorkerUnavailableDiff(savedContent, buffer),
      });
    };
    worker.postMessage({
      requestId,
      bufferVersion,
      savedContent,
      buffer,
    });
    return {
      dispose: () => {
        if (this.#active?.worker === worker) { this.#cancelActive(); }
      },
    };
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#cancelActive();
  }

  #cancelActive(): void {
    const active = this.#active;
    this.#active = null;
    if (!active) { return; }
    active.worker.onmessage = null;
    active.worker.onerror = null;
    active.worker.terminate();
  }
}

export function createDesktopLineDiffRunner(hostWindow: Window): LineDiffTaskRunner {
  return new LineDiffTaskRunner(() => {
    const WorkerConstructor = (
      hostWindow as Window & { readonly Worker?: typeof Worker }
    ).Worker;
    if ('function' !== typeof WorkerConstructor) {
      throw new Error('Module workers are unavailable');
    }
    const workerUrl = new URL('v2/diff-worker.js', hostWindow.location.href);
    return new WorkerConstructor(
      workerUrl,
      { type: 'module', name: 'mdular-line-diff' },
    );
  });
}
