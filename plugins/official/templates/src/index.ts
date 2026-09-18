import {
  definePlugin,
  definePluginManifest,
} from '@mdular/plugin-sdk';
import type {
  Disposable,
  PluginCollectionItem,
  PluginContext,
  PluginFormField,
  PluginManifestV1,
  PluginStorageService,
  PluginViewAction,
  PluginViewButton,
  PluginViewService,
  PluginWorkspaceService,
  TextWriteCommitResult,
  TextWriteConflictPolicy,
  TextWriteOperation,
  TextWritePlan,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import {
  BUILTIN_DOCUMENT_TEMPLATES,
  renderDocumentOperation,
  renderTemplateBody,
  TEMPLATE_LIMITS,
  templateVariables,
} from './engine.js';
import {
  DEFAULT_SCAFFOLD_PACKAGE_JSON,
  parseScaffoldPackage,
  renderScaffoldOperations,
} from './scaffold.js';

const VIEW_ID = 'templates';
const NEW_COMMAND = 'mdular.templates.new-document';
const SCAFFOLD_COMMAND = 'mdular.templates.scaffold';
const MANAGE_COMMAND = 'mdular.templates.manage';
const CUSTOM_STORAGE_KEY = 'custom-templates';
const SCAFFOLD_STORAGE_KEY = 'scaffold-package';
const RESUME_STORAGE_KEY = 'partial-batch';

type ViewMode = 'new' | 'scaffold' | 'manage' | 'preview' | 'result';

interface CustomTemplate {
  readonly id: string;
  readonly name: string;
  readonly body: string;
}

interface PendingPlan {
  readonly plan: TextWritePlan;
  readonly operations: readonly TextWriteOperation[];
  readonly label: string;
  readonly returnMode: 'new' | 'scaffold';
  readonly openPath?: string;
}

interface LastResult {
  readonly result: TextWriteCommitResult;
  readonly operations: readonly TextWriteOperation[];
  readonly label: string;
}

interface ResumeBatch {
  readonly operations: readonly TextWriteOperation[];
  readonly label: string;
  readonly created: readonly string[];
}

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function payloadString(action: PluginViewAction, key: string): string | null {
  return isRecord(action.payload) && 'string' === typeof action.payload[key]
    ? action.payload[key] as string
    : null;
}

function messageFrom(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function decodeCustomTemplates(value: unknown): {
  readonly nextId: number;
  readonly templates: readonly CustomTemplate[];
} | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.nextId) || Number(value.nextId) < 1 ||
      !Array.isArray(value.templates) || TEMPLATE_LIMITS.maxCustomTemplates < value.templates.length) {
    return null;
  }
  let totalCharacters = 0;
  const seen = new Set<string>();
  const templates: CustomTemplate[] = [];
  for (const entry of value.templates) {
    if (
      !isRecord(entry) ||
      'string' !== typeof entry.id ||
      !/^custom-[1-9][0-9]*$/u.test(entry.id) ||
      seen.has(entry.id) ||
      'string' !== typeof entry.name ||
      '' === entry.name.trim() ||
      TEMPLATE_LIMITS.maxTemplateNameCharacters < entry.name.length ||
      'string' !== typeof entry.body ||
      TEMPLATE_LIMITS.maxTemplateCharacters < entry.body.length
    ) { return null; }
    seen.add(entry.id);
    totalCharacters += entry.name.length + entry.body.length;
    templates.push({ id: entry.id, name: entry.name.trim(), body: entry.body });
  }
  if (TEMPLATE_LIMITS.maxCustomTemplateCharacters < totalCharacters) { return null; }
  return { nextId: Number(value.nextId), templates };
}

