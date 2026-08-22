export type {
  PluginActivationEvent,
  PluginCommandContribution,
  PluginContributions,
  PluginManifestV1,
  PluginPermission,
  PluginViewContribution,
} from '@mdular/plugin-manifest';

export type MaybePromise<T> = T | Promise<T>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface Disposable {
  dispose(): MaybePromise<void>;
}

export interface SubscriptionCollection {
  add<TDisposable extends Disposable>(disposable: TDisposable): TDisposable;
}

export type PluginCommandHandler = (
  args: readonly JsonValue[],
) => MaybePromise<JsonValue | undefined>;

export interface PluginCommandService {
  register(commandId: string, handler: PluginCommandHandler): Disposable;
  execute(commandId: string, args?: readonly JsonValue[]): Promise<JsonValue | undefined>;
}

export interface MarkdownWorkspaceChange {
  readonly path: string;
  readonly kind: 'created' | 'changed' | 'deleted';
}

/** All paths accepted or returned here are workspace-relative; native absolute paths are hidden. */
export interface PluginWorkspaceService {
  readMarkdown(path: string): Promise<string>;
  writeMarkdown(path: string, text: string): Promise<void>;
  listMarkdown(directory?: string): Promise<readonly string[]>;
  watchMarkdown(listener: (change: MarkdownWorkspaceChange) => void): Disposable;
}

export interface OpenMarkdownOptions {
  readonly placement?: 'active-pane' | 'secondary-pane';
  readonly focus?: boolean;
}

export interface PluginNavigationService {
  openMarkdown(path: string, options?: OpenMarkdownOptions): Promise<void>;
}

export interface PluginViewAction {
  readonly type: string;
  readonly payload?: JsonValue;
}

/** Declarative state/action bridge; plugins never receive a DOM element. */
export interface PluginViewService {
  setState(viewId: string, state: JsonValue): void;
  onAction(
    viewId: string,
    listener: (action: PluginViewAction) => MaybePromise<void>,
  ): Disposable;
  reveal(viewId: string): Promise<void>;
}

export interface PluginLogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, data?: JsonValue): void;
}

export interface PluginServices {
  readonly commands: PluginCommandService;
  readonly workspace: PluginWorkspaceService;
  readonly navigation: PluginNavigationService;
  readonly views: PluginViewService;
  readonly logger: PluginLogger;
}

export interface PluginContext extends PluginServices {
  readonly pluginId: string;
  readonly subscriptions: SubscriptionCollection;
}

export interface PluginModule {
  activate(context: PluginContext): MaybePromise<void | Disposable>;
  deactivate?(): MaybePromise<void>;
}

export function definePlugin<const TPlugin extends PluginModule>(plugin: TPlugin): TPlugin {
  return plugin;
}
