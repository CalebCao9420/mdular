import { workspacePath } from '@mdular/core';
import type {
  OpenMarkdownOptions,
  PluginNavigationService,
} from '@mdular/plugin-sdk';

export type DesktopOpenMarkdown = (
  path: string,
  options: OpenMarkdownOptions,
) => Promise<void>;

export class DesktopPluginNavigationHost {
  readonly #openMarkdown: DesktopOpenMarkdown;

  public constructor(openMarkdown: DesktopOpenMarkdown) {
    this.#openMarkdown = openMarkdown;
  }

  public createService(): PluginNavigationService {
    return {
      openMarkdown: async (value, options = {}) => {
        const path = workspacePath(value);
        if (!path.toLocaleLowerCase('en-US').endsWith('.md')) {
          throw new Error('Plugin navigation is limited to Markdown files');
        }
        if (
          undefined !== options.placement &&
          'active-pane' !== options.placement &&
          'secondary-pane' !== options.placement
        ) { throw new Error('Plugin navigation placement is invalid'); }
        if (undefined !== options.focus && 'boolean' !== typeof options.focus) {
          throw new Error('Plugin navigation focus option is invalid');
        }
        await this.#openMarkdown(path, {
          placement: options.placement ?? 'active-pane',
          focus: options.focus ?? true,
        });
      },
    };
  }
}
