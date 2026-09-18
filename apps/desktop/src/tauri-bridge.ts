import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { DesktopBridge } from './workspace-adapter.js';

export interface TauriApiTransport {
  invoke<TResult>(command: string, args: Record<string, unknown>): Promise<TResult>;
  listen<TPayload>(
    event: string,
    listener: (event: { readonly payload: TPayload }) => void,
  ): Promise<() => void>;
}

const defaultTransport: TauriApiTransport = {
  invoke,
  listen,
};

export function createTauriDesktopBridge(
  transport: TauriApiTransport = defaultTransport,
): DesktopBridge {
  return {
    invoke<TResult>(command: string, args: Record<string, unknown>): Promise<TResult> {
      return transport.invoke<TResult>(command, args);
    },
    listen<TPayload>(
      event: string,
      listener: (payload: TPayload) => void,
    ): Promise<() => void> {
      return transport.listen<TPayload>(event, (message) => listener(message.payload));
    },
  };
}

export const tauriDesktopBridge = createTauriDesktopBridge();
