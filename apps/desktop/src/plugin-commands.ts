import type {
  JsonValue,
  PluginCommandHandler,
  PluginCommandService,
  PluginManifestV1,
} from '@mdular/plugin-sdk';

import type { DesktopPluginFailureHandler } from './plugin-documents.js';

interface RegisteredCommand {
  readonly pluginId: string;
  readonly handler: PluginCommandHandler;
  readonly button: HTMLButtonElement;
  readonly keybindings: readonly string[];
}

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

function canonicalKeybinding(value: string): string {
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier));
  return [...modifiers, key].join('+');
}

function eventKeybindings(event: KeyboardEvent): readonly string[] {
  const explicitModifiers: string[] = [];
  if (event.ctrlKey) { explicitModifiers.push('Ctrl'); }
  if (event.metaKey) { explicitModifiers.push('Meta'); }
  if (event.altKey) { explicitModifiers.push('Alt'); }
  if (event.shiftKey) { explicitModifiers.push('Shift'); }
  const key = 1 === event.key.length ? event.key.toLocaleUpperCase('en-US') : event.key;
  if (0 === explicitModifiers.length || !/^(?:[A-Z0-9]|Enter|Escape)$/u.test(key)) { return []; }
  const values = [canonicalKeybinding([...explicitModifiers, key].join('+'))];
  if (event.metaKey || event.ctrlKey) {
    values.push(canonicalKeybinding([
      'Mod',
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey ? ['Shift'] : []),
      key,
    ].join('+')));
  }
  return [...new Set(values)];
}

export class DesktopPluginCommandHost {
  readonly #document: Document;
  readonly #window: Window;
  readonly #container: HTMLElement;
  readonly #onFailure: DesktopPluginFailureHandler;
  readonly #commands = new Map<string, RegisteredCommand>();
  readonly #keybindings = new Map<string, string>();
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) { return; }
    const commandId = eventKeybindings(event)
      .map((keybinding) => this.#keybindings.get(keybinding))
      .find((candidate) => undefined !== candidate);
    if (!commandId) { return; }
    event.preventDefault();
    event.stopPropagation();
    void this.execute(commandId).catch(() => {});
  };
  #disposed = false;

  public constructor(options: {
    readonly document: Document;
    readonly window: Window;
    readonly container: HTMLElement;
    readonly onFailure: DesktopPluginFailureHandler;
  }) {
    this.#document = options.document;
    this.#window = options.window;
    this.#container = options.container;
    this.#onFailure = options.onFailure;
    this.#window.addEventListener('keydown', this.#onKeyDown, true);
  }

  public createService(manifest: PluginManifestV1): PluginCommandService {
    const contributions = new Map(
      (manifest.contributes?.commands ?? []).map((command) => [command.id, command]),
    );
    return {
      register: (commandId, handler) => {
        if (this.#disposed) { throw new Error('Plugin command host is disposed'); }
        const contribution = contributions.get(commandId);
        if (!contribution) {
          throw new Error(`Command is not declared by ${manifest.id}: ${commandId}`);
        }
        if (this.#commands.has(commandId)) {
          throw new Error(`Plugin command is already registered: ${commandId}`);
        }
        const keybindings = (contribution.defaultKeybindings ?? []).map(canonicalKeybinding);
        for (const keybinding of keybindings) {
          if (this.#keybindings.has(keybinding)) {
            throw new Error(`Plugin keybinding is already registered: ${keybinding}`);
          }
        }
        const button = this.#document.createElement('button');
        button.type = 'button';
        button.className = 'v2-plugin-command';
        button.dataset.commandId = commandId;
        button.textContent = contribution.title;
        button.addEventListener('click', () => {
          void this.execute(commandId).catch(() => {});
        });
        const record: RegisteredCommand = {
          pluginId: manifest.id,
          handler,
          button,
          keybindings: [...keybindings],
        };
        this.#commands.set(commandId, record);
        for (const keybinding of keybindings) { this.#keybindings.set(keybinding, commandId); }
        this.#container.append(button);
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) { return; }
            disposed = true;
            this.#remove(commandId, record);
          },
        };
      },
      execute: (commandId, args = []) => this.execute(commandId, args),
    };
  }

  public async execute(
    commandId: string,
    args: readonly JsonValue[] = [],
  ): Promise<JsonValue | undefined> {
    const record = this.#commands.get(commandId);
    if (!record || this.#disposed) { throw new Error(`Plugin command is unavailable: ${commandId}`); }
    try {
      return await record.handler(args);
    } catch (error) {
      this.#onFailure(record.pluginId, 'provider', error);
      throw error;
    }
  }

  public releasePlugin(pluginId: string): void {
    for (const [commandId, record] of [...this.#commands]) {
      if (record.pluginId === pluginId) { this.#remove(commandId, record); }
    }
  }

  public commandCount(pluginId?: string): number {
    return [...this.#commands.values()]
      .filter((command) => undefined === pluginId || command.pluginId === pluginId).length;
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#window.removeEventListener('keydown', this.#onKeyDown, true);
    for (const [commandId, record] of [...this.#commands]) { this.#remove(commandId, record); }
  }

  #remove(commandId: string, expected: RegisteredCommand): void {
    if (this.#commands.get(commandId) !== expected) { return; }
    this.#commands.delete(commandId);
    for (const keybinding of expected.keybindings) {
      if (this.#keybindings.get(keybinding) === commandId) { this.#keybindings.delete(keybinding); }
    }
    expected.button.remove();
  }
}