function decodeResumeBatch(value: unknown): ResumeBatch | null {
  if (
    !isRecord(value) ||
    'string' !== typeof value.label ||
    !Array.isArray(value.operations) ||
    0 === value.operations.length ||
    128 < value.operations.length ||
    !Array.isArray(value.created) ||
    value.created.some((path) => 'string' !== typeof path)
  ) { return null; }
  const operations: TextWriteOperation[] = [];
  let encodedCharacters = 0;
  for (const operation of value.operations) {
    if (!isRecord(operation) || 'string' !== typeof operation.path ||
        'string' !== typeof operation.content) { return null; }
    try {
      templateVariables(operation.path, '', '2000-01-01');
    } catch {
      return null;
    }
    encodedCharacters += operation.path.length + operation.content.length;
    operations.push({ path: operation.path, content: operation.content });
  }
  if (56 * 1024 < encodedCharacters) { return null; }
  return {
    operations,
    label: value.label.slice(0, 160),
    created: value.created as string[],
  };
}

class TemplatesController implements Disposable {
  readonly #context: PluginContext;
  readonly #storage: PluginStorageService;
  readonly #views: PluginViewService;
  readonly #workspace: Required<Pick<
    PluginWorkspaceService,
    'planTextWrites' | 'commitTextWritePlan' | 'rollbackTextWrites'
  >>;
  #customTemplates: CustomTemplate[] = [];
  #nextCustomId = 1;
  #scaffoldPackageJson = DEFAULT_SCAFFOLD_PACKAGE_JSON;
  #mode: ViewMode = 'new';
  #status = 'Choose a template and preview its write plan.';
  #busy = false;
  #newPath = 'New file.md';
  #newTitle = '';
  #selectedTemplateId = 'builtin:plain';
  #conflictPolicy: TextWriteConflictPolicy = 'fail-if-existing';
  #scaffoldPrefix = '';
  #scaffoldPreset: 'standard' | 'docs-only' = 'standard';
  #manageName = '';
  #manageBody = '';
  #editingCustomId: string | null = null;
  #pending: PendingPlan | null = null;
  #lastResult: LastResult | null = null;
  #resumeBatch: ResumeBatch | null = null;
  #resumePersisted = true;
  #disposed = false;

