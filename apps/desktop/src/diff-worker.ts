import { computeLineDiff } from '@mdular/editor';
import type {
  LineDiffWorkerRequest,
  LineDiffWorkerResponse,
} from '@mdular/editor';

interface WorkerScope {
  onmessage: ((event: MessageEvent<LineDiffWorkerRequest>) => void) | null;
  postMessage(message: LineDiffWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event): void => {
  const request = event.data;
  const response: LineDiffWorkerResponse = {
    requestId: request.requestId,
    bufferVersion: request.bufferVersion,
    result: computeLineDiff(request.savedContent, request.buffer),
  };
  workerScope.postMessage(response);
};
