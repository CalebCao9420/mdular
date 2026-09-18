import { getCurrentWindow } from '@tauri-apps/api/window';

import type { Disposable } from '@mdular/core';

export interface WindowCloseRequest {
  preventDefault(): void;
}

export interface DesktopWindowLifecycle {
  onCloseRequested(
    handler: (event: WindowCloseRequest) => void | Promise<void>,
  ): Promise<Disposable>;
  destroy(): Promise<void>;
}

export function createTauriWindowLifecycle(): DesktopWindowLifecycle {
  return {
    async onCloseRequested(handler): Promise<Disposable> {
      const unlisten = await getCurrentWindow().onCloseRequested(handler);
      return { dispose: unlisten };
    },
    destroy(): Promise<void> {
      return getCurrentWindow().destroy();
    },
  };
}