  public constructor(context: PluginContext, services: {
    readonly storage: PluginStorageService;
    readonly views: PluginViewService;
    readonly workspace: Required<Pick<
      PluginWorkspaceService,
      'planTextWrites' | 'commitTextWritePlan' | 'rollbackTextWrites'
    >>;
  }) {
    this.#context = context;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }

  public async start(): Promise<void> {
    await Promise.all([
      this.#loadCustomTemplates(),
      this.#loadScaffoldPackage(),
      this.#loadResumeBatch(),
    ]);
    if (this.#disposed) { return; }
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) =>
      this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands!.register(NEW_COMMAND, async () => {
      await this.#show('new', 'Choose a template and preview its write plan.');
      return undefined;
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(SCAFFOLD_COMMAND, async () => {
      await this.#show('scaffold', 'Edit the package if needed, then preview every write.');
      return undefined;
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(MANAGE_COMMAND, async () => {
      await this.#show('manage', 'Custom templates stay in this workspace plugin namespace.');
      return undefined;
    }));
    this.#render();
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#pending = null;
    this.#lastResult = null;
    this.#views.hide(VIEW_ID);
  }

  async #show(mode: ViewMode, status: string): Promise<void> {
    this.#mode = mode;
    this.#status = status;
    this.#pending = null;
    this.#render();
    await this.#views.reveal(VIEW_ID);
  }

  async #handleAction(action: PluginViewAction): Promise<void> {
    if ('field' === action.type) {
      const id = payloadString(action, 'id');
      const value = payloadString(action, 'value');
      if (null === id || null === value) { throw new Error('Template field action is malformed'); }
      this.#setField(id, value);
      return;
    }
    if ('activate' === action.type) {
      const id = payloadString(action, 'id');
      if (!id) { throw new Error('Template activation action is malformed'); }
      if (id.startsWith('template:')) {
        this.#selectCustomForEditing(id.slice('template:'.length));
        this.#render();
      } else if (id.startsWith('created:')) {
        const path = id.slice('created:'.length);
        if (path.toLocaleLowerCase('en-US').endsWith('.md')) {
          await this.#context.navigation!.openMarkdown(path);
        }
      }
      return;
    }
    if ('command' !== action.type) { return; }
    const id = payloadString(action, 'id');
    if (!id) { throw new Error('Template command action is malformed'); }
    await this.#runViewCommand(id);
  }

  #setField(id: string, value: string): void {
    switch (id) {
      case 'new-path': this.#newPath = value; break;
      case 'new-title': this.#newTitle = value; break;
      case 'template-id': this.#selectedTemplateId = value; break;
      case 'conflict-policy':
        if ('fail-if-existing' === value || 'skip-existing' === value) {
          this.#conflictPolicy = value;
        }
        break;
      case 'scaffold-prefix': this.#scaffoldPrefix = value; break;
      case 'scaffold-preset':
        if ('standard' === value || 'docs-only' === value) { this.#scaffoldPreset = value; }
        break;
      case 'scaffold-package': this.#scaffoldPackageJson = value; break;
      case 'custom-name': this.#manageName = value; break;
      case 'custom-body': this.#manageBody = value; break;
      default: throw new Error(`Unknown Template field: ${id}`);
    }
  }

  async #runViewCommand(id: string): Promise<void> {
    if (this.#busy) { return; }
    this.#busy = true;
    this.#render();
    try {
      switch (id) {
        case 'preview-document': await this.#previewDocument(); break;
        case 'preview-scaffold': await this.#previewScaffold(); break;
        case 'commit-plan': await this.#commitPlan(); break;
        case 'cancel-preview': this.#cancelPreview(); break;
        case 'show-new': this.#mode = 'new'; this.#status = 'Choose a template and preview its write plan.'; break;
        case 'show-scaffold': this.#mode = 'scaffold'; this.#status = 'Edit the package if needed, then preview every write.'; break;
        case 'show-manage': this.#mode = 'manage'; this.#status = 'Create or edit a custom Markdown template.'; break;
        case 'save-custom': await this.#saveCustomTemplate(); break;
        case 'delete-custom': await this.#deleteCustomTemplate(); break;
        case 'new-custom': this.#clearCustomEditor(); break;
        case 'save-scaffold-package': await this.#saveScaffoldPackage(); break;
        case 'reset-scaffold-package': await this.#resetScaffoldPackage(); break;
        case 'continue-batch': await this.#previewContinuation(); break;
        case 'rollback-batch': await this.#rollbackLastBatch(); break;
        default: throw new Error(`Unknown Template view command: ${id}`);
      }
    } catch (error) {
      this.#status = messageFrom(error);
      this.#context.logger?.warn('Templates action failed', {
        action: id,
        message: this.#status,
      });
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  async #previewDocument(): Promise<void> {
    const template = this.#templateDefinitions().find((entry) => entry.id === this.#selectedTemplateId);
    if (!template) { throw new Error('Selected template no longer exists'); }
    const operation = renderDocumentOperation({
      path: this.#newPath,
      title: this.#newTitle,
      date: today(),
      body: template.body,
    });
    await this.#createPreview([operation], this.#conflictPolicy, 'document template', 'new', operation.path);
  }

  async #previewScaffold(): Promise<void> {
    const packageDefinition = parseScaffoldPackage(this.#scaffoldPackageJson);
    const operations = renderScaffoldOperations({
      packageDefinition,
      prefix: this.#scaffoldPrefix,
      preset: this.#scaffoldPreset,
      date: today(),
    });
    await this.#createPreview(
      operations,
      this.#conflictPolicy,
      `${packageDefinition.name} (${this.#scaffoldPreset})`,
      'scaffold',
    );
  }

  async #createPreview(
    operations: readonly TextWriteOperation[],
    policy: TextWriteConflictPolicy,
    label: string,
    returnMode: 'new' | 'scaffold',
    openPath?: string,
  ): Promise<void> {
    const plan = await this.#workspace.planTextWrites(operations, policy);
    this.#pending = { plan, operations, label, returnMode, ...(openPath ? { openPath } : {}) };
    this.#mode = 'preview';
    const creates = plan.entries.filter((entry) => 'create' === entry.disposition).length;
    const skips = plan.entries.filter((entry) => 'skip' === entry.disposition).length;
    const conflicts = plan.entries.filter((entry) => 'conflict' === entry.disposition).length;
    this.#status = `${creates} create · ${skips} skip · ${conflicts} conflict`;
  }

  async #commitPlan(): Promise<void> {
    const pending = this.#pending;
    if (!pending) { throw new Error('No Template write plan is ready'); }
    if (pending.plan.entries.some((entry) => 'conflict' === entry.disposition)) {
      throw new Error('Resolve conflicts by choosing skip-existing and previewing again');
    }
    const result = await this.#workspace.commitTextWritePlan(pending.plan.planId);
    this.#lastResult = { result, operations: pending.operations, label: pending.label };
    this.#pending = null;
    this.#mode = 'result';
    if ('partial' === result.status) {
      await this.#persistResumeBatch({
        operations: this.#lastResult.operations,
        label: this.#lastResult.label,
        created: result.created,
      });
      this.#status = `Partial: ${result.created.length} created; failed at ${result.failed.path}.` +
        (this.#resumePersisted ? ' Continuation saved.' : ' Continuation is session-only.');
      return;
    }
    await this.#clearResumeBatch();
    this.#status = `Complete: ${result.created.length} created · ${result.skipped.length} skipped.`;
    if (pending.openPath && result.created.includes(pending.openPath) &&
        pending.openPath.toLocaleLowerCase('en-US').endsWith('.md')) {
      await this.#context.navigation!.openMarkdown(pending.openPath);
    }
  }

  #cancelPreview(): void {
    const returnMode = this.#pending?.returnMode ?? 'new';
    this.#pending = null;
    this.#mode = returnMode;
    this.#status = 'Write plan cancelled; no files were created.';
  }

  async #previewContinuation(): Promise<void> {
    const resume = this.#resumeBatch ?? (this.#lastResult && 'partial' === this.#lastResult.result.status
      ? {
          operations: this.#lastResult.operations,
          label: this.#lastResult.label,
          created: this.#lastResult.result.created,
        }
      : null);
    if (!resume) { throw new Error('No interrupted Template batch is available'); }
    await this.#createPreview(
      resume.operations,
      'skip-existing',
      `${resume.label} continuation`,
      'scaffold',
    );
  }

  async #rollbackLastBatch(): Promise<void> {
    const result = this.#lastResult?.result;
    if (!result?.rollbackId) { throw new Error('Safe rollback is unavailable after restart'); }
    const rollback = await this.#workspace.rollbackTextWrites(result.rollbackId);
    await this.#clearResumeBatch();
    this.#status = `${rollback.removed.length} unchanged creation(s) removed` +
      (0 < rollback.retained.length ? ` · ${rollback.retained.length} changed file(s) retained` : '');
    this.#lastResult = null;
    this.#mode = 'new';
  }

  #templateDefinitions(): ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly body: string;
  }> {
    return [
      ...BUILTIN_DOCUMENT_TEMPLATES,
      ...this.#customTemplates.map((template) => ({
        id: `custom:${template.id}`,
        name: template.name,
        body: template.body,
      })),
    ];
  }

  #selectCustomForEditing(id: string): void {
    const template = this.#customTemplates.find((entry) => entry.id === id);
    if (!template) { throw new Error('Custom template no longer exists'); }
    this.#editingCustomId = template.id;
    this.#manageName = template.name;
    this.#manageBody = template.body;
    this.#status = `Editing ${template.name}`;
  }

  #clearCustomEditor(): void {
    this.#editingCustomId = null;
    this.#manageName = '';
    this.#manageBody = '';
    this.#status = 'New custom template.';
  }

  async #saveCustomTemplate(): Promise<void> {
    const name = this.#manageName.trim();
    if ('' === name || TEMPLATE_LIMITS.maxTemplateNameCharacters < name.length) {
      throw new Error('Custom template name is empty or too long');
    }
    renderTemplateBody(this.#manageBody, {
      title: 'Title', date: '2000-01-01', path: 'example.md', filename: 'example.md',
    });
    const previousTemplates = this.#customTemplates;
    const previousNextId = this.#nextCustomId;
    if (this.#editingCustomId) {
      this.#customTemplates = this.#customTemplates.map((template) =>
        template.id === this.#editingCustomId
          ? { ...template, name, body: this.#manageBody }
          : template);
    } else {
      if (TEMPLATE_LIMITS.maxCustomTemplates <= this.#customTemplates.length) {
        throw new Error('Custom template count limit reached');
      }
      const id = `custom-${this.#nextCustomId}`;
      this.#nextCustomId += 1;
      this.#customTemplates = [...this.#customTemplates, { id, name, body: this.#manageBody }];
      this.#editingCustomId = id;
    }
    const total = this.#customTemplates.reduce(
      (sum, template) => sum + template.name.length + template.body.length,
      0,
    );
    if (TEMPLATE_LIMITS.maxCustomTemplateCharacters < total) {
      this.#customTemplates = previousTemplates;
      this.#nextCustomId = previousNextId;
      throw new Error('Custom templates exceed their combined storage budget');
    }
    try {
      await this.#persistCustomTemplates();
    } catch (error) {
      this.#customTemplates = previousTemplates;
      this.#nextCustomId = previousNextId;
      throw error;
    }
    this.#status = `Saved custom template: ${name}`;
  }

  async #deleteCustomTemplate(): Promise<void> {
    if (!this.#editingCustomId) { throw new Error('Select a custom template to delete'); }
    const previous = this.#customTemplates;
    const deleted = previous.find((template) => template.id === this.#editingCustomId);
    this.#customTemplates = previous.filter((template) => template.id !== this.#editingCustomId);
    try {
      await this.#persistCustomTemplates();
    } catch (error) {
      this.#customTemplates = previous;
      throw error;
    }
    this.#clearCustomEditor();
    this.#status = `Deleted custom template: ${deleted?.name ?? ''}`;
    if (!this.#templateDefinitions().some((template) => template.id === this.#selectedTemplateId)) {
      this.#selectedTemplateId = 'builtin:plain';
    }
  }

  async #saveScaffoldPackage(): Promise<void> {
    parseScaffoldPackage(this.#scaffoldPackageJson);
    const result = await this.#storage.set(SCAFFOLD_STORAGE_KEY, {
      schemaVersion: 1,
      value: { source: this.#scaffoldPackageJson },
    });
    if (!result.ok) { throw new Error(`Unable to save scaffold package: ${result.error.message}`); }
    this.#status = 'Scaffold package saved for this workspace.';
  }

  async #resetScaffoldPackage(): Promise<void> {
    const previous = this.#scaffoldPackageJson;
    this.#scaffoldPackageJson = DEFAULT_SCAFFOLD_PACKAGE_JSON;
    try {
      await this.#saveScaffoldPackage();
    } catch (error) {
      this.#scaffoldPackageJson = previous;
      throw error;
    }
    this.#status = 'Scaffold package reset to the plugin default.';
  }

  async #loadCustomTemplates(): Promise<void> {
    const result = await this.#storage.get(CUSTOM_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn('Custom templates could not be read', {
        kind: result.error.kind,
        message: result.error.message,
      });
      return;
    }
    if (!result.value) { return; }
    const decoded = 1 === result.value.schemaVersion
      ? decodeCustomTemplates(result.value.value)
      : null;
    if (!decoded) {
      await this.#storage.remove(CUSTOM_STORAGE_KEY);
      this.#context.logger?.warn('Invalid custom template storage was removed');
      return;
    }
    this.#customTemplates = [...decoded.templates];
    this.#nextCustomId = decoded.nextId;
  }

  async #persistCustomTemplates(): Promise<void> {
    const result = await this.#storage.set(CUSTOM_STORAGE_KEY, {
      schemaVersion: 1,
      value: {
        nextId: this.#nextCustomId,
        templates: this.#customTemplates.map((template) => ({ ...template })),
      },
    });
    if (!result.ok) { throw new Error(`Unable to save custom templates: ${result.error.message}`); }
  }

  async #loadScaffoldPackage(): Promise<void> {
    const result = await this.#storage.get(SCAFFOLD_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn('Scaffold package could not be read', {
        kind: result.error.kind,
        message: result.error.message,
      });
      return;
    }
    const value = result.value?.value;
    if (!result.value || 1 !== result.value.schemaVersion || !isRecord(value) ||
        'string' !== typeof value.source) { return; }
    try {
      parseScaffoldPackage(value.source);
      this.#scaffoldPackageJson = value.source;
    } catch {
      await this.#storage.remove(SCAFFOLD_STORAGE_KEY);
      this.#context.logger?.warn('Invalid scaffold package storage was removed');
    }
  }

  async #loadResumeBatch(): Promise<void> {
    const result = await this.#storage.get(RESUME_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn('Template continuation could not be read', {
        kind: result.error.kind,
        message: result.error.message,
      });
      return;
    }
    if (!result.value) { return; }
    const decoded = 1 === result.value.schemaVersion ? decodeResumeBatch(result.value.value) : null;
    if (!decoded) {
      await this.#storage.remove(RESUME_STORAGE_KEY);
      this.#context.logger?.warn('Invalid Template continuation was removed');
      return;
    }
    this.#resumeBatch = decoded;
    this.#status = `Recovered an interrupted batch with ${decoded.created.length} prior creation(s).`;
  }

  async #persistResumeBatch(batch: ResumeBatch): Promise<void> {
    this.#resumeBatch = batch;
    const result = await this.#storage.set(RESUME_STORAGE_KEY, {
      schemaVersion: 1,
      value: {
        label: batch.label,
        operations: batch.operations.map((operation) => ({ ...operation })),
        created: [...batch.created],
      },
    });
    this.#resumePersisted = result.ok;
    if (!result.ok) {
      this.#context.logger?.warn('Template continuation could not be persisted', {
        kind: result.error.kind,
        message: result.error.message,
      });
    }
  }

  async #clearResumeBatch(): Promise<void> {
    this.#resumeBatch = null;
    this.#resumePersisted = true;
    const result = await this.#storage.remove(RESUME_STORAGE_KEY);
    if (!result.ok) {
      this.#context.logger?.warn('Template continuation could not be cleared', {
        kind: result.error.kind,
        message: result.error.message,
      });
    }
  }

  #commonActions(): PluginViewButton[] {
    return [
      { id: 'show-new', label: 'New document' },
      { id: 'show-scaffold', label: 'Project scaffold' },
      { id: 'show-manage', label: 'Manage templates' },
      ...(this.#resumeBatch
        ? [{ id: 'continue-batch', label: 'Resume interrupted batch', tone: 'primary' as const }]
        : []),
    ];
  }

  #render(): void {
    if (this.#disposed) { return; }
    switch (this.#mode) {
      case 'new': this.#renderNew(); break;
      case 'scaffold': this.#renderScaffold(); break;
      case 'manage': this.#renderManage(); break;
      case 'preview': this.#renderPreview(); break;
      case 'result': this.#renderResult(); break;
    }
  }

  #renderNew(): void {
    const templates = this.#templateDefinitions();
    if (!templates.some((template) => template.id === this.#selectedTemplateId)) {
      this.#selectedTemplateId = 'builtin:plain';
    }
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'New from Template',
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: 'new-path', kind: 'text', label: 'Workspace-relative path', value: this.#newPath, placeholder: 'notes/example.md' },
        { id: 'new-title', kind: 'text', label: 'Title', value: this.#newTitle, placeholder: 'Defaults to filename' },
        {
          id: 'template-id', kind: 'select', label: 'Template', value: this.#selectedTemplateId,
          options: templates.map((template) => ({ value: template.id, label: template.name })),
        },
        {
          id: 'conflict-policy', kind: 'select', label: 'Existing path policy', value: this.#conflictPolicy,
          options: [
            { value: 'fail-if-existing', label: 'Stop on existing path' },
            { value: 'skip-existing', label: 'Skip existing path' },
          ],
        },
      ],
      actions: [
        { id: 'preview-document', label: 'Preview write plan', tone: 'primary', disabled: this.#busy },
        ...this.#commonActions().filter((action) => 'show-new' !== action.id),
      ],
      items: [],
    });
  }

  #renderScaffold(): void {
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Project Scaffold',
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: 'scaffold-prefix', kind: 'text', label: 'Destination prefix', value: this.#scaffoldPrefix, placeholder: 'Empty means workspace root' },
        {
          id: 'scaffold-preset', kind: 'select', label: 'Preset', value: this.#scaffoldPreset,
          options: [
            { value: 'standard', label: 'Docs + issues + changelog' },
            { value: 'docs-only', label: 'Documentation only' },
          ],
        },
        {
          id: 'conflict-policy', kind: 'select', label: 'Existing path policy', value: this.#conflictPolicy,
          options: [
            { value: 'fail-if-existing', label: 'Stop on any existing path' },
            { value: 'skip-existing', label: 'Skip existing paths' },
          ],
        },
        {
          id: 'scaffold-package', kind: 'textarea', label: 'Editable scaffold package JSON',
          value: this.#scaffoldPackageJson, rows: 16,
          description: 'The package belongs to Templates; Core contains no project scaffold constants.',
        },
      ],
      actions: [
        { id: 'preview-scaffold', label: 'Preview write plan', tone: 'primary', disabled: this.#busy },
        { id: 'save-scaffold-package', label: 'Save package', disabled: this.#busy },
        { id: 'reset-scaffold-package', label: 'Reset package', tone: 'danger', disabled: this.#busy },
        ...this.#commonActions().filter((action) => 'show-scaffold' !== action.id),
      ],
      items: [],
    });
  }

  #renderManage(): void {
    const items: PluginCollectionItem[] = this.#customTemplates.map((template) => ({
      id: `template:${template.id}`,
      title: template.name,
      description: `${template.body.length} characters · ${template.id}`,
      ...(template.id === this.#editingCustomId ? { badges: ['editing'] } : {}),
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Manage Templates',
      status: this.#status,
      busy: this.#busy,
      fields: [
        { id: 'custom-name', kind: 'text', label: 'Template name', value: this.#manageName },
        {
          id: 'custom-body', kind: 'textarea', label: 'Markdown body', value: this.#manageBody, rows: 12,
          description: 'Variables: ${title}, ${date}, ${path}, ${filename}',
        },
      ],
      actions: [
        { id: 'save-custom', label: this.#editingCustomId ? 'Save changes' : 'Add template', tone: 'primary', disabled: this.#busy },
        { id: 'new-custom', label: 'Clear editor', disabled: this.#busy },
        { id: 'delete-custom', label: 'Delete selected', tone: 'danger', disabled: this.#busy || !this.#editingCustomId },
        ...this.#commonActions().filter((action) => 'show-manage' !== action.id),
      ],
      emptyMessage: 'No custom templates yet.',
      items,
    });
  }

  #renderPreview(): void {
    const pending = this.#pending;
    if (!pending) {
      this.#mode = 'new';
      this.#status = 'Write plan expired; preview again.';
      this.#renderNew();
      return;
    }
    const conflicts = pending.plan.entries.some((entry) => 'conflict' === entry.disposition);
    const fields: PluginFormField[] = 1 === pending.operations.length
      ? [{
          id: 'preview-content', kind: 'textarea', label: 'Rendered content preview',
          value: pending.operations[0]?.content ?? '', rows: 12, readOnly: true,
        }]
      : [];
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: `Write Plan · ${pending.label}`,
      status: this.#status,
      busy: this.#busy,
      fields,
      actions: [
        { id: 'commit-plan', label: 'Commit planned writes', tone: 'primary', disabled: this.#busy || conflicts },
        { id: 'cancel-preview', label: 'Back without writing', disabled: this.#busy },
      ],
      items: pending.plan.entries.map((entry) => ({
        id: `plan:${entry.path}`,
        title: entry.path,
        description: `${entry.bytes} bytes`,
        badges: [entry.disposition],
      })),
    });
  }

  #renderResult(): void {
    const last = this.#lastResult;
    const items: PluginCollectionItem[] = [];
    if (last) {
      items.push(...last.result.created.map((path) => ({
        id: `created:${path}`,
        title: path,
        badges: ['created'],
      })));
      items.push(...last.result.skipped.map((path) => ({
        id: `skipped:${path}`,
        title: path,
        badges: ['skipped'],
      })));
      if ('partial' === last.result.status) {
        items.push({
          id: `failed:${last.result.failed.path}`,
          title: last.result.failed.path,
          description: last.result.failed.message,
          badges: ['failed', last.result.failed.kind],
        });
      }
    }
    const actions: PluginViewButton[] = [
      ...(last?.result.rollbackId
        ? [{ id: 'rollback-batch', label: 'Roll back unchanged creations', tone: 'danger' as const, disabled: this.#busy }]
        : []),
      ...((last && 'partial' === last.result.status) || this.#resumeBatch
        ? [{ id: 'continue-batch', label: 'Preview safe continuation', tone: 'primary' as const, disabled: this.#busy }]
        : []),
      ...this.#commonActions().filter((action) => 'continue-batch' !== action.id),
    ];
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Template Batch Result',
      status: this.#status,
      busy: this.#busy,
      actions,
      emptyMessage: 'No files were created.',
      items,
    });
  }
}

const plugin = definePlugin({
  async activate(context) {
    if (!context.commands) { throw new Error('Templates requires commands'); }
    if (!context.navigation) { throw new Error('Templates requires navigation.openMarkdown'); }
    if (!context.storage) { throw new Error('Templates requires storage.workspace'); }
    if (!context.views) { throw new Error('Templates requires ui.views'); }
    if (
      !context.workspace?.planTextWrites ||
      !context.workspace.commitTextWritePlan ||
      !context.workspace.rollbackTextWrites
    ) { throw new Error('Templates requires workspace.writeTextBatch'); }
    const controller = new TemplatesController(context, {
      storage: context.storage,
      views: context.views,
      workspace: {
        planTextWrites: context.workspace.planTextWrites,
        commitTextWritePlan: context.workspace.commitTextWritePlan,
        rollbackTextWrites: context.workspace.rollbackTextWrites,
      },
    });
    await controller.start();
    return controller;
  },
});

export default plugin;
export {
  BUILTIN_DOCUMENT_TEMPLATES,
  renderDocumentOperation,
  renderTemplateBody,
  TEMPLATE_LIMITS,
  templateVariables,
} from './engine.js';
export {
  DEFAULT_SCAFFOLD_PACKAGE,
  DEFAULT_SCAFFOLD_PACKAGE_JSON,
  parseScaffoldPackage,
  renderScaffoldOperations,
} from './scaffold.js';
