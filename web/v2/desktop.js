// Generated from src/ — edit TypeScript and run: npm run build


// packages/platform/src/index.ts
var WorkspacePathError = class extends Error {
  constructor(code, value) {
    super(`Invalid workspace path (${code}): ${JSON.stringify(value)}`);
    this.name = "WorkspacePathError";
    this.code = code;
    this.value = value;
  }
};
function workspacePath(value) {
  if ("" === value) {
    throw new WorkspacePathError("empty", value);
  }
  if (value.includes("\0")) {
    throw new WorkspacePathError("null-byte", value);
  }
  if (value.includes("\\")) {
    throw new WorkspacePathError("backslash", value);
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
    throw new WorkspacePathError("absolute", value);
  }
  const segments = value.split("/");
  if (segments.some((segment) => "" === segment)) {
    throw new WorkspacePathError("empty-segment", value);
  }
  if (segments.some((segment) => "." === segment || ".." === segment)) {
    throw new WorkspacePathError("traversal", value);
  }
  return value;
}
function nonEmptyHostToken(value, label) {
  if ("" === value) {
    throw new Error(`${label} must not be empty`);
  }
  return value;
}
function workspacePathKeyFromHost(value) {
  return nonEmptyHostToken(value, "Workspace path key");
}
function opaqueRevisionFromHost(value) {
  return nonEmptyHostToken(value, "Revision");
}
function byteHashFromHost(value) {
  return nonEmptyHostToken(value, "Byte hash");
}

// apps/desktop/src/recovery-store.ts
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function safeInteger(value, label) {
  if ("number" !== typeof value || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}
function requiredString(value, label) {
  if ("string" !== typeof value) {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
function decodeRecoveryRecord(value) {
  if (!isRecord(value)) {
    throw new Error("Recovery record must be an object");
  }
  if (1 !== value.schemaVersion) {
    throw new Error("Recovery record schema is unsupported");
  }
  if ("string" !== typeof value.buffer) {
    throw new Error("Recovery buffer must be a string");
  }
  return {
    schemaVersion: 1,
    path: workspacePath(requiredString(value.path, "Recovery path")),
    pathKey: workspacePathKeyFromHost(requiredString(value.pathKey, "Recovery path key")),
    savedRevision: opaqueRevisionFromHost(
      requiredString(value.savedRevision, "Recovery saved revision")
    ),
    buffer: value.buffer,
    bufferVersion: safeInteger(value.bufferVersion, "Recovery bufferVersion"),
    capturedAt: safeInteger(value.capturedAt, "Recovery capturedAt")
  };
}
function decodeLoadedRecovery(value) {
  if (!isRecord(value)) {
    throw new Error("Loaded recovery entry must be an object");
  }
  if ("current" !== value.generation && "previous" !== value.generation) {
    throw new Error("Loaded recovery generation is invalid");
  }
  if (void 0 !== value.diagnostic && "string" !== typeof value.diagnostic) {
    throw new Error("Loaded recovery diagnostic must be a string");
  }
  return {
    record: decodeRecoveryRecord(value.record),
    generation: value.generation,
    ...void 0 === value.diagnostic ? {} : { diagnostic: value.diagnostic }
  };
}
var TauriRecoveryStore = class {
  #bridge;
  constructor(bridge) {
    this.#bridge = bridge;
  }
  async write(record) {
    await this.#bridge.invoke("recovery_write_record", { record });
  }
  async remove(pathKey) {
    await this.#bridge.invoke("recovery_remove_record", {
      request: { pathKey }
    });
  }
  async list() {
    const result = await this.#bridge.invoke("recovery_list_records", {});
    if (!Array.isArray(result)) {
      throw new Error("Recovery list result must be an array");
    }
    return result.map(decodeLoadedRecovery);
  }
};

// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once2 = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once2);
}
var Channel = class {
  constructor(onmessage) {
    _Channel_onmessage.set(this, void 0);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, void 0);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
    }), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
var Resource = class {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, void 0);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  /**
   * Destroys and cleans up this resource from memory.
   * **You should not call any method on this object anymore and should drop any reference to it.**
   */
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
};
_Resource_rid = /* @__PURE__ */ new WeakMap();

// node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent2) {
  TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent2["WINDOW_MOVED"] = "tauri://move";
  TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent2["WINDOW_SUSPENDED"] = "tauri://suspended";
  TauriEvent2["WINDOW_RESUMED"] = "tauri://resumed";
  TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}
async function once(event, handler, options) {
  return listen(event, (eventData) => {
    void _unlisten(event, eventData.id);
    handler(eventData);
  }, options);
}
async function emit(event, payload) {
  await invoke("plugin:event|emit", {
    event,
    payload
  });
}
async function emitTo(target, event, payload) {
  const eventTarget = typeof target === "string" ? { kind: "AnyLabel", label: target } : target;
  await invoke("plugin:event|emit_to", {
    target: eventTarget,
    event,
    payload
  });
}

// apps/desktop/src/tauri-bridge.ts
var defaultTransport = {
  invoke,
  listen
};
function createTauriDesktopBridge(transport = defaultTransport) {
  return {
    invoke(command, args) {
      return transport.invoke(command, args);
    },
    listen(event, listener) {
      return transport.listen(event, (message) => listener(message.payload));
    }
  };
}
var tauriDesktopBridge = createTauriDesktopBridge();

// node_modules/@tauri-apps/api/dpi.js
var LogicalSize = class {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.width = args[0].Logical.width;
        this.height = args[0].Logical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  /**
   * Converts the logical size to a physical one.
   * @example
   * ```typescript
   * import { LogicalSize } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const size = new LogicalSize(400, 500);
   * const physical = size.toPhysical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toPhysical(scaleFactor) {
    return new PhysicalSize(this.width * scaleFactor, this.height * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var PhysicalSize = class {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.width = args[0].Physical.width;
        this.height = args[0].Physical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  /**
   * Converts the physical size to a logical one.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const size = await appWindow.innerSize(); // PhysicalSize
   * const logical = size.toLogical(factor);
   * ```
   */
  toLogical(scaleFactor) {
    return new LogicalSize(this.width / scaleFactor, this.height / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var Size = class {
  constructor(size) {
    this.size = size;
  }
  toLogical(scaleFactor) {
    return this.size instanceof LogicalSize ? this.size : this.size.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.size instanceof PhysicalSize ? this.size : this.size.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.size.type}`]: {
        width: this.size.width,
        height: this.size.height
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var LogicalPosition = class {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.x = args[0].Logical.x;
        this.y = args[0].Logical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  /**
   * Converts the logical position to a physical one.
   * @example
   * ```typescript
   * import { LogicalPosition } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const position = new LogicalPosition(400, 500);
   * const physical = position.toPhysical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toPhysical(scaleFactor) {
    return new PhysicalPosition(this.x * scaleFactor, this.y * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var PhysicalPosition = class {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.x = args[0].Physical.x;
        this.y = args[0].Physical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  /**
   * Converts the physical position to a logical one.
   * @example
   * ```typescript
   * import { PhysicalPosition } from '@tauri-apps/api/dpi';
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   *
   * const appWindow = getCurrentWindow();
   * const factor = await appWindow.scaleFactor();
   * const position = new PhysicalPosition(400, 500);
   * const physical = position.toLogical(factor);
   * ```
   *
   * @since 2.0.0
   */
  toLogical(scaleFactor) {
    return new LogicalPosition(this.x / scaleFactor, this.y / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
var Position = class {
  constructor(position) {
    this.position = position;
  }
  toLogical(scaleFactor) {
    return this.position instanceof LogicalPosition ? this.position : this.position.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.position instanceof PhysicalPosition ? this.position : this.position.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.position.type}`]: {
        x: this.position.x,
        y: this.position.y
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};

// node_modules/@tauri-apps/api/image.js
var Image = class _Image extends Resource {
  /**
   * Creates an Image from a resource ID. For internal use only.
   *
   * @ignore
   */
  constructor(rid) {
    super(rid);
  }
  /** Creates a new Image using RGBA data, in row-major order from top to bottom, and with specified width and height. */
  static async new(rgba, width, height) {
    return invoke("plugin:image|new", {
      rgba: transformImage(rgba),
      width,
      height
    }).then((rid) => new _Image(rid));
  }
  /**
   * Creates a new image using the provided bytes by inferring the file format.
   * If the format is known, prefer [@link Image.fromPngBytes] or [@link Image.fromIcoBytes].
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromBytes(bytes) {
    return invoke("plugin:image|from_bytes", {
      bytes: transformImage(bytes)
    }).then((rid) => new _Image(rid));
  }
  /**
   * Creates a new image using the provided path.
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromPath(path) {
    return invoke("plugin:image|from_path", { path }).then((rid) => new _Image(rid));
  }
  /** Returns the RGBA data for this image, in row-major order from top to bottom.  */
  async rgba() {
    return invoke("plugin:image|rgba", {
      rid: this.rid
    }).then((buffer) => new Uint8Array(buffer));
  }
  /** Returns the size of this image.  */
  async size() {
    return invoke("plugin:image|size", { rid: this.rid });
  }
};
function transformImage(image) {
  const ret = image == null ? null : typeof image === "string" ? image : image instanceof Image ? image.rid : image;
  return ret;
}

// node_modules/@tauri-apps/api/window.js
var UserAttentionType;
(function(UserAttentionType2) {
  UserAttentionType2[UserAttentionType2["Critical"] = 1] = "Critical";
  UserAttentionType2[UserAttentionType2["Informational"] = 2] = "Informational";
})(UserAttentionType || (UserAttentionType = {}));
var CloseRequestedEvent = class {
  constructor(event) {
    this._preventDefault = false;
    this.event = event.event;
    this.id = event.id;
  }
  preventDefault() {
    this._preventDefault = true;
  }
  isPreventDefault() {
    return this._preventDefault;
  }
};
var ProgressBarStatus;
(function(ProgressBarStatus2) {
  ProgressBarStatus2["None"] = "none";
  ProgressBarStatus2["Normal"] = "normal";
  ProgressBarStatus2["Indeterminate"] = "indeterminate";
  ProgressBarStatus2["Paused"] = "paused";
  ProgressBarStatus2["Error"] = "error";
})(ProgressBarStatus || (ProgressBarStatus = {}));
function getCurrentWindow() {
  return new Window(window.__TAURI_INTERNALS__.metadata.currentWindow.label, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  });
}
async function getAllWindows() {
  return invoke("plugin:window|get_all_windows").then((windows) => windows.map((w) => new Window(w, {
    // @ts-expect-error `skip` is not defined in the public API but it is handled by the constructor
    skip: true
  })));
}
var localTauriEvents = ["tauri://created", "tauri://error"];
var Window = class {
  /**
   * Creates a new Window.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const appWindow = new Window('my-label');
   * appWindow.once('tauri://created', function () {
   *  // window successfully created
   * });
   * appWindow.once('tauri://error', function (e) {
   *  // an error happened creating the window
   * });
   * ```
   *
   * @param label The unique window label. Must be alphanumeric: `a-zA-Z-/:_`.
   * @returns The {@link Window} instance to communicate with the window.
   */
  constructor(label, options = {}) {
    var _a;
    this.label = label;
    this.listeners = /* @__PURE__ */ Object.create(null);
    if (!(options === null || options === void 0 ? void 0 : options.skip)) {
      invoke("plugin:window|create", {
        options: {
          ...options,
          parent: typeof options.parent === "string" ? options.parent : (_a = options.parent) === null || _a === void 0 ? void 0 : _a.label,
          label
        }
      }).then(async () => this.emit("tauri://created")).catch(async (e) => this.emit("tauri://error", e));
    }
  }
  /**
   * Gets the Window associated with the given label.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const mainWindow = Window.getByLabel('main');
   * ```
   *
   * @param label The window label.
   * @returns The Window instance to communicate with the window or null if the window doesn't exist.
   */
  static async getByLabel(label) {
    var _a;
    return (_a = (await getAllWindows()).find((w) => w.label === label)) !== null && _a !== void 0 ? _a : null;
  }
  /**
   * Get an instance of `Window` for the current window.
   */
  static getCurrent() {
    return getCurrentWindow();
  }
  /**
   * Gets a list of instances of `Window` for all available windows.
   */
  static async getAll() {
    return getAllWindows();
  }
  /**
   *  Gets the focused window.
   * @example
   * ```typescript
   * import { Window } from '@tauri-apps/api/window';
   * const focusedWindow = Window.getFocusedWindow();
   * ```
   *
   * @returns The Window instance or `undefined` if there is not any focused window.
   */
  static async getFocusedWindow() {
    for (const w of await getAllWindows()) {
      if (await w.isFocused()) {
        return w;
      }
    }
    return null;
  }
  /**
   * Listen to an emitted event on this window.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const unlisten = await getCurrentWindow().listen<string>('state-changed', (event) => {
   *   console.log(`Got error: ${payload}`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async listen(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return listen(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  /**
   * Listen to an emitted event on this window only once.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const unlisten = await getCurrentWindow().once<null>('initialized', (event) => {
   *   console.log(`Window initialized!`);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param handler Event handler.
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async once(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return once(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  /**
   * Emits an event to all {@link EventTarget|targets}.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().emit('window-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   *
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emit(event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emit(event, payload);
  }
  /**
   * Emits an event to all {@link EventTarget|targets} matching the given target.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().emit('main', 'window-loaded', { loggedIn: true, token: 'authToken' });
   * ```
   * @param target Label of the target Window/Webview/WebviewWindow or raw {@link EventTarget} object.
   * @param event Event name. Must include only alphanumeric characters, `-`, `/`, `:` and `_`.
   * @param payload Event payload.
   */
  async emitTo(target, event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emitTo(target, event, payload);
  }
  /** @ignore */
  _handleTauriEvent(event, handler) {
    if (localTauriEvents.includes(event)) {
      if (!(event in this.listeners)) {
        this.listeners[event] = [handler];
      } else {
        this.listeners[event].push(handler);
      }
      return true;
    }
    return false;
  }
  // Getters
  /**
   * The scale factor that can be used to map physical pixels to logical pixels.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const factor = await getCurrentWindow().scaleFactor();
   * ```
   *
   * @returns The window's monitor scale factor.
   */
  async scaleFactor() {
    return invoke("plugin:window|scale_factor", {
      label: this.label
    });
  }
  /**
   * The position of the top-left hand corner of the window's client area relative to the top-left hand corner of the desktop.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const position = await getCurrentWindow().innerPosition();
   * ```
   *
   * @returns The window's inner position.
   */
  async innerPosition() {
    return invoke("plugin:window|inner_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  /**
   * The position of the top-left hand corner of the window relative to the top-left hand corner of the desktop.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const position = await getCurrentWindow().outerPosition();
   * ```
   *
   * @returns The window's outer position.
   */
  async outerPosition() {
    return invoke("plugin:window|outer_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  /**
   * The physical size of the window's client area.
   * The client area is the content of the window, excluding the title bar and borders.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const size = await getCurrentWindow().innerSize();
   * ```
   *
   * @returns The window's inner size.
   */
  async innerSize() {
    return invoke("plugin:window|inner_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  /**
   * The physical size of the entire window.
   * These dimensions include the title bar and borders. If you don't want that (and you usually don't), use inner_size instead.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const size = await getCurrentWindow().outerSize();
   * ```
   *
   * @returns The window's outer size.
   */
  async outerSize() {
    return invoke("plugin:window|outer_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  /**
   * Gets the window's current fullscreen state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const fullscreen = await getCurrentWindow().isFullscreen();
   * ```
   *
   * @returns Whether the window is in fullscreen mode or not.
   */
  async isFullscreen() {
    return invoke("plugin:window|is_fullscreen", {
      label: this.label
    });
  }
  /**
   * Gets the window's current minimized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const minimized = await getCurrentWindow().isMinimized();
   * ```
   */
  async isMinimized() {
    return invoke("plugin:window|is_minimized", {
      label: this.label
    });
  }
  /**
   * Gets the window's current maximized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const maximized = await getCurrentWindow().isMaximized();
   * ```
   *
   * @returns Whether the window is maximized or not.
   */
  async isMaximized() {
    return invoke("plugin:window|is_maximized", {
      label: this.label
    });
  }
  /**
   * Gets the window's current focus state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const focused = await getCurrentWindow().isFocused();
   * ```
   *
   * @returns Whether the window is focused or not.
   */
  async isFocused() {
    return invoke("plugin:window|is_focused", {
      label: this.label
    });
  }
  /**
   * Gets the window's current decorated state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const decorated = await getCurrentWindow().isDecorated();
   * ```
   *
   * @returns Whether the window is decorated or not.
   */
  async isDecorated() {
    return invoke("plugin:window|is_decorated", {
      label: this.label
    });
  }
  /**
   * Gets the window's current resizable state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const resizable = await getCurrentWindow().isResizable();
   * ```
   *
   * @returns Whether the window is resizable or not.
   */
  async isResizable() {
    return invoke("plugin:window|is_resizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native maximize button state.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const maximizable = await getCurrentWindow().isMaximizable();
   * ```
   *
   * @returns Whether the window's native maximize button is enabled or not.
   */
  async isMaximizable() {
    return invoke("plugin:window|is_maximizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native minimize button state.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const minimizable = await getCurrentWindow().isMinimizable();
   * ```
   *
   * @returns Whether the window's native minimize button is enabled or not.
   */
  async isMinimizable() {
    return invoke("plugin:window|is_minimizable", {
      label: this.label
    });
  }
  /**
   * Gets the window's native close button state.
   *
   * #### Platform-specific
   *
   * - **iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const closable = await getCurrentWindow().isClosable();
   * ```
   *
   * @returns Whether the window's native close button is enabled or not.
   */
  async isClosable() {
    return invoke("plugin:window|is_closable", {
      label: this.label
    });
  }
  /**
   * Gets the window's current visible state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const visible = await getCurrentWindow().isVisible();
   * ```
   *
   * @returns Whether the window is visible or not.
   */
  async isVisible() {
    return invoke("plugin:window|is_visible", {
      label: this.label
    });
  }
  /**
   * Gets the window's current title.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const title = await getCurrentWindow().title();
   * ```
   */
  async title() {
    return invoke("plugin:window|title", {
      label: this.label
    });
  }
  /**
   * Gets the window's current theme.
   *
   * #### Platform-specific
   *
   * - **macOS:** Theme was introduced on macOS 10.14. Returns `light` on macOS 10.13 and below.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const theme = await getCurrentWindow().theme();
   * ```
   *
   * @returns The window theme.
   */
  async theme() {
    return invoke("plugin:window|theme", {
      label: this.label
    });
  }
  /**
   * Whether the window is configured to be always on top of other windows or not.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * const alwaysOnTop = await getCurrentWindow().isAlwaysOnTop();
   * ```
   *
   * @returns Whether the window is visible or not.
   */
  async isAlwaysOnTop() {
    return invoke("plugin:window|is_always_on_top", {
      label: this.label
    });
  }
  async activityName() {
    return invoke("plugin:window|activity_name", {
      label: this.label
    });
  }
  async sceneIdentifier() {
    return invoke("plugin:window|scene_identifier", {
      label: this.label
    });
  }
  // Setters
  /**
   * Centers the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().center();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async center() {
    return invoke("plugin:window|center", {
      label: this.label
    });
  }
  /**
   *  Requests user attention to the window, this has no effect if the application
   * is already focused. How requesting for user attention manifests is platform dependent,
   * see `UserAttentionType` for details.
   *
   * Providing `null` will unset the request for user attention. Unsetting the request for
   * user attention might not be done automatically by the WM when the window receives input.
   *
   * #### Platform-specific
   *
   * - **macOS:** `null` has no effect.
   * - **Linux:** Urgency levels have the same effect.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().requestUserAttention();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async requestUserAttention(requestType) {
    let requestType_ = null;
    if (requestType) {
      if (requestType === UserAttentionType.Critical) {
        requestType_ = { type: "Critical" };
      } else {
        requestType_ = { type: "Informational" };
      }
    }
    return invoke("plugin:window|request_user_attention", {
      label: this.label,
      value: requestType_
    });
  }
  /**
   * Updates the window resizable flag.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setResizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setResizable(resizable) {
    return invoke("plugin:window|set_resizable", {
      label: this.label,
      value: resizable
    });
  }
  /**
   * Enable or disable the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setEnabled(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.0.0
   */
  async setEnabled(enabled) {
    return invoke("plugin:window|set_enabled", {
      label: this.label,
      value: enabled
    });
  }
  /**
   * Whether the window is enabled or disabled.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setEnabled(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.0.0
   */
  async isEnabled() {
    return invoke("plugin:window|is_enabled", {
      label: this.label
    });
  }
  /**
   * Sets whether the window's native maximize button is enabled or not.
   * If resizable is set to false, this setting is ignored.
   *
   * #### Platform-specific
   *
   * - **macOS:** Disables the "zoom" button in the window titlebar, which is also used to enter fullscreen mode.
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMaximizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMaximizable(maximizable) {
    return invoke("plugin:window|set_maximizable", {
      label: this.label,
      value: maximizable
    });
  }
  /**
   * Sets whether the window's native minimize button is enabled or not.
   *
   * #### Platform-specific
   *
   * - **Linux / iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMinimizable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMinimizable(minimizable) {
    return invoke("plugin:window|set_minimizable", {
      label: this.label,
      value: minimizable
    });
  }
  /**
   * Sets whether the window's native close button is enabled or not.
   *
   * #### Platform-specific
   *
   * - **Linux:** GTK+ will do its best to convince the window manager not to show a close button. Depending on the system, this function may not have any effect when called on a window that is already visible
   * - **iOS / Android:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setClosable(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setClosable(closable) {
    return invoke("plugin:window|set_closable", {
      label: this.label,
      value: closable
    });
  }
  /**
   * Sets the window title.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setTitle('Tauri');
   * ```
   *
   * @param title The new title
   * @returns A promise indicating the success or failure of the operation.
   */
  async setTitle(title) {
    return invoke("plugin:window|set_title", {
      label: this.label,
      value: title
    });
  }
  /**
   * Maximizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().maximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async maximize() {
    return invoke("plugin:window|maximize", {
      label: this.label
    });
  }
  /**
   * Unmaximizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().unmaximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async unmaximize() {
    return invoke("plugin:window|unmaximize", {
      label: this.label
    });
  }
  /**
   * Toggles the window maximized state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().toggleMaximize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async toggleMaximize() {
    return invoke("plugin:window|toggle_maximize", {
      label: this.label
    });
  }
  /**
   * Minimizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().minimize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async minimize() {
    return invoke("plugin:window|minimize", {
      label: this.label
    });
  }
  /**
   * Unminimizes the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().unminimize();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async unminimize() {
    return invoke("plugin:window|unminimize", {
      label: this.label
    });
  }
  /**
   * Sets the window visibility to true.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().show();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async show() {
    return invoke("plugin:window|show", {
      label: this.label
    });
  }
  /**
   * Sets the window visibility to false.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().hide();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async hide() {
    return invoke("plugin:window|hide", {
      label: this.label
    });
  }
  /**
   * Closes the window.
   *
   * Note this emits a closeRequested event so you can intercept it. To force window close, use {@link Window.destroy}.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().close();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async close() {
    return invoke("plugin:window|close", {
      label: this.label
    });
  }
  /**
   * Destroys the window. Behaves like {@link Window.close} but forces the window close instead of emitting a closeRequested event.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().destroy();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async destroy() {
    return invoke("plugin:window|destroy", {
      label: this.label
    });
  }
  /**
   * Whether the window should have borders and bars.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setDecorations(false);
   * ```
   *
   * @param decorations Whether the window should have borders and bars.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setDecorations(decorations) {
    return invoke("plugin:window|set_decorations", {
      label: this.label,
      value: decorations
    });
  }
  /**
   * Whether or not the window should have shadow.
   *
   * #### Platform-specific
   *
   * - **Windows:**
   *   - `false` has no effect on decorated window, shadows are always ON.
   *   - `true` will make undecorated window have a 1px white border,
   * and on Windows 11, it will have a rounded corners.
   * - **Linux:** Unsupported.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setShadow(false);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setShadow(enable) {
    return invoke("plugin:window|set_shadow", {
      label: this.label,
      value: enable
    });
  }
  /**
   * Set window effects.
   */
  async setEffects(effects) {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: effects
    });
  }
  /**
   * Clear any applied effects if possible.
   */
  async clearEffects() {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: null
    });
  }
  /**
   * Whether the window should always be on top of other windows.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setAlwaysOnTop(true);
   * ```
   *
   * @param alwaysOnTop Whether the window should always be on top of other windows or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setAlwaysOnTop(alwaysOnTop) {
    return invoke("plugin:window|set_always_on_top", {
      label: this.label,
      value: alwaysOnTop
    });
  }
  /**
   * Whether the window should always be below other windows.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setAlwaysOnBottom(true);
   * ```
   *
   * @param alwaysOnBottom Whether the window should always be below other windows or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setAlwaysOnBottom(alwaysOnBottom) {
    return invoke("plugin:window|set_always_on_bottom", {
      label: this.label,
      value: alwaysOnBottom
    });
  }
  /**
   * Prevents the window contents from being captured by other apps.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setContentProtected(true);
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setContentProtected(protected_) {
    return invoke("plugin:window|set_content_protected", {
      label: this.label,
      value: protected_
    });
  }
  /**
   * Resizes the window with a new inner size.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSize(new LogicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSize(size) {
    return invoke("plugin:window|set_size", {
      label: this.label,
      value: size instanceof Size ? size : new Size(size)
    });
  }
  /**
   * Sets the window minimum inner size. If the `size` argument is not provided, the constraint is unset.
   * @example
   * ```typescript
   * import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMinSize(new PhysicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMinSize(size) {
    return invoke("plugin:window|set_min_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  /**
   * Sets the window maximum inner size. If the `size` argument is undefined, the constraint is unset.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
   * await getCurrentWindow().setMaxSize(new LogicalSize(600, 500));
   * ```
   *
   * @param size The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setMaxSize(size) {
    return invoke("plugin:window|set_max_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  /**
   * Sets the window inner size constraints.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSizeConstraints({ minWidth: 300 });
   * ```
   *
   * @param constraints The logical or physical inner size, or `null` to unset the constraint.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSizeConstraints(constraints) {
    function logical(pixel) {
      return pixel ? { Logical: pixel } : null;
    }
    return invoke("plugin:window|set_size_constraints", {
      label: this.label,
      value: {
        minWidth: logical(constraints === null || constraints === void 0 ? void 0 : constraints.minWidth),
        minHeight: logical(constraints === null || constraints === void 0 ? void 0 : constraints.minHeight),
        maxWidth: logical(constraints === null || constraints === void 0 ? void 0 : constraints.maxWidth),
        maxHeight: logical(constraints === null || constraints === void 0 ? void 0 : constraints.maxHeight)
      }
    });
  }
  /**
   * Sets the window outer position.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
   * await getCurrentWindow().setPosition(new LogicalPosition(600, 500));
   * ```
   *
   * @param position The new position, in logical or physical pixels.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setPosition(position) {
    return invoke("plugin:window|set_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  /**
   * Sets the window fullscreen state.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFullscreen(true);
   * ```
   *
   * @param fullscreen Whether the window should go to fullscreen or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFullscreen(fullscreen) {
    return invoke("plugin:window|set_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  /**
   * On macOS, Toggles a fullscreen mode that doesn’t require a new macOS space. Returns a boolean indicating whether the transition was successful (this won’t work if the window was already in the native fullscreen).
   * This is how fullscreen used to work on macOS in versions before Lion. And allows the user to have a fullscreen window without using another space or taking control over the entire monitor.
   *
   * On other platforms, this is the same as {@link Window.setFullscreen}.
   *
   * @param fullscreen Whether the window should go to simple fullscreen or not.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSimpleFullscreen(fullscreen) {
    return invoke("plugin:window|set_simple_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  /**
   * Bring the window to front and focus.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFocus();
   * ```
   *
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFocus() {
    return invoke("plugin:window|set_focus", {
      label: this.label
    });
  }
  /**
   * Sets whether the window can be focused.
   *
   * #### Platform-specific
   *
   * - **macOS**: If the window is already focused, it is not possible to unfocus it after calling `set_focusable(false)`.
   *   In this case, you might consider calling {@link Window.setFocus} but it will move the window to the back i.e. at the bottom in terms of z-order.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setFocusable(true);
   * ```
   *
   * @param focusable Whether the window can be focused.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setFocusable(focusable) {
    return invoke("plugin:window|set_focusable", {
      label: this.label,
      value: focusable
    });
  }
  /**
   * Sets the window icon.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setIcon('/tauri/awesome.png');
   * ```
   *
   * Note that you may need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   *
   * @param icon Icon bytes or path to the icon file.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setIcon(icon) {
    return invoke("plugin:window|set_icon", {
      label: this.label,
      value: transformImage(icon)
    });
  }
  /**
   * Whether the window icon should be hidden from the taskbar or not.
   *
   * #### Platform-specific
   *
   * - **macOS:** Unsupported.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setSkipTaskbar(true);
   * ```
   *
   * @param skip true to hide window icon, false to show it.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setSkipTaskbar(skip) {
    return invoke("plugin:window|set_skip_taskbar", {
      label: this.label,
      value: skip
    });
  }
  /**
   * Grabs the cursor, preventing it from leaving the window.
   *
   * There's no guarantee that the cursor will be hidden. You should
   * hide it by yourself if you want so.
   *
   * #### Platform-specific
   *
   * - **Linux:** Unsupported.
   * - **macOS:** This locks the cursor in a fixed location, which looks visually awkward.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorGrab(true);
   * ```
   *
   * @param grab `true` to grab the cursor icon, `false` to release it.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorGrab(grab) {
    return invoke("plugin:window|set_cursor_grab", {
      label: this.label,
      value: grab
    });
  }
  /**
   * Modifies the cursor's visibility.
   *
   * #### Platform-specific
   *
   * - **Windows:** The cursor is only hidden within the confines of the window.
   * - **macOS:** The cursor is hidden as long as the window has input focus, even if the cursor is
   *   outside of the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorVisible(false);
   * ```
   *
   * @param visible If `false`, this will hide the cursor. If `true`, this will show the cursor.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorVisible(visible) {
    return invoke("plugin:window|set_cursor_visible", {
      label: this.label,
      value: visible
    });
  }
  /**
   * Modifies the cursor icon of the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorIcon('help');
   * ```
   *
   * @param icon The new cursor icon.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorIcon(icon) {
    return invoke("plugin:window|set_cursor_icon", {
      label: this.label,
      value: icon
    });
  }
  /**
   * Sets the window background color.
   *
   * #### Platform-specific:
   *
   * - **Windows:** alpha channel is ignored.
   * - **iOS / Android:** Unsupported.
   *
   * @returns A promise indicating the success or failure of the operation.
   *
   * @since 2.1.0
   */
  async setBackgroundColor(color) {
    return invoke("plugin:window|set_background_color", { color });
  }
  /**
   * Changes the position of the cursor in window coordinates.
   * @example
   * ```typescript
   * import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
   * await getCurrentWindow().setCursorPosition(new LogicalPosition(600, 300));
   * ```
   *
   * @param position The new cursor position.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setCursorPosition(position) {
    return invoke("plugin:window|set_cursor_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  /**
   * Changes the cursor events behavior.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setIgnoreCursorEvents(true);
   * ```
   *
   * @param ignore `true` to ignore the cursor events; `false` to process them as usual.
   * @returns A promise indicating the success or failure of the operation.
   */
  async setIgnoreCursorEvents(ignore) {
    return invoke("plugin:window|set_ignore_cursor_events", {
      label: this.label,
      value: ignore
    });
  }
  /**
   * Starts dragging the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().startDragging();
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async startDragging() {
    return invoke("plugin:window|start_dragging", {
      label: this.label
    });
  }
  /**
   * Starts resize-dragging the window.
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().startResizeDragging();
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async startResizeDragging(direction) {
    return invoke("plugin:window|start_resize_dragging", {
      label: this.label,
      value: direction
    });
  }
  /**
   * Sets the badge count. It is app wide and not specific to this window.
   *
   * #### Platform-specific
   *
   * - **Windows**: Unsupported. Use @{linkcode Window.setOverlayIcon} instead.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setBadgeCount(5);
   * ```
   *
   * @param count The badge count. Use `undefined` to remove the badge.
   * @return A promise indicating the success or failure of the operation.
   */
  async setBadgeCount(count) {
    return invoke("plugin:window|set_badge_count", {
      label: this.label,
      value: count
    });
  }
  /**
   * Sets the badge cont **macOS only**.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setBadgeLabel("Hello");
   * ```
   *
   * @param label The badge label. Use `undefined` to remove the badge.
   * @return A promise indicating the success or failure of the operation.
   */
  async setBadgeLabel(label) {
    return invoke("plugin:window|set_badge_label", {
      label: this.label,
      value: label
    });
  }
  /**
   * Sets the overlay icon. **Windows only**
   * The overlay icon can be set for every window.
   *
   *
   * Note that you may need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   *
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from '@tauri-apps/api/window';
   * await getCurrentWindow().setOverlayIcon("/tauri/awesome.png");
   * ```
   *
   * @param icon Icon bytes or path to the icon file. Use `undefined` to remove the overlay icon.
   * @return A promise indicating the success or failure of the operation.
   */
  async setOverlayIcon(icon) {
    return invoke("plugin:window|set_overlay_icon", {
      label: this.label,
      value: icon ? transformImage(icon) : void 0
    });
  }
  /**
   * Sets the taskbar progress state.
   *
   * #### Platform-specific
   *
   * - **Linux / macOS**: Progress bar is app-wide and not specific to this window.
   * - **Linux**: Only supported desktop environments with `libunity` (e.g. GNOME).
   *
   * @example
   * ```typescript
   * import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window';
   * await getCurrentWindow().setProgressBar({
   *   status: ProgressBarStatus.Normal,
   *   progress: 50,
   * });
   * ```
   *
   * @return A promise indicating the success or failure of the operation.
   */
  async setProgressBar(state) {
    return invoke("plugin:window|set_progress_bar", {
      label: this.label,
      value: state
    });
  }
  /**
   * Sets whether the window should be visible on all workspaces or virtual desktops.
   *
   * #### Platform-specific
   *
   * - **Windows / iOS / Android:** Unsupported.
   *
   * @since 2.0.0
   */
  async setVisibleOnAllWorkspaces(visible) {
    return invoke("plugin:window|set_visible_on_all_workspaces", {
      label: this.label,
      value: visible
    });
  }
  /**
   * Sets the title bar style. **macOS only**.
   *
   * @since 2.0.0
   */
  async setTitleBarStyle(style) {
    return invoke("plugin:window|set_title_bar_style", {
      label: this.label,
      value: style
    });
  }
  /**
   * Set window theme, pass in `null` or `undefined` to follow system theme
   *
   * #### Platform-specific
   *
   * - **Linux / macOS**: Theme is app-wide and not specific to this window.
   * - **iOS / Android:** Unsupported.
   *
   * @since 2.0.0
   */
  async setTheme(theme) {
    return invoke("plugin:window|set_theme", {
      label: this.label,
      value: theme
    });
  }
  // Listeners
  /**
   * Listen to window resize.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onResized(({ payload: size }) => {
   *  console.log('Window resized', size);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onResized(handler) {
    return this.listen(TauriEvent.WINDOW_RESIZED, (e) => {
      e.payload = new PhysicalSize(e.payload);
      handler(e);
    });
  }
  /**
   * Listen to window move.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onMoved(({ payload: position }) => {
   *  console.log('Window moved', position);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onMoved(handler) {
    return this.listen(TauriEvent.WINDOW_MOVED, (e) => {
      e.payload = new PhysicalPosition(e.payload);
      handler(e);
    });
  }
  /**
   * Listen to window close requested. Emitted when the user requests to closes the window.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * import { confirm } from '@tauri-apps/api/dialog';
   * const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
   *   const confirmed = await confirm('Are you sure?');
   *   if (!confirmed) {
   *     // user did not confirm closing the window; let's prevent it
   *     event.preventDefault();
   *   }
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onCloseRequested(handler) {
    return this.listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async (event) => {
      const evt = new CloseRequestedEvent(event);
      await handler(evt);
      if (!evt.isPreventDefault()) {
        await this.destroy();
      }
    });
  }
  /**
   * Listen to a file drop event.
   * The listener is triggered when the user hovers the selected files on the webview,
   * drops the files or cancels the operation.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/webview";
   * const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
   *  if (event.payload.type === 'over') {
   *    console.log('User hovering', event.payload.position);
   *  } else if (event.payload.type === 'drop') {
   *    console.log('User dropped', event.payload.paths);
   *  } else {
   *    console.log('File drop cancelled');
   *  }
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onDragDropEvent(handler) {
    const unlistenDrag = await this.listen(TauriEvent.DRAG_ENTER, (event) => {
      handler({
        ...event,
        payload: {
          type: "enter",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragOver = await this.listen(TauriEvent.DRAG_OVER, (event) => {
      handler({
        ...event,
        payload: {
          type: "over",
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDrop = await this.listen(TauriEvent.DRAG_DROP, (event) => {
      handler({
        ...event,
        payload: {
          type: "drop",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenCancel = await this.listen(TauriEvent.DRAG_LEAVE, (event) => {
      handler({ ...event, payload: { type: "leave" } });
    });
    return () => {
      unlistenDrag();
      unlistenDrop();
      unlistenDragOver();
      unlistenCancel();
    };
  }
  /**
   * Listen to window focus change.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
   *  console.log('Focus changed, window is focused? ' + focused);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onFocusChanged(handler) {
    const unlistenFocus = await this.listen(TauriEvent.WINDOW_FOCUS, (event) => {
      handler({ ...event, payload: true });
    });
    const unlistenBlur = await this.listen(TauriEvent.WINDOW_BLUR, (event) => {
      handler({ ...event, payload: false });
    });
    return () => {
      unlistenFocus();
      unlistenBlur();
    };
  }
  /**
   * Listen to window scale change. Emitted when the window's scale factor has changed.
   * The following user actions can cause DPI changes:
   * - Changing the display's resolution.
   * - Changing the display's scale factor (e.g. in Control Panel on Windows).
   * - Moving the window to a display with a different scale factor.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onScaleChanged(({ payload }) => {
   *  console.log('Scale changed', payload.scaleFactor, payload.size);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onScaleChanged(handler) {
    return this.listen(TauriEvent.WINDOW_SCALE_FACTOR_CHANGED, handler);
  }
  /**
   * Listen to the system theme change.
   *
   * @example
   * ```typescript
   * import { getCurrentWindow } from "@tauri-apps/api/window";
   * const unlisten = await getCurrentWindow().onThemeChanged(({ payload: theme }) => {
   *  console.log('New theme: ' + theme);
   * });
   *
   * // you need to call unlisten if your handler goes out of scope e.g. the component is unmounted
   * unlisten();
   * ```
   *
   * @returns A promise resolving to a function to unlisten to the event.
   * Note that removing the listener is required if your listener goes out of scope e.g. the component is unmounted.
   */
  async onThemeChanged(handler) {
    return this.listen(TauriEvent.WINDOW_THEME_CHANGED, handler);
  }
};
var BackgroundThrottlingPolicy;
(function(BackgroundThrottlingPolicy2) {
  BackgroundThrottlingPolicy2["Disabled"] = "disabled";
  BackgroundThrottlingPolicy2["Throttle"] = "throttle";
  BackgroundThrottlingPolicy2["Suspend"] = "suspend";
})(BackgroundThrottlingPolicy || (BackgroundThrottlingPolicy = {}));
var ScrollBarStyle;
(function(ScrollBarStyle2) {
  ScrollBarStyle2["Default"] = "default";
  ScrollBarStyle2["FluentOverlay"] = "fluentOverlay";
})(ScrollBarStyle || (ScrollBarStyle = {}));
var Effect;
(function(Effect2) {
  Effect2["AppearanceBased"] = "appearanceBased";
  Effect2["Light"] = "light";
  Effect2["Dark"] = "dark";
  Effect2["MediumLight"] = "mediumLight";
  Effect2["UltraDark"] = "ultraDark";
  Effect2["Titlebar"] = "titlebar";
  Effect2["Selection"] = "selection";
  Effect2["Menu"] = "menu";
  Effect2["Popover"] = "popover";
  Effect2["Sidebar"] = "sidebar";
  Effect2["HeaderView"] = "headerView";
  Effect2["Sheet"] = "sheet";
  Effect2["WindowBackground"] = "windowBackground";
  Effect2["HudWindow"] = "hudWindow";
  Effect2["FullScreenUI"] = "fullScreenUI";
  Effect2["Tooltip"] = "tooltip";
  Effect2["ContentBackground"] = "contentBackground";
  Effect2["UnderWindowBackground"] = "underWindowBackground";
  Effect2["UnderPageBackground"] = "underPageBackground";
  Effect2["Mica"] = "mica";
  Effect2["Blur"] = "blur";
  Effect2["Acrylic"] = "acrylic";
  Effect2["Tabbed"] = "tabbed";
  Effect2["TabbedDark"] = "tabbedDark";
  Effect2["TabbedLight"] = "tabbedLight";
})(Effect || (Effect = {}));
var EffectState;
(function(EffectState2) {
  EffectState2["FollowsWindowActiveState"] = "followsWindowActiveState";
  EffectState2["Active"] = "active";
  EffectState2["Inactive"] = "inactive";
})(EffectState || (EffectState = {}));

// apps/desktop/src/window-lifecycle.ts
function createTauriWindowLifecycle() {
  return {
    async onCloseRequested(handler) {
      const unlisten = await getCurrentWindow().onCloseRequested(handler);
      return { dispose: unlisten };
    },
    destroy() {
      return getCurrentWindow().destroy();
    }
  };
}

// apps/desktop/src/workspace-adapter.ts
var desktopWorkspaceCapabilities = {
  persistence: "durable",
  atomicReplace: "host-guaranteed",
  externalWatch: "native-hints"
};
function isRecord2(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function assertString(value, label) {
  if ("string" !== typeof value) {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
function decodeFormat(value) {
  if (!isRecord2(value)) {
    throw new Error("Document format must be an object");
  }
  if ("none" !== value.bom && "utf8" !== value.bom) {
    throw new Error("Document format has an invalid BOM value");
  }
  if ("lf" !== value.mainEol && "crlf" !== value.mainEol) {
    throw new Error("Document format has an invalid EOL value");
  }
  if ("boolean" !== typeof value.trailingNewline) {
    throw new Error("Document format trailingNewline must be boolean");
  }
  return {
    bom: value.bom,
    mainEol: value.mainEol,
    trailingNewline: value.trailingNewline
  };
}
function decodeAccess(value) {
  if (!isRecord2(value)) {
    throw new Error("Document access must be an object");
  }
  if ("read-write" === value.kind) {
    return { kind: "read-write" };
  }
  if ("read-only" === value.kind && "unsupported-encoding" === value.reason && "string" === typeof value.message) {
    return {
      kind: "read-only",
      reason: "unsupported-encoding",
      message: value.message
    };
  }
  throw new Error("Document access has an invalid value");
}
function decodeSnapshot(value) {
  if (!isRecord2(value)) {
    throw new Error("Document snapshot must be an object");
  }
  const capturedAt = value.capturedAt;
  if ("number" !== typeof capturedAt || !Number.isFinite(capturedAt)) {
    throw new Error("Document snapshot capturedAt must be finite");
  }
  return {
    path: workspacePath(assertString(value.path, "Document path")),
    pathKey: workspacePathKeyFromHost(assertString(value.pathKey, "Document path key")),
    content: assertString(value.content, "Document content"),
    revision: opaqueRevisionFromHost(assertString(value.revision, "Document revision")),
    byteHash: byteHashFromHost(assertString(value.byteHash, "Document byte hash")),
    format: decodeFormat(value.format),
    access: decodeAccess(value.access),
    capturedAt
  };
}
function decodeReadError(value) {
  if (!isRecord2(value) || "string" !== typeof value.message) {
    throw new Error("Workspace read error is malformed");
  }
  if (![
    "not-found",
    "outside-workspace",
    "unsupported-encoding",
    "permission-denied",
    "io-error"
  ].includes(String(value.kind))) {
    throw new Error("Workspace read error has an invalid kind");
  }
  return {
    kind: value.kind,
    message: value.message
  };
}
function ioReadError(error) {
  return {
    kind: "io-error",
    message: error instanceof Error ? error.message : String(error)
  };
}
function decodeWriteErrorKind(value) {
  if (![
    "not-found",
    "outside-workspace",
    "read-only",
    "permission-denied",
    "metadata-not-preserved",
    "io-error"
  ].includes(String(value))) {
    throw new Error("Workspace write error has an invalid kind");
  }
  return value;
}
function requireSnapshotIdentity(snapshot, path, pathKey) {
  if (snapshot.path !== path) {
    throw new Error("Workspace command returned a different path");
  }
  if (pathKey && snapshot.pathKey !== pathKey) {
    throw new Error("Workspace command returned a different path key");
  }
}
function writeIoError(error) {
  return {
    ok: false,
    kind: "io-error",
    message: error instanceof Error ? error.message : String(error)
  };
}
var DesktopWorkspaceAdapter = class {
  constructor(bridge, options = {}) {
    this.capabilities = desktopWorkspaceCapabilities;
    this.#bridge = bridge;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {
    });
  }
  #bridge;
  #onDiagnostic;
  async read(path) {
    try {
      const result = await this.#bridge.invoke(
        "workspace_read_document",
        { request: { path } }
      );
      if (!isRecord2(result)) {
        throw new Error("Workspace read result must be an object");
      }
      if ("error" === result.status) {
        return { ok: false, error: decodeReadError(result.error) };
      }
      if ("ok" !== result.status) {
        throw new Error("Workspace read result has an invalid status");
      }
      const snapshot = decodeSnapshot(result.snapshot);
      requireSnapshotIdentity(snapshot, path);
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, error: ioReadError(error) };
    }
  }
  async write(request) {
    try {
      const result = await this.#bridge.invoke(
        "workspace_write_document_if_revision",
        { request }
      );
      if (!isRecord2(result)) {
        throw new Error("Workspace write result must be an object");
      }
      if ("ok" === result.status) {
        const snapshot = decodeSnapshot(result.snapshot);
        requireSnapshotIdentity(snapshot, request.path, request.pathKey);
        return { ok: true, snapshot };
      }
      if ("conflict" === result.status) {
        const current = decodeSnapshot(result.current);
        requireSnapshotIdentity(current, request.path, request.pathKey);
        return { ok: false, kind: "conflict", current };
      }
      if ("error" === result.status && "string" === typeof result.kind && "string" === typeof result.message) {
        return {
          ok: false,
          kind: decodeWriteErrorKind(result.kind),
          message: result.message
        };
      }
      throw new Error("Workspace write result has an invalid status");
    } catch (error) {
      return writeIoError(error);
    }
  }
  async stat(path) {
    try {
      const result = await this.#bridge.invoke(
        "workspace_stat_document",
        { request: { path } }
      );
      if (!isRecord2(result)) {
        throw new Error("Workspace stat result must be an object");
      }
      if ("error" === result.status) {
        return { ok: false, error: decodeReadError(result.error) };
      }
      if ("ok" !== result.status || !isRecord2(result.stat)) {
        throw new Error("Workspace stat result has an invalid status");
      }
      const statPath = workspacePath(assertString(result.stat.path, "Workspace stat path"));
      let stat;
      if ("missing" === result.stat.kind) {
        stat = { kind: "missing", path: statPath };
      } else if ("directory" === result.stat.kind) {
        stat = {
          kind: "directory",
          path: statPath,
          pathKey: workspacePathKeyFromHost(
            assertString(result.stat.pathKey, "Workspace stat path key")
          )
        };
      } else if ("file" === result.stat.kind) {
        stat = {
          kind: "file",
          path: statPath,
          pathKey: workspacePathKeyFromHost(
            assertString(result.stat.pathKey, "Workspace stat path key")
          ),
          revision: opaqueRevisionFromHost(
            assertString(result.stat.revision, "Workspace stat revision")
          )
        };
      } else {
        throw new Error("Workspace stat has an invalid kind");
      }
      if (stat.path !== path) {
        throw new Error("Workspace stat returned a different path");
      }
      return { ok: true, stat };
    } catch (error) {
      return { ok: false, error: ioReadError(error) };
    }
  }
  watch(listener) {
    let disposed = false;
    const subscription = this.#bridge.listen("workspace-document-change", (wire) => {
      if (disposed) {
        return;
      }
      try {
        if (!isRecord2(wire)) {
          throw new Error("Workspace change hint must be an object");
        }
        if (!["created", "changed", "deleted"].includes(String(wire.kind))) {
          throw new Error("Workspace change hint has an invalid kind");
        }
        const pathKey = void 0 === wire.pathKey ? void 0 : workspacePathKeyFromHost(assertString(wire.pathKey, "Workspace change path key"));
        listener({
          path: workspacePath(assertString(wire.path, "Workspace change path")),
          ...pathKey ? { pathKey } : {},
          kind: wire.kind
        });
      } catch (error) {
        this.#onDiagnostic(error instanceof Error ? error.message : String(error));
      }
    }).catch((error) => {
      this.#onDiagnostic(error instanceof Error ? error.message : String(error));
      return () => {
      };
    });
    return {
      dispose: async () => {
        disposed = true;
        const unlisten = await subscription;
        unlisten();
      }
    };
  }
  trackDocument(path) {
    let disposed = false;
    let registered = false;
    const registration = this.#bridge.invoke("workspace_watch_document", { relativePath: path }).then(() => {
      registered = true;
    }).catch((error) => {
      this.#onDiagnostic(error instanceof Error ? error.message : String(error));
    });
    return {
      dispose: async () => {
        if (disposed) {
          return;
        }
        disposed = true;
        await registration;
        if (!registered) {
          return;
        }
        try {
          await this.#bridge.invoke("workspace_unwatch_document", { relativePath: path });
        } catch (error) {
          this.#onDiagnostic(error instanceof Error ? error.message : String(error));
        }
      }
    };
  }
};

// packages/core/src/document-session.ts
var DocumentReadOnlyError = class extends Error {
  constructor(snapshot) {
    if ("read-write" === snapshot.access.kind) {
      throw new Error("DocumentReadOnlyError requires a read-only snapshot");
    }
    super(snapshot.access.message);
    this.name = "DocumentReadOnlyError";
    this.reason = snapshot.access.reason;
  }
};
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function requiresRecovery(state) {
  return state.dirty || null !== state.conflict;
}
var DocumentSession = class {
  #adapter;
  #paneIds = /* @__PURE__ */ new Set();
  #savedSnapshot;
  #buffer;
  #bufferVersion = 0;
  #saveState = { kind: "idle" };
  #conflict = null;
  #recoveryState = { kind: "clean" };
  #saveRequested = false;
  #saveLoop = null;
  #refreshRequested = false;
  #refreshLoop = null;
  #recoveryRequested = false;
  #recoveryLoop = null;
  #recoveryNow = Date.now;
  constructor(snapshot, adapter) {
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#adapter = adapter;
  }
  get state() {
    return {
      path: this.#savedSnapshot.path,
      pathKey: this.#savedSnapshot.pathKey,
      savedSnapshot: this.#savedSnapshot,
      buffer: this.#buffer,
      bufferVersion: this.#bufferVersion,
      dirty: this.#buffer !== this.#savedSnapshot.content,
      saveState: this.#saveState,
      conflict: this.#conflict,
      recoveryState: this.#recoveryState,
      paneIds: [...this.#paneIds]
    };
  }
  edit(content) {
    if ("read-only" === this.#savedSnapshot.access.kind) {
      throw new DocumentReadOnlyError(this.#savedSnapshot);
    }
    if (content === this.#buffer) {
      return;
    }
    this.#buffer = content;
    this.#bufferVersion += 1;
    this.#recoveryState = { kind: "pending", bufferVersion: this.#bufferVersion };
    if ("error" === this.#saveState.kind) {
      this.#saveState = { kind: "idle" };
    }
  }
  attachPane(paneId) {
    if ("" === paneId) {
      throw new Error("Pane ID must not be empty");
    }
    this.#paneIds.add(paneId);
  }
  detachPane(paneId) {
    this.#paneIds.delete(paneId);
  }
  usesAdapter(adapter) {
    return this.#adapter === adapter;
  }
  async save() {
    if (this.#conflict) {
      return { kind: "conflict", conflict: this.#conflict };
    }
    if (!this.state.dirty) {
      return { kind: "unchanged", snapshot: this.#savedSnapshot };
    }
    if ("read-only" === this.#savedSnapshot.access.kind) {
      const message = this.#savedSnapshot.access.message;
      this.#saveState = { kind: "error", message };
      return { kind: "error", message };
    }
    this.#saveRequested = true;
    this.#saveLoop ??= this.#drainSaveQueue().finally(() => {
      this.#saveLoop = null;
    });
    return this.#saveLoop;
  }
  async #drainSaveQueue() {
    let outcome = { kind: "unchanged", snapshot: this.#savedSnapshot };
    while (this.#saveRequested) {
      this.#saveRequested = false;
      if (this.#conflict) {
        return { kind: "conflict", conflict: this.#conflict };
      }
      if (!this.state.dirty) {
        outcome = { kind: "unchanged", snapshot: this.#savedSnapshot };
        continue;
      }
      const content = this.#buffer;
      const bufferVersion = this.#bufferVersion;
      this.#saveState = { kind: "saving", bufferVersion };
      const result = await this.#adapter.write({
        path: this.#savedSnapshot.path,
        pathKey: this.#savedSnapshot.pathKey,
        expectedRevision: this.#savedSnapshot.revision,
        content,
        format: this.#savedSnapshot.format
      });
      outcome = this.#applyWriteResult(result, content, bufferVersion);
      if ("conflict" === outcome.kind || "error" === outcome.kind) {
        return outcome;
      }
    }
    return outcome;
  }
  #applyWriteResult(result, savedContent, savedBufferVersion) {
    if (!result.ok) {
      if ("conflict" === result.kind) {
        this.#conflict = { kind: "external-change", diskSnapshot: result.current };
        this.#saveState = { kind: "idle" };
        return { kind: "conflict", conflict: this.#conflict };
      }
      this.#saveState = { kind: "error", message: result.message };
      return { kind: "error", message: result.message };
    }
    if (result.snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      const message = "Workspace adapter changed the document identity during save";
      this.#saveState = { kind: "error", message };
      return { kind: "error", message };
    }
    if ("read-only" === result.snapshot.access.kind) {
      const message = "Workspace adapter returned a read-only snapshot after a successful write";
      this.#saveState = { kind: "error", message };
      return { kind: "error", message };
    }
    this.#savedSnapshot = result.snapshot;
    this.#saveState = { kind: "idle" };
    if (this.#bufferVersion === savedBufferVersion) {
      this.#buffer = result.snapshot.content;
      this.#recoveryState = { kind: "clean" };
      return { kind: "saved", snapshot: result.snapshot };
    }
    if (this.#buffer === savedContent) {
      this.#buffer = result.snapshot.content;
    }
    return { kind: "still-dirty", snapshot: result.snapshot };
  }
  applyExternalSnapshot(snapshot) {
    if (snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      throw new Error("External snapshot belongs to a different document");
    }
    if (this.state.dirty || "saving" === this.#saveState.kind || this.#conflict) {
      this.#conflict = { kind: "external-change", diskSnapshot: snapshot };
      return;
    }
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#bufferVersion += 1;
    this.#conflict = null;
    this.#recoveryState = { kind: "clean" };
  }
  markMissing() {
    this.#conflict = { kind: "missing" };
  }
  /** Watch events are hints: every call re-reads, and overlapping hints coalesce serially. */
  refreshFromHost() {
    this.#refreshRequested = true;
    this.#refreshLoop ??= this.#drainExternalRefreshQueue().finally(() => {
      this.#refreshLoop = null;
    });
    return this.#refreshLoop;
  }
  async #drainExternalRefreshQueue() {
    let outcome = {
      kind: "unchanged",
      snapshot: this.#savedSnapshot
    };
    while (this.#refreshRequested) {
      this.#refreshRequested = false;
      if (this.#saveLoop) {
        await this.#saveLoop;
      }
      const requestedPath = this.#savedSnapshot.path;
      const requestedPathKey = this.#savedSnapshot.pathKey;
      let result;
      try {
        result = await this.#adapter.read(requestedPath);
      } catch (error) {
        outcome = {
          kind: "error",
          error: { kind: "io-error", message: errorMessage(error) }
        };
        continue;
      }
      if (requestedPath !== this.#savedSnapshot.path || requestedPathKey !== this.#savedSnapshot.pathKey) {
        this.#refreshRequested = true;
        continue;
      }
      if (!result.ok) {
        if ("not-found" === result.error.kind) {
          this.markMissing();
          outcome = { kind: "missing", conflict: this.#conflict };
        } else {
          outcome = { kind: "error", error: result.error };
        }
        continue;
      }
      const snapshot = result.snapshot;
      if (snapshot.pathKey !== requestedPathKey) {
        outcome = {
          kind: "error",
          error: {
            kind: "io-error",
            message: "Workspace adapter changed document identity while refreshing a watch hint"
          }
        };
        continue;
      }
      if (snapshot.revision === this.#savedSnapshot.revision) {
        if (snapshot.byteHash !== this.#savedSnapshot.byteHash || snapshot.content !== this.#savedSnapshot.content) {
          outcome = {
            kind: "error",
            error: {
              kind: "io-error",
              message: "Workspace adapter returned different bytes for the same opaque revision"
            }
          };
        } else {
          outcome = this.#conflict ? { kind: "conflict", conflict: this.#conflict } : { kind: "unchanged", snapshot: this.#savedSnapshot };
        }
        continue;
      }
      const wasClean = !this.state.dirty && "saving" !== this.#saveState.kind && !this.#conflict;
      this.applyExternalSnapshot(snapshot);
      outcome = wasClean ? { kind: "reloaded", snapshot } : { kind: "conflict", conflict: this.#conflict };
    }
    return outcome;
  }
  reloadFromDisk(snapshot) {
    if (snapshot.pathKey !== this.#savedSnapshot.pathKey) {
      throw new Error("Reload snapshot belongs to a different document");
    }
    this.#savedSnapshot = snapshot;
    this.#buffer = snapshot.content;
    this.#bufferVersion += 1;
    this.#conflict = null;
    this.#saveState = { kind: "idle" };
    this.#recoveryState = { kind: "clean" };
  }
  rebindAfterHostRename(snapshot) {
    if (snapshot.content !== this.#savedSnapshot.content || snapshot.revision !== this.#savedSnapshot.revision) {
      throw new Error("Rename snapshot must preserve the saved document revision and content");
    }
    this.#savedSnapshot = snapshot;
  }
  restoreRecovery(record) {
    if (1 !== record.schemaVersion) {
      throw new Error("Recovery record schema is unsupported");
    }
    if (record.path !== this.#savedSnapshot.path || record.pathKey !== this.#savedSnapshot.pathKey) {
      throw new Error("Recovery record belongs to a different document");
    }
    if (!Number.isSafeInteger(record.bufferVersion) || 0 > record.bufferVersion || !Number.isSafeInteger(record.capturedAt) || 0 > record.capturedAt) {
      throw new Error("Recovery record counters must be non-negative safe integers");
    }
    if (0 !== this.#bufferVersion || this.#buffer !== this.#savedSnapshot.content || null !== this.#conflict || "idle" !== this.#saveState.kind || "clean" !== this.#recoveryState.kind) {
      throw new Error("Recovery can only be restored into a fresh document session");
    }
    if (record.savedRevision === this.#savedSnapshot.revision && record.buffer === this.#savedSnapshot.content) {
      this.#buffer = this.#savedSnapshot.content;
      this.#conflict = null;
      this.#saveState = { kind: "idle" };
      this.#recoveryState = { kind: "clean" };
      return { kind: "stale" };
    }
    this.#buffer = record.buffer;
    this.#bufferVersion = record.bufferVersion;
    this.#saveState = { kind: "idle" };
    this.#recoveryState = {
      kind: "persisted",
      bufferVersion: this.#bufferVersion,
      capturedAt: record.capturedAt
    };
    if (record.savedRevision !== this.#savedSnapshot.revision) {
      this.#conflict = {
        kind: "external-change",
        diskSnapshot: this.#savedSnapshot
      };
      return { kind: "conflict", conflict: this.#conflict };
    }
    this.#conflict = null;
    return { kind: "restored" };
  }
  persistRecovery(store, now = Date.now) {
    this.#recoveryNow = now;
    this.#recoveryRequested = true;
    this.#recoveryLoop ??= this.#drainRecoveryQueue(store).finally(() => {
      this.#recoveryLoop = null;
    });
    return this.#recoveryLoop;
  }
  async #drainRecoveryQueue(store) {
    let outcome = { kind: "clean" };
    while (this.#recoveryRequested) {
      this.#recoveryRequested = false;
      const state = this.state;
      if (!requiresRecovery(state)) {
        try {
          await store.remove(state.pathKey);
          this.#recoveryState = { kind: "clean" };
          outcome = { kind: "clean" };
          continue;
        } catch (error) {
          const message = errorMessage(error);
          this.#recoveryState = { kind: "error", message };
          return { kind: "error", message };
        }
      }
      const capturedAt = this.#recoveryNow();
      const bufferVersion = this.#bufferVersion;
      const record = {
        schemaVersion: 1,
        path: this.#savedSnapshot.path,
        pathKey: this.#savedSnapshot.pathKey,
        savedRevision: this.#savedSnapshot.revision,
        buffer: this.#buffer,
        bufferVersion,
        capturedAt
      };
      try {
        await store.write(record);
      } catch (error) {
        const message = errorMessage(error);
        this.#recoveryState = { kind: "error", message };
        return { kind: "error", message };
      }
      const currentState = this.state;
      if (!requiresRecovery(currentState)) {
        this.#recoveryRequested = true;
        continue;
      }
      if (bufferVersion === this.#bufferVersion) {
        this.#recoveryState = { kind: "persisted", bufferVersion, capturedAt };
        outcome = { kind: "persisted", bufferVersion, capturedAt };
      } else {
        this.#recoveryState = { kind: "pending", bufferVersion: this.#bufferVersion };
        outcome = {
          kind: "superseded",
          persistedBufferVersion: bufferVersion,
          currentBufferVersion: this.#bufferVersion
        };
      }
    }
    return outcome;
  }
};
var RecoveryCoordinator = class {
  #store;
  #scheduler;
  #clock;
  #debounceMs;
  #periodicMs;
  #entries = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#store = options.store;
    this.#scheduler = options.scheduler;
    this.#clock = options.clock;
    this.#debounceMs = options.debounceMs ?? 2e3;
    this.#periodicMs = options.periodicMs ?? 3e4;
    if (0 > this.#debounceMs || 0 >= this.#periodicMs) {
      throw new Error("Recovery timing values must be non-negative and periodicMs must be positive");
    }
  }
  track(session) {
    if (this.#entries.has(session)) {
      throw new Error("Document session is already tracked for recovery");
    }
    const entry = { session };
    this.#entries.set(session, entry);
    if (requiresRecovery(session.state)) {
      this.#armForDirtyState(entry);
    }
    return {
      dispose: () => {
        if (this.#entries.get(session) !== entry) {
          return;
        }
        this.#cancelTimers(entry);
        this.#entries.delete(session);
      }
    };
  }
  /** Call after edits, save/reload completion, conflict changes and app rename rebinds. */
  notifyChanged(session) {
    const entry = this.#requireEntry(session);
    if (requiresRecovery(session.state)) {
      this.#armForDirtyState(entry);
      return Promise.resolve(null);
    }
    this.#cancelTimers(entry);
    return this.#flushEntry(entry, "manual");
  }
  flush(session, reason) {
    const entry = this.#requireEntry(session);
    if (void 0 !== entry.debounceTimer) {
      this.#scheduler.cancel(entry.debounceTimer);
      entry.debounceTimer = void 0;
    }
    return this.#flushEntry(entry, reason);
  }
  async flushAll(reason) {
    return Promise.all([...this.#entries.values()].map((entry) => {
      if (void 0 !== entry.debounceTimer) {
        this.#scheduler.cancel(entry.debounceTimer);
        entry.debounceTimer = void 0;
      }
      return this.#flushEntry(entry, reason);
    }));
  }
  async prepareForRestart() {
    await this.flushAll("prepare-for-restart");
    const reasons = [];
    for (const entry of this.#entries.values()) {
      const state = entry.session.state;
      if (state.conflict) {
        reasons.push({ kind: "conflict", pathKey: state.pathKey });
        continue;
      }
      if ("saving" === state.saveState.kind) {
        reasons.push({ kind: "save-in-progress", pathKey: state.pathKey });
        continue;
      }
      if ("error" === state.saveState.kind) {
        reasons.push({
          kind: "save-error",
          pathKey: state.pathKey,
          message: state.saveState.message
        });
        continue;
      }
      if ("error" === state.recoveryState.kind) {
        reasons.push({
          kind: "recovery-error",
          pathKey: state.pathKey,
          message: state.recoveryState.message
        });
        continue;
      }
      if (state.dirty && !("persisted" === state.recoveryState.kind && state.bufferVersion === state.recoveryState.bufferVersion)) {
        reasons.push({
          kind: "recovery-not-current",
          pathKey: state.pathKey,
          bufferVersion: state.bufferVersion
        });
      }
    }
    return 0 === reasons.length ? { kind: "ready" } : { kind: "blocked", reasons };
  }
  dispose() {
    for (const entry of this.#entries.values()) {
      this.#cancelTimers(entry);
    }
    this.#entries.clear();
  }
  #requireEntry(session) {
    const entry = this.#entries.get(session);
    if (!entry) {
      throw new Error("Document session is not tracked for recovery");
    }
    return entry;
  }
  #armForDirtyState(entry) {
    if (void 0 !== entry.debounceTimer) {
      this.#scheduler.cancel(entry.debounceTimer);
    }
    entry.debounceTimer = this.#scheduler.schedule(this.#debounceMs, () => {
      entry.debounceTimer = void 0;
      void this.#flushEntry(entry, "debounce");
    });
    if (void 0 === entry.periodicTimer) {
      entry.periodicTimer = this.#scheduler.schedule(this.#periodicMs, () => {
        entry.periodicTimer = void 0;
        void this.#flushEntry(entry, "periodic");
      });
    }
  }
  async #flushEntry(entry, _reason) {
    const outcome = await entry.session.persistRecovery(
      this.#store,
      () => this.#clock.now()
    );
    if (void 0 !== entry.periodicTimer) {
      this.#scheduler.cancel(entry.periodicTimer);
      entry.periodicTimer = void 0;
    }
    if (requiresRecovery(entry.session.state)) {
      entry.periodicTimer = this.#scheduler.schedule(this.#periodicMs, () => {
        entry.periodicTimer = void 0;
        void this.#flushEntry(entry, "periodic");
      });
    }
    return outcome;
  }
  #cancelTimers(entry) {
    if (void 0 !== entry.debounceTimer) {
      this.#scheduler.cancel(entry.debounceTimer);
      entry.debounceTimer = void 0;
    }
    if (void 0 !== entry.periodicTimer) {
      this.#scheduler.cancel(entry.periodicTimer);
      entry.periodicTimer = void 0;
    }
  }
};
var SessionRegistry = class {
  #sessions = /* @__PURE__ */ new Map();
  open(snapshot, adapter) {
    const existing = this.#sessions.get(snapshot.pathKey);
    if (existing) {
      return existing;
    }
    const session = new DocumentSession(snapshot, adapter);
    this.#sessions.set(snapshot.pathKey, session);
    return session;
  }
  get(pathKey) {
    return this.#sessions.get(pathKey);
  }
  bindWorkspaceWatch(adapter, listener) {
    return adapter.watch((hint) => {
      const session = hint.pathKey ? this.#sessions.get(hint.pathKey) : [...this.#sessions.values()].find(
        (candidate) => candidate.usesAdapter(adapter) && candidate.state.path === hint.path
      );
      if (!session || !session.usesAdapter(adapter)) {
        return;
      }
      void session.refreshFromHost().then((outcome) => {
        listener?.({ hint, session, outcome });
      });
    });
  }
  rekeyAfterHostRename(oldPathKey, snapshot) {
    const session = this.#sessions.get(oldPathKey);
    if (!session) {
      throw new Error("Cannot rename a document without an open session");
    }
    const collision = this.#sessions.get(snapshot.pathKey);
    if (collision && collision !== session) {
      throw new Error("Cannot rename onto another open document session");
    }
    session.rebindAfterHostRename(snapshot);
    this.#sessions.delete(oldPathKey);
    this.#sessions.set(snapshot.pathKey, session);
    return session;
  }
  release(pathKey) {
    const session = this.#sessions.get(pathKey);
    if (!session) {
      return false;
    }
    const state = session.state;
    if (state.dirty || state.conflict || "clean" !== state.recoveryState.kind) {
      return false;
    }
    if (0 < state.paneIds.length) {
      return false;
    }
    return this.#sessions.delete(pathKey);
  }
  list() {
    return [...this.#sessions.values()];
  }
};

// packages/editor/src/pane-controller.ts
var EMPTY_VIEW = Object.freeze({
  selectionAnchor: 0,
  selectionHead: 0,
  scrollLeft: 0,
  scrollTop: 0,
  focused: false
});
function copyView(view) {
  return { ...view };
}
function validateView(view) {
  for (const [name, value] of Object.entries(view)) {
    if ("focused" === name) {
      if ("boolean" !== typeof value) {
        throw new Error("Pane focused state must be boolean");
      }
      continue;
    }
    if ("number" !== typeof value || !Number.isFinite(value) || 0 > value) {
      throw new Error(`Pane ${name} must be a non-negative finite number`);
    }
  }
}
var PaneController = class {
  #registry;
  #panes = {
    primary: { id: "primary", session: null, view: copyView(EMPTY_VIEW) },
    secondary: { id: "secondary", session: null, view: copyView(EMPTY_VIEW) }
  };
  #activePane = "primary";
  #preferredActivePane = "primary";
  #secondaryAvailable = true;
  #secondaryRequested = false;
  constructor(registry = new SessionRegistry()) {
    this.#registry = registry;
  }
  get registry() {
    return this.#registry;
  }
  get state() {
    return {
      activePane: this.#activePane,
      secondaryAvailable: this.#secondaryAvailable,
      secondaryVisible: this.#secondaryAvailable && this.#secondaryRequested,
      primary: this.#paneState("primary"),
      secondary: this.#paneState("secondary")
    };
  }
  open(snapshot, adapter, options = {}) {
    const requestedTarget = options.target ?? "active";
    const resolvedTarget = "active" === requestedTarget ? this.#activePane : requestedTarget;
    const fellBackToPrimary = "secondary" === resolvedTarget && !this.#secondaryAvailable;
    const paneId = fellBackToPrimary ? "primary" : resolvedTarget;
    const existing = this.#registry.get(snapshot.pathKey);
    const session = this.#registry.open(snapshot, adapter);
    const releasedSession = this.#bind(paneId, session);
    if ("secondary" === paneId) {
      this.#secondaryRequested = true;
    }
    this.#activePane = paneId;
    this.#preferredActivePane = paneId;
    return {
      paneId,
      session,
      reusedSession: void 0 !== existing,
      fellBackToPrimary,
      releasedSession
    };
  }
  activate(paneId) {
    if ("secondary" === paneId && !this.#secondaryAvailable) {
      throw new Error("Secondary pane is unavailable in the current layout");
    }
    if ("secondary" === paneId && !this.#secondaryRequested) {
      throw new Error("Secondary pane is not visible in the current layout");
    }
    this.#activePane = paneId;
    this.#preferredActivePane = paneId;
  }
  setSecondaryAvailable(available) {
    this.#secondaryAvailable = available;
    if (!available && "secondary" === this.#activePane) {
      this.#activePane = "primary";
    } else if (available && this.#secondaryRequested && "secondary" === this.#preferredActivePane) {
      this.#activePane = "secondary";
    }
  }
  get layoutPreference() {
    return {
      secondaryVisible: this.#secondaryRequested,
      activePane: this.#preferredActivePane
    };
  }
  restoreLayout(preference) {
    if ("boolean" !== typeof preference.secondaryVisible || "primary" !== preference.activePane && "secondary" !== preference.activePane || !preference.secondaryVisible && "secondary" === preference.activePane) {
      throw new Error("Pane layout preference is malformed");
    }
    this.#secondaryRequested = preference.secondaryVisible;
    this.#preferredActivePane = preference.secondaryVisible ? preference.activePane : "primary";
    this.#activePane = this.#secondaryAvailable && this.#secondaryRequested && "secondary" === this.#preferredActivePane ? "secondary" : "primary";
  }
  updateView(paneId, view) {
    validateView(view);
    this.#panes[paneId].view = copyView(view);
  }
  closeSecondary() {
    const session = this.#panes.secondary.session;
    if (session) {
      session.detachPane("secondary");
      this.#panes.secondary.session = null;
    }
    this.#panes.secondary.view = copyView(EMPTY_VIEW);
    this.#secondaryRequested = false;
    this.#activePane = "primary";
    this.#preferredActivePane = "primary";
    if (!session) {
      return null;
    }
    return {
      session,
      released: this.#registry.release(session.state.pathKey)
    };
  }
  dispose() {
    for (const paneId of ["primary", "secondary"]) {
      const pane = this.#panes[paneId];
      const session = pane.session;
      if (!session) {
        continue;
      }
      session.detachPane(paneId);
      pane.session = null;
      pane.view = copyView(EMPTY_VIEW);
      this.#registry.release(session.state.pathKey);
    }
    this.#activePane = "primary";
    this.#preferredActivePane = "primary";
    this.#secondaryRequested = false;
  }
  #paneState(paneId) {
    const pane = this.#panes[paneId];
    return {
      id: pane.id,
      session: pane.session,
      view: copyView(pane.view)
    };
  }
  #bind(paneId, session) {
    const pane = this.#panes[paneId];
    const previous = pane.session;
    if (previous === session) {
      return null;
    }
    let releasedSession = null;
    if (previous) {
      previous.detachPane(paneId);
      if (this.#registry.release(previous.state.pathKey)) {
        releasedSession = previous;
      }
    }
    pane.session = session;
    pane.view = copyView(EMPTY_VIEW);
    session.attachPane(paneId);
    return releasedSession;
  }
};

// packages/editor/src/session-editor-binding.ts
function isDocumentReadOnlyError(error) {
  return error instanceof Error && "DocumentReadOnlyError" === error.name && "unsupported-encoding" === error.reason;
}
var SessionEditorBinding = class {
  #session;
  #editor;
  #subscription;
  #onEdited;
  #onReadOnlyEdit;
  #synchronizing = false;
  #disposed = false;
  constructor(session, editor, options = {}) {
    this.#session = session;
    this.#editor = editor;
    this.#onEdited = options.onEdited ?? (() => {
    });
    this.#onReadOnlyEdit = options.onReadOnlyEdit ?? (() => {
    });
    this.syncFromSession();
    this.#subscription = editor.subscribe(() => this.#handleEditorChange());
  }
  get session() {
    return this.#session;
  }
  syncFromSession() {
    if (this.#disposed) {
      return;
    }
    const state = this.#session.state;
    this.#editor.setReadOnly("read-only" === state.savedSnapshot.access.kind);
    if (this.#editor.getValue() === state.buffer) {
      return;
    }
    this.#synchronizing = true;
    try {
      this.#editor.setValue(state.buffer);
    } finally {
      this.#synchronizing = false;
    }
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#subscription.dispose();
  }
  #handleEditorChange() {
    if (this.#disposed || this.#synchronizing) {
      return;
    }
    try {
      const previousBufferVersion = this.#session.state.bufferVersion;
      this.#session.edit(this.#editor.getValue());
      if (previousBufferVersion !== this.#session.state.bufferVersion) {
        this.#onEdited(this.#session);
      }
    } catch (error) {
      if (!isDocumentReadOnlyError(error)) {
        throw error;
      }
      this.#onReadOnlyEdit(error);
      this.syncFromSession();
    }
  }
};

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
function createWorkerUnavailableDiff(savedContent, buffer) {
  const saved = normalizeContent(savedContent);
  const current = normalizeContent(buffer);
  if (saved === current) {
    return { kind: "identical" };
  }
  return changedBlock(
    "worker-unavailable",
    1,
    countLines(saved),
    1,
    countLines(current)
  );
}

// packages/plugin-manifest/src/index.ts
var PLUGIN_MANIFEST_SCHEMA_VERSION = 1;
var KNOWN_PERMISSIONS = /* @__PURE__ */ new Set([
  "commands",
  "documents.editActive",
  "documents.readActive",
  "editor.extensions",
  "extensions.consume",
  "extensions.register",
  "navigation.openMarkdown",
  "process.vcs",
  "storage.workspace",
  "ui.documentHeader",
  "ui.views",
  "workspace.readMarkdown",
  "workspace.readText",
  "workspace.modifyMarkdown",
  "workspace.modifyText",
  "workspace.writeMedia",
  "workspace.writeTextBatch",
  "workspace.writeMarkdown",
  "workspace.watchMarkdown"
]);
function isRecord3(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function isIdentifier(value) {
  return "string" === typeof value && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(value);
}
function isEntryBasename(value) {
  return "string" === typeof value && /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(value);
}
function isKeybinding(value) {
  if ("string" !== typeof value) {
    return false;
  }
  const parts = value.split("+");
  const key = parts.pop();
  const modifiers = new Set(parts);
  return 0 < parts.length && parts.length === modifiers.size && parts.every((part) => ["Mod", "Ctrl", "Meta", "Alt", "Shift"].includes(part)) && ("Enter" === key || "Escape" === key || /^[A-Z0-9]$/u.test(key ?? ""));
}
function validateContributions(value, errors) {
  if (void 0 === value) {
    return;
  }
  if (!isRecord3(value)) {
    errors.push("contributes must be an object");
    return;
  }
  if (void 0 !== value.documentHeaders) {
    if (!Array.isArray(value.documentHeaders)) {
      errors.push("contributes.documentHeaders must be an array");
    } else {
      const seen = /* @__PURE__ */ new Set();
      value.documentHeaders.forEach((entry, index) => {
        if (!isRecord3(entry) || !isIdentifier(entry.id) || "string" !== typeof entry.title || "" === entry.title.trim()) {
          errors.push(`contributes.documentHeaders[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate document header contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
  if (void 0 !== value.commands) {
    if (!Array.isArray(value.commands)) {
      errors.push("contributes.commands must be an array");
    } else {
      const seen = /* @__PURE__ */ new Set();
      value.commands.forEach((entry, index) => {
        if (!isRecord3(entry) || !isIdentifier(entry.id) || "string" !== typeof entry.title || "" === entry.title.trim() || void 0 !== entry.defaultKeybindings && (!Array.isArray(entry.defaultKeybindings) || entry.defaultKeybindings.some((keybinding) => !isKeybinding(keybinding)) || new Set(entry.defaultKeybindings).size !== entry.defaultKeybindings.length)) {
          errors.push(`contributes.commands[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate command contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
  if (void 0 !== value.views) {
    if (!Array.isArray(value.views)) {
      errors.push("contributes.views must be an array");
    } else {
      const seen = /* @__PURE__ */ new Set();
      value.views.forEach((entry, index) => {
        if (!isRecord3(entry) || !isIdentifier(entry.id) || "string" !== typeof entry.title || "" === entry.title.trim() || !["sidebar", "secondary-pane", "editor-pane"].includes(String(entry.location))) {
          errors.push(`contributes.views[${index}] is malformed`);
          return;
        }
        if (seen.has(entry.id)) {
          errors.push(`duplicate view contribution: ${entry.id}`);
        }
        seen.add(entry.id);
      });
    }
  }
}
function validatePluginManifest(value) {
  const errors = [];
  if (!isRecord3(value)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  if (PLUGIN_MANIFEST_SCHEMA_VERSION !== value.schemaVersion) {
    errors.push(`schemaVersion must be ${PLUGIN_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!isIdentifier(value.id)) {
    errors.push("id must be a canonical plugin identifier");
  }
  if ("string" !== typeof value.name || "" === value.name.trim()) {
    errors.push("name must be a non-empty string");
  }
  if ("string" !== typeof value.version || "" === value.version.trim()) {
    errors.push("version must be a non-empty string");
  }
  if (!isEntryBasename(value.entry)) {
    errors.push("entry must be a JavaScript basename without a path");
  }
  if (void 0 !== value.description && "string" !== typeof value.description) {
    errors.push("description must be a string");
  }
  if (void 0 !== value.activationEvents) {
    if (!Array.isArray(value.activationEvents)) {
      errors.push("activationEvents must be an array");
    } else {
      value.activationEvents.forEach((event, index) => {
        if ("string" !== typeof event || !("onStartup" === event || /^on(?:Command|View):[a-z0-9][a-z0-9._-]*$/u.test(event))) {
          errors.push(`activationEvents[${index}] is malformed`);
        }
      });
    }
  }
  if (void 0 !== value.permissions) {
    if (!Array.isArray(value.permissions)) {
      errors.push("permissions must be an array");
    } else {
      const seen = /* @__PURE__ */ new Set();
      value.permissions.forEach((permission, index) => {
        if ("string" !== typeof permission || !KNOWN_PERMISSIONS.has(permission)) {
          errors.push(`permissions[${index}] is unknown`);
          return;
        }
        if (seen.has(permission)) {
          errors.push(`duplicate permission: ${permission}`);
        }
        seen.add(permission);
      });
    }
  }
  validateContributions(value.contributes, errors);
  if (isRecord3(value.contributes) && Array.isArray(value.contributes.documentHeaders) && 0 < value.contributes.documentHeaders.length && (!Array.isArray(value.permissions) || !value.permissions.includes("ui.documentHeader"))) {
    errors.push("document header contributions require ui.documentHeader");
  }
  if (isRecord3(value.contributes) && Array.isArray(value.contributes.commands) && 0 < value.contributes.commands.length && (!Array.isArray(value.permissions) || !value.permissions.includes("commands"))) {
    errors.push("command contributions require commands");
  }
  if (isRecord3(value.contributes) && Array.isArray(value.contributes.views) && 0 < value.contributes.views.length && (!Array.isArray(value.permissions) || !value.permissions.includes("ui.views"))) {
    errors.push("view contributions require ui.views");
  }
  if (Array.isArray(value.permissions) && value.permissions.includes("documents.editActive") && !value.permissions.includes("documents.readActive")) {
    errors.push("documents.editActive requires documents.readActive");
  }
  if (Array.isArray(value.permissions) && value.permissions.includes("workspace.modifyMarkdown") && !value.permissions.includes("workspace.readMarkdown")) {
    errors.push("workspace.modifyMarkdown requires workspace.readMarkdown");
  }
  if (Array.isArray(value.permissions) && value.permissions.includes("workspace.modifyText") && !value.permissions.includes("workspace.readText")) {
    errors.push("workspace.modifyText requires workspace.readText");
  }
  if (0 < errors.length) {
    return { ok: false, errors };
  }
  return { ok: true, manifest: value };
}

// packages/plugin-runtime/src/index.ts
var ManagedSubscriptions = class {
  #items = [];
  #disposed = false;
  add(disposable) {
    if (this.#disposed) {
      throw new Error("Cannot add a subscription after disposal");
    }
    this.#items.push(disposable);
    return disposable;
  }
  async dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors = [];
    for (const disposable of this.#items.reverse()) {
      try {
        await disposable.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#items.length = 0;
    throwCollectedErrors(errors, "One or more plugin subscriptions failed to dispose");
  }
};
function throwCollectedErrors(errors, message) {
  if (0 === errors.length) {
    return;
  }
  if (1 === errors.length) {
    throw errors[0];
  }
  throw new AggregateError(errors, message);
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (null !== value && "object" === typeof value) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function validateCatalogEntry(entry) {
  const validation = validatePluginManifest(entry.manifest);
  if (!validation.ok) {
    throw new Error(`Invalid bundled manifest: ${validation.errors.join("; ")}`);
  }
  if (entry.entry !== validation.manifest.entry) {
    throw new Error("Bundled catalog entry basename does not match its manifest");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(entry.contentHash)) {
    throw new Error("Bundled catalog content hash is malformed");
  }
  return validation.manifest;
}
function validateLoadedModule(entry, loaded) {
  const loadedManifest = validatePluginManifest(loaded.pluginManifest);
  if (!loadedManifest.ok) {
    throw new Error(`Loaded plugin manifest is invalid: ${loadedManifest.errors.join("; ")}`);
  }
  if (canonicalJson(entry.manifest) !== canonicalJson(loadedManifest.manifest)) {
    throw new Error("Loaded plugin manifest does not match the bundled catalog");
  }
  if (entry.contentHash !== loaded.pluginContentHash) {
    throw new Error("Loaded plugin content hash does not match the bundled catalog");
  }
  if (!loaded.default || "function" !== typeof loaded.default.activate) {
    throw new Error("Loaded plugin module has no activation entrypoint");
  }
  return loaded.default;
}
var InProcessPluginRuntime = class {
  #host;
  #records = /* @__PURE__ */ new Map();
  #disabled = /* @__PURE__ */ new Set();
  #diagnostics = [];
  constructor(host) {
    this.#host = host;
  }
  getState(pluginId) {
    return this.#records.get(pluginId)?.state;
  }
  listActivePluginIds() {
    return [...this.#records.keys()];
  }
  listDisabledPluginIds() {
    return [...this.#disabled];
  }
  listDiagnostics() {
    return [...this.#diagnostics];
  }
  async disable(pluginId) {
    this.#disabled.add(pluginId);
    await this.deactivate(pluginId);
  }
  /** Explicit user/host action; enabling does not implicitly execute plugin code. */
  enable(pluginId) {
    this.#disabled.delete(pluginId);
  }
  async activate(manifest, module) {
    const validation = validatePluginManifest(manifest);
    if (!validation.ok) {
      throw new Error(`Plugin manifest is invalid: ${validation.errors.join("; ")}`);
    }
    if (this.#records.has(manifest.id)) {
      throw new Error(`Plugin is already active: ${manifest.id}`);
    }
    const subscriptions = new ManagedSubscriptions();
    const services = await this.#host.createServices(manifest);
    const context = {
      ...services,
      pluginId: manifest.id,
      subscriptions
    };
    const record = {
      manifest,
      module,
      subscriptions,
      state: "activating"
    };
    this.#records.set(manifest.id, record);
    try {
      const activationDisposable = await module.activate(context);
      if (activationDisposable) {
        subscriptions.add(activationDisposable);
      }
      record.state = "active";
    } catch (activationError) {
      this.#records.delete(manifest.id);
      const errors = [activationError];
      try {
        await subscriptions.dispose();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      try {
        await this.#host.releaseServices?.(manifest.id);
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      throwCollectedErrors(errors, `Plugin activation and cleanup failed: ${manifest.id}`);
    }
  }
  async activateBundledCatalog(catalog) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < catalog.length; index += 1) {
      const entry = catalog[index];
      const pluginId = entry?.manifest?.id ?? `catalog-entry-${index}`;
      try {
        if (!entry) {
          throw new Error("Bundled catalog contains an empty entry");
        }
        const manifest = validateCatalogEntry(entry);
        if (seen.has(manifest.id)) {
          throw new Error(`Bundled catalog contains duplicate plugin ID: ${manifest.id}`);
        }
        seen.add(manifest.id);
        if (this.#disabled.has(manifest.id)) {
          results.push({
            pluginId: manifest.id,
            kind: "disabled",
            message: "Plugin remains disabled after an earlier failure"
          });
          continue;
        }
        if (this.#records.has(manifest.id)) {
          results.push({ pluginId: manifest.id, kind: "active" });
          continue;
        }
        let loaded;
        try {
          loaded = await entry.load();
        } catch (error) {
          throw this.#phaseError("load", error);
        }
        const module = validateLoadedModule(entry, loaded);
        try {
          await this.activate(manifest, module);
        } catch (error) {
          throw this.#phaseError("activate", error);
        }
        results.push({ pluginId: manifest.id, kind: "active" });
      } catch (error) {
        const phase = this.#errorPhase(error);
        const message = errorMessage2(error instanceof PluginPhaseError ? error.cause : error);
        this.#disabled.add(pluginId);
        this.#diagnostics.push({ pluginId, phase, message });
        if (this.#records.has(pluginId)) {
          try {
            await this.deactivate(pluginId);
          } catch (deactivationError) {
            this.#diagnostics.push({
              pluginId,
              phase: "deactivate",
              message: errorMessage2(deactivationError)
            });
          }
        }
        results.push({ pluginId, kind: "disabled", message });
      }
    }
    return results;
  }
  async reportFailure(pluginId, phase, error) {
    this.#disabled.add(pluginId);
    this.#diagnostics.push({ pluginId, phase, message: errorMessage2(error) });
    try {
      await this.deactivate(pluginId);
    } catch (deactivationError) {
      this.#diagnostics.push({
        pluginId,
        phase: "deactivate",
        message: errorMessage2(deactivationError)
      });
    }
  }
  async deactivate(pluginId) {
    const record = this.#records.get(pluginId);
    if (!record) {
      await this.#host.releaseServices?.(pluginId);
      return;
    }
    record.state = "deactivating";
    const errors = [];
    try {
      await record.module.deactivate?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      await record.subscriptions.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#host.releaseServices?.(pluginId);
    } catch (error) {
      errors.push(error);
    }
    this.#records.delete(pluginId);
    throwCollectedErrors(errors, `Plugin deactivation failed: ${pluginId}`);
  }
  async deactivateAll() {
    const errors = [];
    for (const pluginId of [...this.#records.keys()].reverse()) {
      try {
        await this.deactivate(pluginId);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCollectedErrors(errors, "One or more plugins failed to deactivate");
  }
  #phaseError(phase, error) {
    return new PluginPhaseError(phase, error);
  }
  #errorPhase(error) {
    return error instanceof PluginPhaseError ? error.phase : "catalog";
  }
};
var PluginPhaseError = class extends Error {
  constructor(phase, cause) {
    super(errorMessage2(cause));
    this.name = "PluginPhaseError";
    this.phase = phase;
    this.cause = cause;
  }
};

// apps/desktop/src/bundled-plugins.ts
var GENERATED_CATALOG_SPECIFIER = "./bundled-plugin-catalog.js";
async function loadDesktopBundledPluginCatalog() {
  const loaded = await import(GENERATED_CATALOG_SPECIFIER);
  if (!Array.isArray(loaded.bundledPluginCatalog)) {
    throw new Error("Bundled plugin catalog is malformed");
  }
  return loaded.bundledPluginCatalog;
}

// apps/desktop/src/codemirror-documents.ts
var CodeMirrorDocumentPool = class {
  #masters = /* @__PURE__ */ new WeakMap();
  #attachments = /* @__PURE__ */ new Map();
  attach(paneId, editor, session) {
    const current = this.#attachments.get(paneId);
    if (current?.session === session) {
      return;
    }
    this.#unlink(paneId);
    let master = this.#masters.get(session);
    if (!master) {
      master = editor.createDocument(session.state.buffer);
      this.#masters.set(session, master);
    }
    const masterAttachedElsewhere = [...this.#attachments.entries()].some(
      ([attachedPaneId, attachment]) => attachedPaneId !== paneId && attachment.session === session
    );
    const document2 = masterAttachedElsewhere ? master.linkedDoc({ sharedHist: true }) : master;
    editor.swapDocument(document2);
    this.#attachments.set(paneId, { session, document: document2, master });
  }
  detach(paneId, editor) {
    this.#unlink(paneId);
    editor.swapDocument(editor.createDocument(""));
  }
  release(session) {
    const stillAttached = [...this.#attachments.values()].some(
      (attachment) => attachment.session === session
    );
    if (!stillAttached) {
      this.#masters.delete(session);
    }
  }
  dispose() {
    for (const paneId of [...this.#attachments.keys()]) {
      this.#unlink(paneId);
    }
  }
  #unlink(paneId) {
    const attachment = this.#attachments.get(paneId);
    if (!attachment) {
      return;
    }
    if (attachment.document !== attachment.master) {
      attachment.master.unlinkDoc(attachment.document);
    }
    this.#attachments.delete(paneId);
  }
};

// apps/desktop/src/editor-enhancements.ts
var EDITOR_ENHANCEMENT_LIMITS = Object.freeze({
  maxDocumentCharacters: 2 * 1024 * 1024,
  maxLines: 2e4,
  maxPreviews: 32,
  maxPreviewCharacters: 64 * 1024,
  maxTotalPreviewCharacters: 256 * 1024,
  maxMediaFileBytes: 16 * 1024 * 1024,
  maxMediaPreviews: 32
});
var MEDIA_MIME_TYPES = /* @__PURE__ */ new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);
var CODE_MODE_ASSETS = Object.freeze({
  bash: "lib/codemirror-shell.js",
  go: "lib/codemirror-go.js",
  javascript: "lib/codemirror-javascript.js",
  js: "lib/codemirror-javascript.js",
  php: "lib/codemirror-php.js",
  py: "lib/codemirror-python.js",
  python: "lib/codemirror-python.js",
  sh: "lib/codemirror-shell.js",
  shell: "lib/codemirror-shell.js",
  typescript: "lib/codemirror-javascript.js",
  ts: "lib/codemirror-javascript.js"
});
var scriptLoads = /* @__PURE__ */ new WeakMap();
var initializedMermaidWindows = /* @__PURE__ */ new WeakSet();
var mermaidCounter = 0;
var mermaidQueue = Promise.resolve();
function normalizedLines(content) {
  return content.replace(/\r\n?/gu, "\n").split("\n");
}
function parseEditorPreviewBlocks(content) {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) {
    return [];
  }
  const lines = normalizedLines(content);
  if (EDITOR_ENHANCEMENT_LIMITS.maxLines < lines.length) {
    return [];
  }
  const result = [];
  let totalCharacters = 0;
  let fence = null;
  let displayMath = null;
  const append = (block) => {
    if (EDITOR_ENHANCEMENT_LIMITS.maxPreviews <= result.length || EDITOR_ENHANCEMENT_LIMITS.maxPreviewCharacters < block.source.length || EDITOR_ENHANCEMENT_LIMITS.maxTotalPreviewCharacters < totalCharacters + block.source.length) {
      return;
    }
    totalCharacters += block.source.length;
    result.push(block);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fence) {
      if (/^ {0,3}```\s*$/u.test(line)) {
        if ("mermaid" === fence.language) {
          append({ kind: "mermaid", line: index, source: fence.body.join("\n") });
        }
        fence = null;
      } else if (EDITOR_ENHANCEMENT_LIMITS.maxPreviewCharacters >= fence.body.join("\n").length) {
        fence.body.push(line);
      }
      continue;
    }
    const fenceStart = /^ {0,3}```\s*([A-Za-z0-9_-]+)?\s*$/u.exec(line);
    if (fenceStart) {
      fence = {
        line: index,
        language: (fenceStart[1] ?? "").toLocaleLowerCase("en-US"),
        body: []
      };
      continue;
    }
    if (displayMath) {
      if (/^\s*\$\$\s*$/u.test(line)) {
        append({ kind: "math", line: index, source: displayMath.body.join("\n") });
        displayMath = null;
      } else {
        displayMath.body.push(line);
      }
      continue;
    }
    if (/^\s*\$\$\s*$/u.test(line)) {
      displayMath = { line: index, body: [] };
      continue;
    }
    const singleDisplay = /^\s*\$\$([^$]+)\$\$\s*$/u.exec(line);
    if (singleDisplay) {
      append({ kind: "math", line: index, source: singleDisplay[1] ?? "" });
      continue;
    }
    const standaloneInline = /^\s*\$([^$\n]+)\$\s*$/u.exec(line);
    if (standaloneInline) {
      append({ kind: "math", line: index, source: standaloneInline[1] ?? "" });
    }
  }
  return result;
}
function fencedCodeLanguages(content) {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) {
    return /* @__PURE__ */ new Set();
  }
  const result = /* @__PURE__ */ new Set();
  for (const line of normalizedLines(content).slice(0, EDITOR_ENHANCEMENT_LIMITS.maxLines)) {
    const match = /^ {0,3}```\s*([A-Za-z0-9_-]+)\s*$/u.exec(line);
    if (match?.[1]) {
      result.add(match[1].toLocaleLowerCase("en-US"));
    }
    if (Object.keys(CODE_MODE_ASSETS).length <= result.size) {
      break;
    }
  }
  return result;
}
function wikiLinkAt(line, character) {
  if (1024 < line.length || character < 0 || line.length < character) {
    return null;
  }
  const matcher = /\[\[([^\]|\n]{1,512})(?:\|[^\]\n]{0,512})?\]\]/gu;
  let match;
  while (match = matcher.exec(line)) {
    if (match.index <= character && character <= match.index + match[0].length) {
      return (match[1] ?? "").trim() || null;
    }
  }
  return null;
}
function mediaKind(path) {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  if (["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"].includes(extension)) {
    return "image";
  }
  if (["mov", "mp4", "webm"].includes(extension)) {
    return "video";
  }
  if (["mp3", "oga", "ogg", "wav", "weba"].includes(extension)) {
    return "audio";
  }
  return null;
}
function safeMediaPath(value) {
  const path = value.trim().replace(/%20/gu, " ");
  if ("" === path || 1024 < path.length || !path.startsWith("media/") || path.startsWith("/") || path.includes("\\") || /[?#]/u.test(path)) {
    return null;
  }
  const segments = path.split("/");
  if (segments.some((segment) => "" === segment || "." === segment || ".." === segment)) {
    return null;
  }
  return mediaKind(path) ? path : null;
}
function parseEditorMediaPreviews(content) {
  if (EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters < content.length) {
    return [];
  }
  const lines = normalizedLines(content);
  if (EDITOR_ENHANCEMENT_LIMITS.maxLines < lines.length) {
    return [];
  }
  const previews = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^ {0,3}```/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const markdown = /!\[([^\]\n]{0,512})\]\(([^)\n]{1,1024})\)/u.exec(line);
    const wiki = /!\[\[([^\]|\n]{1,1024})(?:\|([^\]\n]{0,512}))?\]\]/u.exec(line);
    const rawPath = markdown?.[2] ?? wiki?.[1];
    if (!rawPath) {
      continue;
    }
    const path = safeMediaPath(rawPath);
    const kind = path ? mediaKind(path) : null;
    if (!path || !kind) {
      continue;
    }
    previews.push({
      alt: (markdown?.[1] ?? wiki?.[2] ?? "").trim(),
      kind,
      line: index,
      path
    });
    if (EDITOR_ENHANCEMENT_LIMITS.maxMediaPreviews <= previews.length) {
      break;
    }
  }
  return previews;
}
function isSafeSvgReference(value) {
  const normalized = value.trim();
  return "" === normalized || /^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(normalized);
}
function sanitizeSvgStyle(value) {
  if (4096 < value.length || /(?:javascript\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding)/iu.test(value) || /url\s*\((?!\s*['"]?#[A-Za-z_][A-Za-z0-9_.:-]*['"]?\s*\))/iu.test(value)) {
    return null;
  }
  return value;
}
function sanitizeMermaidSvg(document2, markup) {
  if (1024 * 1024 < markup.length) {
    throw new Error("Mermaid SVG exceeds the output limit");
  }
  const Parser = document2.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if ("svg" !== root.localName || parsed.querySelector("parsererror")) {
    throw new Error("Mermaid returned invalid SVG");
  }
  const forbidden = /* @__PURE__ */ new Set([
    "audio",
    "canvas",
    "embed",
    "foreignobject",
    "iframe",
    "object",
    "script",
    "video"
  ]);
  for (const element4 of [root, ...parsed.querySelectorAll("*")]) {
    const localName = element4.localName.toLocaleLowerCase("en-US");
    if (forbidden.has(localName)) {
      element4.remove();
      continue;
    }
    if ("style" === localName) {
      const safe = sanitizeSvgStyle(element4.textContent ?? "");
      if (null === safe) {
        element4.remove();
      } else {
        element4.textContent = safe;
      }
      continue;
    }
    for (const attribute of [...element4.attributes]) {
      const name = attribute.name.toLocaleLowerCase("en-US");
      if (name.startsWith("on")) {
        element4.removeAttribute(attribute.name);
      } else if ("href" === name || "xlink:href" === name || "src" === name) {
        if (!isSafeSvgReference(attribute.value)) {
          element4.removeAttribute(attribute.name);
        }
      } else if ("style" === name) {
        const safe = sanitizeSvgStyle(attribute.value);
        if (null === safe) {
          element4.removeAttribute(attribute.name);
        }
      }
    }
  }
  return document2.importNode(root, true);
}
function loadScript(document2, window2, path, ready) {
  if (ready?.()) {
    return Promise.resolve();
  }
  let loads = scriptLoads.get(document2);
  if (!loads) {
    loads = /* @__PURE__ */ new Map();
    scriptLoads.set(document2, loads);
  }
  const existing = loads.get(path);
  if (existing) {
    return existing;
  }
  const promise = new Promise((resolve, reject) => {
    const script = document2.createElement("script");
    const stamp = window2.COMMIT_HASH ?? "";
    script.src = `${path}${stamp}`;
    script.async = true;
    script.addEventListener("load", () => {
      if (!ready || ready()) {
        resolve();
      } else {
        reject(new Error(`${path} did not register`));
      }
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`${path} failed to load`)), {
      once: true
    });
    document2.head.append(script);
  }).catch((error) => {
    loads?.delete(path);
    throw error;
  });
  loads.set(path, promise);
  return promise;
}
function messageFrom(error) {
  return error instanceof Error ? error.message : String(error);
}
var DesktopEditorEnhancements = class {
  #editor;
  #document;
  #window;
  #onOpenWikiLink;
  #onInsertMedia;
  #resolveMedia;
  #onDiagnostic;
  #widgets = [];
  #mediaLeases = [];
  #onClick = (event) => {
    if (!this.#features.has("wiki-links") || 0 !== event.button) {
      return;
    }
    const position = this.#editor.coordsChar({ left: event.clientX, top: event.clientY });
    const target = wikiLinkAt(this.#editor.getLine(position.line), position.ch);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#onOpenWikiLink?.(target);
  };
  #onPaste = (event) => {
    if (!this.#features.has("media")) {
      return;
    }
    const file = this.#firstSupportedMedia(event.clipboardData?.files);
    if (!file) {
      return;
    }
    event.preventDefault();
    const anchor = this.#editor.indexFromPos(this.#editor.getCursor("anchor"));
    const head = this.#editor.indexFromPos(this.#editor.getCursor("head"));
    void this.#submitMedia({
      file,
      selectionAnchor: anchor,
      selectionHead: head,
      source: "paste"
    });
  };
  #onDragOver = (event) => {
    if (!this.#features.has("media") || !this.#firstSupportedMedia(event.dataTransfer?.files)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };
  #onDrop = (event) => {
    if (!this.#features.has("media")) {
      return;
    }
    const file = this.#firstSupportedMedia(event.dataTransfer?.files);
    if (!file) {
      return;
    }
    event.preventDefault();
    const position = this.#editor.coordsChar({ left: event.clientX, top: event.clientY });
    const offset = this.#editor.indexFromPos(position);
    void this.#submitMedia({
      file,
      selectionAnchor: offset,
      selectionHead: offset,
      source: "drop"
    });
  };
  #features = /* @__PURE__ */ new Set();
  #generation = 0;
  #timer = null;
  #lightbox = null;
  #lightboxCleanup = null;
  #lightboxReturnFocus = null;
  #disposed = false;
  constructor(editor, options) {
    this.#editor = editor;
    this.#document = options.document;
    this.#window = options.window;
    this.#onOpenWikiLink = options.onOpenWikiLink;
    this.#onInsertMedia = options.onInsertMedia;
    this.#resolveMedia = options.resolveMedia;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {
    });
    const wrapper = this.#editor.getWrapperElement();
    wrapper.addEventListener("click", this.#onClick, true);
    wrapper.addEventListener("paste", this.#onPaste, true);
    wrapper.addEventListener("dragover", this.#onDragOver, true);
    wrapper.addEventListener("drop", this.#onDrop, true);
  }
  setFeatures(features) {
    this.#features = new Set(features);
    this.schedule();
  }
  schedule() {
    if (this.#disposed) {
      return;
    }
    if (null !== this.#timer) {
      this.#window.clearTimeout(this.#timer);
    }
    this.#timer = this.#window.setTimeout(() => {
      this.#timer = null;
      void this.#render();
    }, 80);
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    if (null !== this.#timer) {
      this.#window.clearTimeout(this.#timer);
    }
    this.#timer = null;
    this.#clearWidgets();
    this.#closeLightbox();
    const wrapper = this.#editor.getWrapperElement();
    wrapper.removeEventListener("click", this.#onClick, true);
    wrapper.removeEventListener("paste", this.#onPaste, true);
    wrapper.removeEventListener("dragover", this.#onDragOver, true);
    wrapper.removeEventListener("drop", this.#onDrop, true);
  }
  #firstSupportedMedia(files) {
    if (!files) {
      return null;
    }
    for (const file of files) {
      if (MEDIA_MIME_TYPES.has(file.type.toLocaleLowerCase("en-US")) && 0 < file.size && file.size <= EDITOR_ENHANCEMENT_LIMITS.maxMediaFileBytes) {
        return file;
      }
    }
    return null;
  }
  async #submitMedia(input) {
    if (!this.#onInsertMedia) {
      this.#onDiagnostic("Media insertion is unavailable");
      return;
    }
    try {
      await this.#onInsertMedia(input);
    } catch (error) {
      this.#onDiagnostic(`Media insertion failed: ${messageFrom(error)}`);
    }
  }
  async #render() {
    const generation = ++this.#generation;
    this.#clearWidgets();
    const content = this.#editor.getValue();
    if (this.#features.has("code-languages")) {
      void this.#loadCodeModes(content, generation);
    }
    const blocks = parseEditorPreviewBlocks(content).filter((block) => "math" === block.kind ? this.#features.has("math") : this.#features.has("mermaid"));
    for (const block of blocks) {
      if (generation !== this.#generation || this.#disposed) {
        return;
      }
      const host = this.#document.createElement("div");
      host.className = `v2-editor-render-widget v2-editor-render-${block.kind}`;
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", `${"math" === block.kind ? "Math" : "Mermaid"} preview`);
      host.textContent = `Loading ${block.kind} preview\u2026`;
      this.#widgets.push(this.#editor.addLineWidget(block.line, host, {
        above: false,
        coverGutter: false,
        noHScroll: true
      }));
      void ("math" === block.kind ? this.#renderMath(host, block.source, generation) : this.#renderMermaid(host, block.source, generation));
    }
    if (this.#features.has("media")) {
      for (const media of parseEditorMediaPreviews(content)) {
        if (generation !== this.#generation || this.#disposed) {
          return;
        }
        const host = this.#document.createElement("div");
        host.className = "v2-editor-render-widget v2-editor-render-media";
        host.setAttribute("aria-label", `${media.kind} preview`);
        host.textContent = `Loading ${media.kind} preview\u2026`;
        this.#widgets.push(this.#editor.addLineWidget(media.line, host, {
          above: false,
          coverGutter: false,
          noHScroll: true
        }));
        void this.#renderMedia(host, media, generation);
      }
    }
  }
  async #loadCodeModes(content, generation) {
    const assets = /* @__PURE__ */ new Set();
    for (const language of fencedCodeLanguages(content)) {
      const asset = CODE_MODE_ASSETS[language];
      if (asset) {
        assets.add(asset);
      }
    }
    if (0 === assets.size) {
      return;
    }
    try {
      await Promise.all([...assets].map((asset) => loadScript(
        this.#document,
        this.#window,
        asset
      )));
      if (generation === this.#generation && !this.#disposed) {
        this.#editor.setOption("mode", {
          name: "markdown",
          emoji: this.#features.has("emoji"),
          fencedCodeBlockHighlighting: true,
          strikethrough: true,
          taskLists: true
        });
        this.#editor.refresh();
      }
    } catch (error) {
      this.#onDiagnostic(`Code language support unavailable: ${messageFrom(error)}`);
    }
  }
  async #renderMath(host, expression, generation) {
    try {
      await loadScript(this.#document, this.#window, "lib/latex/katex.min.js", () => "function" === typeof this.#window.katex?.render);
      if (generation !== this.#generation || this.#disposed || !host.isConnected) {
        return;
      }
      const katex = this.#window.katex;
      if (!katex) {
        throw new Error("KaTeX is unavailable");
      }
      host.replaceChildren();
      katex.render(expression, host, {
        displayMode: true,
        maxExpand: 1e3,
        maxSize: 20,
        strict: "warn",
        throwOnError: false,
        trust: false
      });
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) {
        return;
      }
      host.textContent = "Math preview unavailable; source remains editable.";
      this.#onDiagnostic(`KaTeX render unavailable: ${messageFrom(error)}`);
    }
  }
  async #renderMermaid(host, source, generation) {
    const task = async () => {
      try {
        await loadScript(this.#document, this.#window, "lib/mermaid.min.js", () => "function" === typeof this.#window.mermaid?.render);
        if (generation !== this.#generation || this.#disposed || !host.isConnected) {
          return;
        }
        const mermaid = this.#window.mermaid;
        if (!mermaid) {
          throw new Error("Mermaid is unavailable");
        }
        if (!initializedMermaidWindows.has(this.#window)) {
          mermaid.initialize?.({
            flowchart: { htmlLabels: false },
            securityLevel: "strict",
            startOnLoad: false,
            suppressErrorRendering: true
          });
          initializedMermaidWindows.add(this.#window);
        }
        const output = await mermaid.render(`mdular-mermaid-${++mermaidCounter}`, source);
        if (generation !== this.#generation || this.#disposed || !host.isConnected) {
          return;
        }
        const markup = "string" === typeof output ? output : output?.svg;
        if ("string" !== typeof markup) {
          throw new Error("Mermaid returned no SVG");
        }
        host.replaceChildren(sanitizeMermaidSvg(this.#document, markup));
      } catch (error) {
        if (generation !== this.#generation || this.#disposed) {
          return;
        }
        host.textContent = "Mermaid preview unavailable; source remains editable.";
        this.#onDiagnostic(`Mermaid render unavailable: ${messageFrom(error)}`);
      }
    };
    mermaidQueue = mermaidQueue.then(task, task);
    await mermaidQueue;
  }
  async #renderMedia(host, preview, generation) {
    if (!this.#resolveMedia) {
      host.textContent = "Media preview unavailable.";
      return;
    }
    try {
      const lease = await this.#resolveMedia(preview.path);
      if (generation !== this.#generation || this.#disposed || !host.isConnected) {
        lease.release();
        return;
      }
      this.#mediaLeases.push(lease);
      host.replaceChildren();
      if ("image" === preview.kind) {
        const trigger = this.#document.createElement("button");
        trigger.type = "button";
        trigger.className = "v2-editor-media-trigger";
        trigger.setAttribute("aria-label", `Open image preview${preview.alt ? `: ${preview.alt}` : ""}`);
        const image = this.#document.createElement("img");
        image.src = lease.url;
        image.alt = preview.alt;
        image.loading = "lazy";
        image.decoding = "async";
        trigger.append(image);
        trigger.addEventListener("click", () => {
          this.#openLightbox(lease.url, preview.alt, trigger);
        });
        host.append(trigger);
      } else if ("video" === preview.kind) {
        const video = this.#document.createElement("video");
        video.src = lease.url;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", preview.alt || "Video preview");
        host.append(video);
      } else {
        const audio = this.#document.createElement("audio");
        audio.src = lease.url;
        audio.controls = true;
        audio.preload = "metadata";
        audio.setAttribute("aria-label", preview.alt || "Audio preview");
        host.append(audio);
      }
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) {
        return;
      }
      host.textContent = "Media unavailable; Markdown source remains editable.";
      this.#onDiagnostic(`Media preview unavailable: ${messageFrom(error)}`);
    }
  }
  #openLightbox(url, alt, returnFocus) {
    this.#closeLightbox();
    const modal = this.#document.createElement("div");
    modal.className = "v2-editor-media-lightbox";
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", alt ? `Image preview: ${alt}` : "Image preview");
    const close = this.#document.createElement("button");
    close.type = "button";
    close.className = "v2-editor-media-lightbox-close";
    close.textContent = "Close";
    const image = this.#document.createElement("img");
    image.className = "v2-editor-media-lightbox-image";
    image.src = url;
    image.alt = alt;
    modal.append(close, image);
    this.#document.body.append(modal);
    this.#lightbox = modal;
    this.#lightboxReturnFocus = returnFocus;
    const onKeyDown = (event) => {
      if ("Escape" === event.key) {
        event.preventDefault();
        event.stopPropagation();
        this.#closeLightbox();
      } else if ("Tab" === event.key) {
        event.preventDefault();
        close.focus({ preventScroll: true });
      }
    };
    const cleanup = () => {
      this.#document.removeEventListener("keydown", onKeyDown, true);
      modal.remove();
      this.#lightbox = null;
      this.#lightboxCleanup = null;
      const focus = this.#lightboxReturnFocus;
      this.#lightboxReturnFocus = null;
      focus?.focus({ preventScroll: true });
    };
    this.#lightboxCleanup = cleanup;
    close.addEventListener("click", () => this.#closeLightbox());
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        this.#closeLightbox();
      }
    });
    this.#document.addEventListener("keydown", onKeyDown, true);
    close.focus({ preventScroll: true });
  }
  #closeLightbox() {
    this.#lightboxCleanup?.();
  }
  #clearWidgets() {
    this.#closeLightbox();
    for (const lease of this.#mediaLeases.splice(0)) {
      lease.release();
    }
    for (const widget of this.#widgets.splice(0)) {
      widget.clear();
    }
  }
};

// apps/desktop/src/codemirror-editor.ts
function codeMirrorStatic() {
  const candidate = window.CodeMirror;
  if (!candidate || "object" !== typeof candidate && "function" !== typeof candidate) {
    throw new Error("CodeMirror 5 is unavailable in the V2 runtime");
  }
  const fromTextArea = candidate.fromTextArea;
  if ("function" !== typeof fromTextArea) {
    throw new Error("CodeMirror 5 fromTextArea is unavailable in the V2 runtime");
  }
  return candidate;
}
var CodeMirrorTextEditor = class {
  #editor;
  #listeners = /* @__PURE__ */ new Set();
  #handleChange = () => {
    for (const listener of this.#listeners) {
      listener();
    }
    this.#enhancements?.schedule();
  };
  #tableKeyMap = {
    "Cmd-Shift-T": (editor) => this.#insertTable(editor),
    "Ctrl-Shift-T": (editor) => this.#insertTable(editor)
  };
  #disposed = false;
  #enhancements = null;
  #pluginFeatures = /* @__PURE__ */ new Set();
  constructor(textarea, options = {}) {
    this.#editor = codeMirrorStatic().fromTextArea(textarea, {
      lineNumbers: false,
      lineWrapping: true,
      mode: "markdown",
      viewportMargin: 20
    });
    this.#editor.setSize("100%", "100%");
    this.#editor.on("change", this.#handleChange);
    const document2 = textarea.ownerDocument;
    const window2 = document2?.defaultView;
    if (document2 && window2) {
      this.#enhancements = new DesktopEditorEnhancements(this.#editor, {
        document: document2,
        window: window2,
        ...options.onOpenWikiLink ? { onOpenWikiLink: options.onOpenWikiLink } : {},
        ...options.onInsertMedia ? { onInsertMedia: options.onInsertMedia } : {},
        ...options.resolveMedia ? { resolveMedia: options.resolveMedia } : {},
        ...options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}
      });
    }
  }
  getValue() {
    return this.#editor.getValue();
  }
  setValue(content) {
    this.#editor.setValue(content);
  }
  setReadOnly(readOnly) {
    this.#editor.setOption("readOnly", readOnly);
  }
  subscribe(listener) {
    if (this.#disposed) {
      throw new Error("Cannot subscribe to a disposed editor");
    }
    this.#listeners.add(listener);
    return { dispose: () => {
      this.#listeners.delete(listener);
    } };
  }
  bindSave(handler) {
    const map = {
      "Cmd-S": () => handler(),
      "Ctrl-S": () => handler()
    };
    this.#editor.addKeyMap(map);
    return { dispose: () => this.#editor.removeKeyMap(map) };
  }
  setPluginFeatures(features) {
    if (this.#disposed) {
      return;
    }
    const hadTables = this.#pluginFeatures.has("tables");
    const next = new Set(features);
    this.#pluginFeatures = next;
    this.#editor.setOption("mode", 0 === next.size ? "markdown" : {
      name: "markdown",
      emoji: next.has("emoji"),
      fencedCodeBlockHighlighting: next.has("code-languages"),
      strikethrough: true,
      taskLists: true
    });
    this.#enhancements?.setFeatures(next);
    if (hadTables && !next.has("tables")) {
      this.#editor.removeKeyMap(this.#tableKeyMap);
    } else if (!hadTables && next.has("tables")) {
      this.#editor.addKeyMap(this.#tableKeyMap);
    }
    this.#editor.refresh();
  }
  createDocument(content) {
    return new (codeMirrorStatic()).Doc(content, "markdown");
  }
  getDocument() {
    return this.#editor.getDoc();
  }
  swapDocument(document2) {
    const previous = this.#editor.swapDoc(document2);
    this.#enhancements?.schedule();
    return previous;
  }
  captureView() {
    const scroll = this.#editor.getScrollInfo();
    return {
      selectionAnchor: this.#editor.indexFromPos(this.#editor.getCursor("anchor")),
      selectionHead: this.#editor.indexFromPos(this.#editor.getCursor("head")),
      scrollLeft: Math.max(0, scroll.left),
      scrollTop: Math.max(0, scroll.top),
      focused: this.#editor.hasFocus()
    };
  }
  restoreView(view) {
    const valueLength = this.#editor.getValue().length;
    const anchor = Math.min(view.selectionAnchor, valueLength);
    const head = Math.min(view.selectionHead, valueLength);
    this.#editor.setSelection(
      this.#editor.posFromIndex(anchor),
      this.#editor.posFromIndex(head)
    );
    this.#editor.scrollTo(view.scrollLeft, view.scrollTop);
    if (view.focused) {
      this.#editor.focus();
    }
    this.#editor.refresh();
  }
  focus() {
    this.#editor.focus();
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#listeners.clear();
    this.#enhancements?.dispose();
    this.#enhancements = null;
    if (this.#pluginFeatures.has("tables")) {
      this.#editor.removeKeyMap(this.#tableKeyMap);
    }
    this.#pluginFeatures = /* @__PURE__ */ new Set();
    this.#editor.off("change", this.#handleChange);
  }
  #insertTable(editor) {
    const cursor = editor.getCursor("head");
    editor.replaceRange([
      "| Column | Column |",
      "| ------ | ------ |",
      "|        |        |",
      ""
    ].join("\n"), cursor);
    editor.setCursor({ line: cursor.line + 2, ch: 2 });
    editor.focus();
  }
};

// apps/desktop/src/diff-runner.ts
function decodeResponse(value) {
  if (!value || "object" !== typeof value) {
    return null;
  }
  const response = value;
  if (!Number.isSafeInteger(response.requestId) || !Number.isSafeInteger(response.bufferVersion) || !response.result || "object" !== typeof response.result) {
    return null;
  }
  const kind = response.result.kind;
  if ("identical" !== kind && "hunks" !== kind && "changed-block" !== kind) {
    return null;
  }
  return response;
}
var LineDiffTaskRunner = class {
  #factory;
  #nextRequestId = 1;
  #active = null;
  #disposed = false;
  constructor(factory) {
    this.#factory = factory;
  }
  request(savedContent, buffer, bufferVersion, complete) {
    if (this.#disposed) {
      throw new Error("Cannot request diff from a disposed runner");
    }
    this.#cancelActive();
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    let worker;
    try {
      worker = this.#factory();
    } catch {
      complete({
        bufferVersion,
        result: createWorkerUnavailableDiff(savedContent, buffer)
      });
      return { dispose() {
      } };
    }
    this.#active = { requestId, worker };
    worker.onmessage = (event) => {
      const response = decodeResponse(event.data);
      if (!response || this.#active?.worker !== worker || response.requestId !== requestId || response.bufferVersion !== bufferVersion) {
        return;
      }
      this.#active = null;
      worker.terminate();
      complete({ bufferVersion, result: response.result });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (this.#active?.worker !== worker) {
        return;
      }
      this.#active = null;
      worker.terminate();
      complete({
        bufferVersion,
        result: createWorkerUnavailableDiff(savedContent, buffer)
      });
    };
    worker.postMessage({
      requestId,
      bufferVersion,
      savedContent,
      buffer
    });
    return {
      dispose: () => {
        if (this.#active?.worker === worker) {
          this.#cancelActive();
        }
      }
    };
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cancelActive();
  }
  #cancelActive() {
    const active = this.#active;
    this.#active = null;
    if (!active) {
      return;
    }
    active.worker.onmessage = null;
    active.worker.onerror = null;
    active.worker.terminate();
  }
};
function createDesktopLineDiffRunner(hostWindow) {
  return new LineDiffTaskRunner(() => {
    const WorkerConstructor = hostWindow.Worker;
    if ("function" !== typeof WorkerConstructor) {
      throw new Error("Module workers are unavailable");
    }
    const workerUrl = new URL("v2/diff-worker.js", hostWindow.location.href);
    return new WorkerConstructor(
      workerUrl,
      { type: "module", name: "mdular-line-diff" }
    );
  });
}

// apps/desktop/src/diff-view.ts
function element(document2, tagName, className, text) {
  const result = document2.createElement(tagName);
  result.className = className;
  if (void 0 !== text) {
    result.textContent = text;
  }
  return result;
}
function linePrefix(line) {
  if ("add" === line.kind) {
    return "+";
  }
  if ("delete" === line.kind) {
    return "-";
  }
  return " ";
}
var DesktopDiffView = class {
  #document;
  #host;
  #runner;
  #request = null;
  #session = null;
  #open = false;
  #disposed = false;
  constructor(document2, host, runner) {
    this.#document = document2;
    this.#host = host;
    this.#runner = runner;
    this.#host.hidden = true;
    this.#host.dataset.state = "closed";
  }
  get isOpen() {
    return this.#open;
  }
  get session() {
    return this.#session;
  }
  open(session) {
    if (this.#disposed) {
      throw new Error("Cannot open a disposed diff view");
    }
    this.#open = true;
    this.#session = session;
    this.#host.hidden = false;
    this.refresh(session);
  }
  refresh(session) {
    if (!this.#open || this.#session !== session) {
      return;
    }
    this.#request?.dispose();
    const state = session.state;
    const bufferVersion = state.bufferVersion;
    this.#renderPending();
    this.#request = this.#runner.request(
      state.savedSnapshot.content,
      state.buffer,
      bufferVersion,
      (completion) => {
        if (!this.#open || this.#session !== session || completion.bufferVersion !== session.state.bufferVersion) {
          return;
        }
        this.#request = null;
        this.#renderResult(completion.result);
      }
    );
  }
  close() {
    this.#request?.dispose();
    this.#request = null;
    this.#session = null;
    this.#open = false;
    this.#host.hidden = true;
    this.#host.dataset.state = "closed";
    this.#host.replaceChildren();
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.close();
    this.#runner.dispose();
  }
  #renderPending() {
    this.#host.dataset.state = "pending";
    this.#host.replaceChildren(
      element(this.#document, "p", "v2-diff-message", "Computing saved snapshot \u2194 buffer diff\u2026")
    );
  }
  #renderResult(result) {
    if ("identical" === result.kind) {
      this.#host.dataset.state = "identical";
      this.#host.replaceChildren(
        element(this.#document, "p", "v2-diff-message", "Buffer matches the saved snapshot.")
      );
      return;
    }
    if ("changed-block" === result.kind) {
      this.#host.dataset.state = "changed-block";
      const block = element(this.#document, "div", "v2-diff-block");
      block.append(
        element(
          this.#document,
          "div",
          "v2-diff-hunk-header",
          `@@ -${result.oldStart},${result.oldLines} +${result.newStart},${result.newLines} @@`
        ),
        element(
          this.#document,
          "p",
          "v2-diff-message",
          `Bounded changed block (${result.reason}); detailed line diff was not computed.`
        )
      );
      this.#host.replaceChildren(block);
      return;
    }
    this.#host.dataset.state = "hunks";
    const blocks = [];
    for (const hunk of result.hunks) {
      const block = element(this.#document, "div", "v2-diff-block");
      block.append(element(
        this.#document,
        "div",
        "v2-diff-hunk-header",
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      ));
      for (const line of hunk.lines) {
        const lineElement = element(
          this.#document,
          "div",
          `v2-diff-line v2-diff-${line.kind}`
        );
        lineElement.textContent = `${linePrefix(line)}${line.text}`;
        block.append(lineElement);
      }
      blocks.push(block);
    }
    this.#host.replaceChildren(...blocks);
  }
};

// apps/desktop/src/layout-preferences.ts
var DESKTOP_LAYOUT_PREFERENCE_KEY = "mdular:v2:desktop-layout:v1";
function decodePreference(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (null === parsed || "object" !== typeof parsed || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed;
  if (1 !== record.schemaVersion || "boolean" !== typeof record.secondaryVisible || "primary" !== record.activePane && "secondary" !== record.activePane || !record.secondaryVisible && "secondary" === record.activePane) {
    return null;
  }
  return {
    secondaryVisible: record.secondaryVisible,
    activePane: record.secondaryVisible ? record.activePane : "primary"
  };
}
var LocalDesktopLayoutPreferenceStore = class {
  #storage;
  constructor(storage) {
    this.#storage = storage;
  }
  load() {
    try {
      const value = this.#storage?.getItem(DESKTOP_LAYOUT_PREFERENCE_KEY);
      return value ? decodePreference(value) : null;
    } catch {
      return null;
    }
  }
  save(preference) {
    const stored = {
      schemaVersion: 1,
      secondaryVisible: preference.secondaryVisible,
      activePane: preference.secondaryVisible ? preference.activePane : "primary"
    };
    try {
      this.#storage?.setItem(DESKTOP_LAYOUT_PREFERENCE_KEY, JSON.stringify(stored));
    } catch {
    }
  }
};
function createDesktopLayoutPreferenceStore(hostWindow) {
  try {
    return new LocalDesktopLayoutPreferenceStore(hostWindow.localStorage);
  } catch {
    return new LocalDesktopLayoutPreferenceStore(null);
  }
}

// apps/desktop/src/media-insert.ts
var MEDIA_INSERT_LIMITS = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxFilenameCharacters: 96,
  maxCollisionAttempts: 16
});
var MIME_EXTENSIONS = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "audio/x-wav": "wav",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
});
function isRecord4(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function mediaExtensionForMime(mimeType) {
  const normalized = mimeType.trim().toLocaleLowerCase("en-US");
  const extension = MIME_EXTENSIONS[normalized];
  if (!extension) {
    throw new Error("Media type is unsupported");
  }
  return extension;
}
function filenameStem(filename) {
  const normalized = filename.normalize("NFC").split(/[\\/]/u).at(-1) ?? "";
  const withoutExtension = normalized.replace(/\.[^.]*$/u, "");
  let stem = withoutExtension.replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]+/gu, "-").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/[-_.]{2,}/gu, "-").replace(/^[.\s-]+|[.\s-]+$/gu, "").slice(0, 48);
  if (!stem) {
    stem = "asset";
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem)) {
    stem = `asset-${stem}`;
  }
  return stem;
}
function timestamp(date) {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Media timestamp is invalid");
  }
  return date.toISOString().replace(/[-:]/gu, "").replace("T", "-").replace("Z", "").replace(".", "-");
}
function createMediaAssetPath(originalName, mimeType, date, collisionAttempt = 0) {
  if (!Number.isSafeInteger(collisionAttempt) || 0 > collisionAttempt || MEDIA_INSERT_LIMITS.maxCollisionAttempts <= collisionAttempt) {
    throw new Error("Media collision attempt is outside the allowed range");
  }
  const extension = mediaExtensionForMime(mimeType);
  const suffix = 0 === collisionAttempt ? "" : `-${collisionAttempt + 1}`;
  const filename = `${timestamp(date)}-${filenameStem(originalName)}${suffix}.${extension}`;
  if (MEDIA_INSERT_LIMITS.maxFilenameCharacters < filename.length) {
    throw new Error("Generated media filename exceeds the limit");
  }
  return `media/${filename}`;
}
function markdownMediaLink(path, originalName) {
  if (!/^media\/[^/\\?#]+$/u.test(path) || path.includes("..")) {
    throw new Error("Media path is invalid");
  }
  const alt = filenameStem(originalName).replace(/\\/gu, "\\\\").replace(/\]/gu, "\\]");
  return `![${alt}](${path})`;
}
function applyMediaMarkdownEdit(content, selectionAnchor, selectionHead, markdown) {
  if (!Number.isSafeInteger(selectionAnchor) || !Number.isSafeInteger(selectionHead) || 0 > selectionAnchor || 0 > selectionHead || content.length < selectionAnchor || content.length < selectionHead || "" === markdown) {
    throw new Error("Media insertion selection is invalid");
  }
  const start = Math.min(selectionAnchor, selectionHead);
  const end = Math.max(selectionAnchor, selectionHead);
  return {
    content: `${content.slice(0, start)}${markdown}${content.slice(end)}`,
    cursor: start + markdown.length,
    markdown
  };
}
function encodeMediaBase64(bytes) {
  if (0 === bytes.byteLength || MEDIA_INSERT_LIMITS.maxFileBytes < bytes.byteLength) {
    throw new Error("Media file is empty or exceeds the file limit");
  }
  const encoder = globalThis.btoa;
  if ("function" !== typeof encoder) {
    throw new Error("Base64 encoding is unavailable");
  }
  const chunks = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    let binary = "";
    for (const byte of bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize))) {
      binary += String.fromCharCode(byte);
    }
    chunks.push(binary);
  }
  return encoder(chunks.join(""));
}
function decodeMediaWriteResult(value) {
  if (!isRecord4(value) || "written" !== value.status && "failed" !== value.status) {
    throw new Error("Media write response is malformed");
  }
  if ("failed" === value.status) {
    if ("string" !== typeof value.kind || "string" !== typeof value.message) {
      throw new Error("Media write failure is malformed");
    }
    return { status: "failed", kind: value.kind, message: value.message };
  }
  const receipt = value.receipt;
  if (!isRecord4(receipt) || "string" !== typeof receipt.path || !/^media\/[^/\\?#]+$/u.test(receipt.path) || "string" !== typeof receipt.revision || !/^sha256:[a-f0-9]{64}$/u.test(receipt.revision) || !Number.isSafeInteger(receipt.bytes) || 0 >= Number(receipt.bytes) || MEDIA_INSERT_LIMITS.maxFileBytes < Number(receipt.bytes)) {
    throw new Error("Media write receipt is malformed");
  }
  return {
    status: "written",
    receipt: {
      path: receipt.path,
      revision: receipt.revision,
      bytes: Number(receipt.bytes)
    }
  };
}
function decodeMediaRollbackResult(value) {
  if (!isRecord4(value) || !["removed", "missing", "retained"].includes(String(value.status)) || "string" !== typeof value.path) {
    throw new Error("Media rollback response is malformed");
  }
  if ("retained" === value.status) {
    if ("string" !== typeof value.kind || "string" !== typeof value.message) {
      throw new Error("Media rollback retention is malformed");
    }
    return {
      status: "retained",
      path: value.path,
      kind: value.kind,
      message: value.message
    };
  }
  return { status: value.status, path: value.path };
}

// apps/desktop/src/plugin-commands.ts
var MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
function canonicalKeybinding(value) {
  const parts = value.split("+");
  const key = parts.pop() ?? "";
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier));
  return [...modifiers, key].join("+");
}
function eventKeybindings(event) {
  const explicitModifiers = [];
  if (event.ctrlKey) {
    explicitModifiers.push("Ctrl");
  }
  if (event.metaKey) {
    explicitModifiers.push("Meta");
  }
  if (event.altKey) {
    explicitModifiers.push("Alt");
  }
  if (event.shiftKey) {
    explicitModifiers.push("Shift");
  }
  const key = 1 === event.key.length ? event.key.toLocaleUpperCase("en-US") : event.key;
  if (0 === explicitModifiers.length || !/^(?:[A-Z0-9]|Enter|Escape)$/u.test(key)) {
    return [];
  }
  const values = [canonicalKeybinding([...explicitModifiers, key].join("+"))];
  if (event.metaKey || event.ctrlKey) {
    values.push(canonicalKeybinding([
      "Mod",
      ...event.altKey ? ["Alt"] : [],
      ...event.shiftKey ? ["Shift"] : [],
      key
    ].join("+")));
  }
  return [...new Set(values)];
}
var DesktopPluginCommandHost = class {
  #document;
  #window;
  #container;
  #onFailure;
  #commands = /* @__PURE__ */ new Map();
  #keybindings = /* @__PURE__ */ new Map();
  #onKeyDown = (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const commandId = eventKeybindings(event).map((keybinding) => this.#keybindings.get(keybinding)).find((candidate) => void 0 !== candidate);
    if (!commandId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.execute(commandId).catch(() => {
    });
  };
  #disposed = false;
  constructor(options) {
    this.#document = options.document;
    this.#window = options.window;
    this.#container = options.container;
    this.#onFailure = options.onFailure;
    this.#window.addEventListener("keydown", this.#onKeyDown, true);
  }
  createService(manifest) {
    const contributions = new Map(
      (manifest.contributes?.commands ?? []).map((command) => [command.id, command])
    );
    return {
      register: (commandId, handler) => {
        if (this.#disposed) {
          throw new Error("Plugin command host is disposed");
        }
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
        const button = this.#document.createElement("button");
        button.type = "button";
        button.className = "v2-plugin-command";
        button.dataset.commandId = commandId;
        button.textContent = contribution.title;
        button.addEventListener("click", () => {
          void this.execute(commandId).catch(() => {
          });
        });
        const record = {
          pluginId: manifest.id,
          handler,
          button,
          keybindings: [...keybindings]
        };
        this.#commands.set(commandId, record);
        for (const keybinding of keybindings) {
          this.#keybindings.set(keybinding, commandId);
        }
        this.#container.append(button);
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) {
              return;
            }
            disposed = true;
            this.#remove(commandId, record);
          }
        };
      },
      execute: (commandId, args = []) => this.execute(commandId, args)
    };
  }
  async execute(commandId, args = []) {
    const record = this.#commands.get(commandId);
    if (!record || this.#disposed) {
      throw new Error(`Plugin command is unavailable: ${commandId}`);
    }
    try {
      return await record.handler(args);
    } catch (error) {
      this.#onFailure(record.pluginId, "provider", error);
      throw error;
    }
  }
  releasePlugin(pluginId) {
    for (const [commandId, record] of [...this.#commands]) {
      if (record.pluginId === pluginId) {
        this.#remove(commandId, record);
      }
    }
  }
  commandCount(pluginId) {
    return [...this.#commands.values()].filter((command) => void 0 === pluginId || command.pluginId === pluginId).length;
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#window.removeEventListener("keydown", this.#onKeyDown, true);
    for (const [commandId, record] of [...this.#commands]) {
      this.#remove(commandId, record);
    }
  }
  #remove(commandId, expected) {
    if (this.#commands.get(commandId) !== expected) {
      return;
    }
    this.#commands.delete(commandId);
    for (const keybinding of expected.keybindings) {
      if (this.#keybindings.get(keybinding) === commandId) {
        this.#keybindings.delete(keybinding);
      }
    }
    expected.button.remove();
  }
};

// apps/desktop/src/plugin-assets.ts
var PLUGIN_IMAGE_CACHE_LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxMediaFileBytes: 16 * 1024 * 1024,
  maxCacheBytes: 32 * 1024 * 1024,
  maxEntries: 64,
  maxConcurrentLoads: 3,
  maxPathLength: 1024
});
var IMAGE_MIME_TYPES = Object.freeze({
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
});
var MEDIA_MIME_TYPES2 = Object.freeze({
  ...IMAGE_MIME_TYPES,
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm"
});
function isRecord5(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function assetPath(value, media) {
  if ("string" !== typeof value || "" === value || PLUGIN_IMAGE_CACHE_LIMITS.maxPathLength < value.length || value.startsWith("/") || value.includes("\\")) {
    throw new Error("Workspace image path is invalid");
  }
  const segments = value.split("/");
  if (segments.some((segment) => "" === segment || "." === segment || ".." === segment)) {
    throw new Error("Workspace image path escapes the workspace");
  }
  const extension = segments.at(-1)?.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  const mime = (media ? MEDIA_MIME_TYPES2 : IMAGE_MIME_TYPES)[extension];
  if (!mime) {
    throw new Error(`Workspace ${media ? "media" : "image"} type is unsupported`);
  }
  if (media && (2 !== segments.length || "media" !== segments[0])) {
    throw new Error("Workspace media must be a direct child of media/");
  }
  return { path: segments.join("/"), mime };
}
function decodeBase64(value, maxFileBytes) {
  const maximumEncodedLength = Math.ceil(maxFileBytes / 3) * 4 + 4;
  if ("" === value || maximumEncodedLength < value.length || 0 !== value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("Workspace image payload is malformed or exceeds the limit");
  }
  const decoder = globalThis.atob;
  if ("function" !== typeof decoder) {
    throw new Error("Base64 decoding is unavailable");
  }
  let binary;
  try {
    binary = decoder(value);
  } catch {
    throw new Error("Workspace image payload is malformed");
  }
  if (maxFileBytes < binary.length) {
    throw new Error("Workspace asset exceeds the file limit");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
function defaultCreateObjectUrl(bytes, mime) {
  if ("undefined" === typeof Blob || "function" !== typeof URL?.createObjectURL) {
    throw new Error("Object URL creation is unavailable");
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
}
function defaultRevokeObjectUrl(url) {
  URL?.revokeObjectURL?.(url);
}
var DesktopPluginAssetHost = class {
  #bridge;
  #createObjectUrl;
  #revokeObjectUrl;
  #cache = /* @__PURE__ */ new Map();
  #waiters = [];
  #activeLoads = 0;
  #cacheBytes = 0;
  #clock = 0;
  #epoch = 0;
  #disposed = false;
  constructor(options) {
    this.#bridge = options.bridge;
    this.#createObjectUrl = options.createObjectUrl ?? defaultCreateObjectUrl;
    this.#revokeObjectUrl = options.revokeObjectUrl ?? defaultRevokeObjectUrl;
  }
  async acquire(value) {
    return this.#acquire(value, false);
  }
  async resolveMedia(value) {
    const lease = await this.#acquire(value, true);
    return { url: lease.url, release: () => lease.dispose() };
  }
  async #acquire(value, media) {
    if (this.#disposed) {
      throw new Error("Plugin asset host is disposed");
    }
    const { path, mime } = assetPath(value, media);
    const maxFileBytes = media ? PLUGIN_IMAGE_CACHE_LIMITS.maxMediaFileBytes : PLUGIN_IMAGE_CACHE_LIMITS.maxFileBytes;
    const modifiedMs = await this.#bridge.invoke("workspace_file_mtime", {
      relativePath: path
    });
    if (!Number.isSafeInteger(modifiedMs) || Number(modifiedMs) < 0) {
      throw new Error("Workspace image mtime is malformed");
    }
    const key = `${media ? "media" : "image"}\0${path}\0${String(modifiedMs)}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      this.#evictWhile(() => this.#cache.size >= PLUGIN_IMAGE_CACHE_LIMITS.maxEntries);
      if (this.#cache.size >= PLUGIN_IMAGE_CACHE_LIMITS.maxEntries) {
        throw new Error("Workspace image cache entry budget exceeded");
      }
      const epoch = this.#epoch;
      const pending = {};
      const promise = this.#withLoadSlot(async () => {
        const payload = await this.#bridge.invoke(
          media ? "workspace_read_plugin_media" : "workspace_read_plugin_image",
          {
            relativePath: path
          }
        );
        if (this.#disposed || epoch !== this.#epoch) {
          throw new Error("Workspace image load was cancelled");
        }
        if (!isRecord5(payload) || "string" !== typeof payload.contentBase64 || !Number.isSafeInteger(payload.lastModifiedMs) || Number(payload.lastModifiedMs) !== Number(modifiedMs)) {
          throw new Error("Workspace image payload or revision is malformed");
        }
        const encoded = payload.contentBase64;
        const bytes = decodeBase64(encoded, maxFileBytes);
        this.#reserve(bytes.byteLength);
        let url;
        try {
          url = this.#createObjectUrl(bytes, mime);
        } catch (error) {
          throw error;
        }
        pending.url = url;
        pending.bytes = bytes.byteLength;
        this.#cacheBytes += bytes.byteLength;
        this.#trim();
        return pending;
      }).catch((error) => {
        if (this.#cache.get(key) === pending) {
          this.#cache.delete(key);
        }
        throw error;
      });
      Object.assign(pending, {
        key,
        path,
        modifiedMs: Number(modifiedMs),
        promise,
        bytes: 0,
        url: void 0,
        refs: 0,
        lastUsed: ++this.#clock
      });
      entry = pending;
      this.#cache.set(key, entry);
    }
    entry.refs += 1;
    entry.lastUsed = ++this.#clock;
    try {
      await entry.promise;
    } catch (error) {
      entry.refs = Math.max(0, entry.refs - 1);
      throw error;
    }
    if (!entry.url || this.#disposed) {
      entry.refs = Math.max(0, entry.refs - 1);
      throw new Error("Workspace image was released before use");
    }
    let disposed = false;
    return {
      url: entry.url,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        entry.refs = Math.max(0, entry.refs - 1);
        entry.lastUsed = ++this.#clock;
        this.#trim();
      }
    };
  }
  notifyWorkspaceReset() {
    this.#releaseAll();
  }
  cacheStats() {
    return { entries: this.#cache.size, bytes: this.#cacheBytes };
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#releaseAll();
  }
  #reserve(bytes) {
    this.#evictWhile(() => this.#cacheBytes + bytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes);
    if (this.#cacheBytes + bytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes) {
      throw new Error("Workspace image cache memory budget exceeded");
    }
  }
  #trim() {
    this.#evictWhile(() => this.#cache.size > PLUGIN_IMAGE_CACHE_LIMITS.maxEntries || this.#cacheBytes > PLUGIN_IMAGE_CACHE_LIMITS.maxCacheBytes);
  }
  #evictWhile(condition) {
    while (condition()) {
      const candidate = [...this.#cache.values()].filter((entry) => 0 === entry.refs && void 0 !== entry.url).sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) {
        return;
      }
      this.#evict(candidate);
    }
  }
  #evict(entry) {
    if (this.#cache.get(entry.key) !== entry) {
      return;
    }
    this.#cache.delete(entry.key);
    if (entry.url) {
      this.#revokeObjectUrl(entry.url);
      this.#cacheBytes = Math.max(0, this.#cacheBytes - entry.bytes);
      entry.url = void 0;
      entry.bytes = 0;
    }
  }
  #releaseAll() {
    this.#epoch += 1;
    for (const entry of this.#cache.values()) {
      if (entry.url) {
        this.#revokeObjectUrl(entry.url);
      }
      entry.url = void 0;
      entry.bytes = 0;
      entry.refs = 0;
    }
    this.#cache.clear();
    this.#cacheBytes = 0;
  }
  async #withLoadSlot(operation) {
    if (this.#activeLoads >= PLUGIN_IMAGE_CACHE_LIMITS.maxConcurrentLoads) {
      await new Promise((resolve) => {
        this.#waiters.push(resolve);
      });
    }
    if (this.#disposed) {
      throw new Error("Plugin asset host is disposed");
    }
    this.#activeLoads += 1;
    try {
      return await operation();
    } finally {
      this.#activeLoads -= 1;
      this.#waiters.shift()?.();
    }
  }
};

// apps/desktop/src/plugin-documents.ts
var MAX_ACTIVE_EDIT_BYTES = 2 * 1024 * 1024;
function snapshotFromSession(session) {
  const state = session.state;
  return Object.freeze({
    path: state.path,
    content: state.buffer,
    revision: String(state.savedSnapshot.revision),
    bufferVersion: state.bufferVersion,
    dirty: state.dirty
  });
}
var DesktopPluginDocumentHub = class {
  #listeners = {
    open: /* @__PURE__ */ new Set(),
    change: /* @__PURE__ */ new Set(),
    save: /* @__PURE__ */ new Set(),
    activatePane: /* @__PURE__ */ new Set()
  };
  #onFailure;
  #editActive;
  #listOpenSessions;
  #activeSnapshot = null;
  constructor(onFailure, editActive, listOpenSessions) {
    this.#onFailure = onFailure;
    this.#editActive = editActive;
    this.#listOpenSessions = listOpenSessions;
  }
  createService(pluginId, capabilities = {}) {
    return {
      getActiveSnapshot: () => this.#activeSnapshot,
      listOpenSaveStates: () => this.#listOpenSaveStates(),
      ...capabilities.editActive && this.#editActive ? { applyActiveEdit: (edit) => this.#applyEdit(edit) } : {},
      onDidOpen: (listener) => this.#subscribe(pluginId, "open", listener),
      onDidChange: (listener) => this.#subscribe(pluginId, "change", listener),
      onDidSave: (listener) => this.#subscribe(pluginId, "save", listener),
      onDidActivatePane: (listener) => this.#subscribe(pluginId, "activatePane", listener)
    };
  }
  #listOpenSaveStates() {
    const sessions = this.#listOpenSessions?.() ?? [];
    const seen = /* @__PURE__ */ new Set();
    const states = [];
    for (const session of sessions) {
      if (seen.has(session)) {
        continue;
      }
      seen.add(session);
      const state = session.state;
      states.push(Object.freeze({
        path: state.path,
        revision: String(state.savedSnapshot.revision),
        bufferVersion: state.bufferVersion,
        dirty: state.dirty
      }));
    }
    return Object.freeze(states);
  }
  async #applyEdit(edit) {
    if (!edit || "string" !== typeof edit.path || "" === edit.path || !Number.isSafeInteger(edit.expectedBufferVersion) || edit.expectedBufferVersion < 0 || "string" !== typeof edit.content) {
      throw new Error("Active document edit is malformed");
    }
    if (MAX_ACTIVE_EDIT_BYTES < new TextEncoder().encode(edit.content).byteLength) {
      throw new Error("Active document edit exceeds the content limit");
    }
    if (!this.#editActive) {
      throw new Error("Active document editing is unavailable");
    }
    return this.#editActive(edit);
  }
  setActive(session) {
    this.#activeSnapshot = session ? snapshotFromSession(session) : null;
  }
  emit(event, session) {
    const snapshot = snapshotFromSession(session);
    this.#activeSnapshot = snapshot;
    for (const owned of [...this.#listeners[event]]) {
      try {
        void Promise.resolve(owned.listener(snapshot)).catch((error) => {
          this.#onFailure(owned.pluginId, "provider", error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, "provider", error);
      }
    }
  }
  listenerCount(pluginId) {
    return Object.values(this.#listeners).reduce(
      (total, listeners) => total + [...listeners].filter((owned) => void 0 === pluginId || owned.pluginId === pluginId).length,
      0
    );
  }
  releasePlugin(pluginId) {
    for (const listeners of Object.values(this.#listeners)) {
      for (const owned of [...listeners]) {
        if (owned.pluginId === pluginId) {
          listeners.delete(owned);
        }
      }
    }
  }
  #subscribe(pluginId, event, listener) {
    const owned = { pluginId, listener };
    this.#listeners[event].add(owned);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.#listeners[event].delete(owned);
      }
    };
  }
};

// apps/desktop/src/plugin-extensions.ts
var MAX_EXTENSION_DATA_BYTES = 16 * 1024;
var MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024;
function validIdentifier(value) {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(value);
}
function isJsonValue(value, seen = /* @__PURE__ */ new Set()) {
  if (null === value || "string" === typeof value || "boolean" === typeof value) {
    return true;
  }
  if ("number" === typeof value) {
    return Number.isFinite(value);
  }
  if ("object" !== typeof value || seen.has(value)) {
    return false;
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (Object.prototype !== prototype && null !== prototype) {
      return false;
    }
  }
  seen.add(value);
  const valid = Array.isArray(value) ? value.every((entry) => isJsonValue(entry, seen)) : Object.entries(value).every(([key, entry]) => "" !== key && isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}
function cloneJson(value, maximum, label) {
  if (!isJsonValue(value)) {
    throw new Error(`${label} must be JSON data`);
  }
  const encoded = JSON.stringify(value);
  if (maximum < new TextEncoder().encode(encoded).byteLength) {
    throw new Error(`${label} exceeds its byte limit`);
  }
  return JSON.parse(encoded);
}
function normalizeContribution(value) {
  if (!value || !validIdentifier(value.id)) {
    throw new Error("Plugin extension contribution ID is invalid");
  }
  if ("string" !== typeof value.label || "" === value.label.trim() || 256 < value.label.length) {
    throw new Error("Plugin extension contribution label is invalid");
  }
  if (void 0 !== value.order && (!Number.isSafeInteger(value.order) || value.order < -1e4 || 1e4 < value.order)) {
    throw new Error("Plugin extension contribution order is invalid");
  }
  if (void 0 !== value.execute && "function" !== typeof value.execute) {
    throw new Error("Plugin extension contribution execute handler is invalid");
  }
  return {
    id: value.id,
    label: value.label.trim(),
    ...void 0 === value.order ? {} : { order: value.order },
    ...void 0 === value.data ? {} : { data: cloneJson(value.data, MAX_EXTENSION_DATA_BYTES, "Plugin extension data") },
    ...void 0 === value.execute ? {} : { execute: value.execute }
  };
}
var DesktopPluginExtensionHost = class {
  #onFailure;
  #contributions = /* @__PURE__ */ new Set();
  #listeners = /* @__PURE__ */ new Set();
  #disposed = false;
  constructor(onFailure) {
    this.#onFailure = onFailure;
  }
  createService(pluginId, capabilities) {
    if (this.#disposed) {
      throw new Error("Plugin extension host is disposed");
    }
    return {
      register: (pointId, contribution) => {
        if (!capabilities.register) {
          throw new Error("Plugin may not register extensions");
        }
        return this.#register(pluginId, pointId, contribution);
      },
      list: (pointId) => {
        if (!capabilities.consume) {
          throw new Error("Plugin may not consume extensions");
        }
        return this.#list(pointId);
      },
      onDidChange: (pointId, listener) => {
        if (!capabilities.consume) {
          throw new Error("Plugin may not consume extensions");
        }
        return this.#listen(pluginId, pointId, listener);
      }
    };
  }
  releasePlugin(pluginId) {
    const changedPoints = /* @__PURE__ */ new Set();
    for (const owned of [...this.#contributions]) {
      if (owned.pluginId !== pluginId) {
        continue;
      }
      this.#contributions.delete(owned);
      changedPoints.add(owned.pointId);
    }
    for (const owned of [...this.#listeners]) {
      if (owned.pluginId === pluginId) {
        this.#listeners.delete(owned);
      }
    }
    for (const pointId of changedPoints) {
      this.#notify(pointId);
    }
  }
  contributionCount(pluginId) {
    return [...this.#contributions].filter((owned) => void 0 === pluginId || owned.pluginId === pluginId).length;
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#contributions.clear();
    this.#listeners.clear();
  }
  #register(pluginId, pointId, value) {
    this.#point(pointId);
    const contribution = normalizeContribution(value);
    if ([...this.#contributions].some((owned2) => owned2.pointId === pointId && owned2.contribution.id === contribution.id)) {
      throw new Error(`Plugin extension contribution is duplicated: ${pointId}/${contribution.id}`);
    }
    const owned = { pluginId, pointId, contribution };
    this.#contributions.add(owned);
    this.#notify(pointId);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (this.#contributions.delete(owned)) {
          this.#notify(pointId);
        }
      }
    };
  }
  #list(pointId) {
    this.#point(pointId);
    return [...this.#contributions].filter((owned) => owned.pointId === pointId).sort((left, right) => (left.contribution.order ?? 100) - (right.contribution.order ?? 100) || left.contribution.id.localeCompare(right.contribution.id)).map((owned) => ({
      id: owned.contribution.id,
      label: owned.contribution.label,
      ...void 0 === owned.contribution.order ? {} : { order: owned.contribution.order },
      ...void 0 === owned.contribution.data ? {} : {
        data: cloneJson(
          owned.contribution.data,
          MAX_EXTENSION_DATA_BYTES,
          "Plugin extension data"
        )
      },
      ...void 0 === owned.contribution.execute ? {} : {
        execute: async (request) => {
          if (!this.#contributions.has(owned)) {
            throw new Error("Plugin extension contribution is no longer active");
          }
          const input = cloneJson(
            request,
            MAX_EXTENSION_MESSAGE_BYTES,
            "Plugin extension request"
          );
          try {
            const result = await owned.contribution.execute(input);
            return void 0 === result ? void 0 : cloneJson(
              result,
              MAX_EXTENSION_MESSAGE_BYTES,
              "Plugin extension response"
            );
          } catch (error) {
            this.#onFailure(owned.pluginId, "provider", error);
            throw error;
          }
        }
      }
    }));
  }
  #listen(pluginId, pointId, listener) {
    this.#point(pointId);
    if ("function" !== typeof listener) {
      throw new Error("Plugin extension listener is invalid");
    }
    const owned = { pluginId, pointId, listener };
    this.#listeners.add(owned);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.#listeners.delete(owned);
      }
    };
  }
  #notify(pointId) {
    for (const owned of [...this.#listeners]) {
      if (owned.pointId !== pointId) {
        continue;
      }
      try {
        void Promise.resolve(owned.listener()).catch((error) => {
          this.#onFailure(owned.pluginId, "provider", error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, "provider", error);
      }
    }
  }
  #point(pointId) {
    if ("string" !== typeof pointId || !validIdentifier(pointId)) {
      throw new Error("Plugin extension point ID is invalid");
    }
    if (this.#disposed) {
      throw new Error("Plugin extension host is disposed");
    }
  }
};

// apps/desktop/src/plugin-editor.ts
var EDITOR_FEATURES = /* @__PURE__ */ new Set([
  "code-languages",
  "emoji",
  "math",
  "media",
  "mermaid",
  "tables",
  "wiki-links"
]);
var MAX_EXTENSIONS = 32;
var MAX_FEATURES = EDITOR_FEATURES.size;
function validateExtension(pluginId, extension, allowMedia) {
  if (!extension || "object" !== typeof extension || 1 !== extension.schemaVersion || "string" !== typeof extension.id || !extension.id.startsWith(`${pluginId}.`) || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(extension.id) || !Array.isArray(extension.features) || 0 === extension.features.length || MAX_FEATURES < extension.features.length || extension.features.some((feature) => !EDITOR_FEATURES.has(feature)) || new Set(extension.features).size !== extension.features.length) {
    throw new Error("Editor extension is malformed");
  }
  if (extension.features.includes("media") && !allowMedia) {
    throw new Error("Media editor extensions require workspace.writeMedia");
  }
  return Object.freeze({
    schemaVersion: 1,
    id: extension.id,
    features: Object.freeze([...extension.features])
  });
}
var DesktopPluginEditorHost = class {
  #extensions = /* @__PURE__ */ new Map();
  #targets = /* @__PURE__ */ new Set();
  #disposed = false;
  createService(pluginId, allowMedia) {
    return {
      registerExtension: (candidate) => {
        if (this.#disposed) {
          throw new Error("Plugin editor host is disposed");
        }
        if (MAX_EXTENSIONS <= this.#extensions.size) {
          throw new Error("Editor extension limit reached");
        }
        const extension = validateExtension(pluginId, candidate, allowMedia);
        if (this.#extensions.has(extension.id)) {
          throw new Error(`Editor extension is already registered: ${extension.id}`);
        }
        const record = { pluginId, extension };
        this.#extensions.set(extension.id, record);
        this.#apply();
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) {
              return;
            }
            disposed = true;
            if (this.#extensions.get(extension.id) === record) {
              this.#extensions.delete(extension.id);
              this.#apply();
            }
          }
        };
      }
    };
  }
  attach(target) {
    if (this.#disposed) {
      throw new Error("Plugin editor host is disposed");
    }
    this.#targets.add(target);
    target.setPluginFeatures(this.#activeFeatures());
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (this.#targets.delete(target)) {
          target.setPluginFeatures(/* @__PURE__ */ new Set());
        }
      }
    };
  }
  releasePlugin(pluginId) {
    let changed = false;
    for (const [id, record] of [...this.#extensions]) {
      if (record.pluginId === pluginId) {
        this.#extensions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.#apply();
    }
  }
  extensionCount(pluginId) {
    return [...this.#extensions.values()].filter((record) => void 0 === pluginId || record.pluginId === pluginId).length;
  }
  activeFeatures() {
    return this.#activeFeatures();
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#extensions.clear();
    for (const target of this.#targets) {
      target.setPluginFeatures(/* @__PURE__ */ new Set());
    }
    this.#targets.clear();
  }
  #activeFeatures() {
    const features = /* @__PURE__ */ new Set();
    for (const { extension } of this.#extensions.values()) {
      for (const feature of extension.features) {
        features.add(feature);
      }
    }
    return features;
  }
  #apply() {
    const features = this.#activeFeatures();
    for (const target of this.#targets) {
      target.setPluginFeatures(features);
    }
  }
};

// apps/desktop/src/plugin-headers.ts
function element2(document2, tagName, className) {
  const result = document2.createElement(tagName);
  if (className) {
    result.className = className;
  }
  return result;
}
var DesktopDocumentHeaderHost = class {
  #document;
  #containers;
  #getSnapshot;
  #onFailure;
  #providers = /* @__PURE__ */ new Map();
  #generation = { primary: 0, secondary: 0 };
  #disposed = false;
  constructor(options) {
    this.#document = options.document;
    this.#containers = options.containers;
    this.#getSnapshot = options.getSnapshot;
    this.#onFailure = options.onFailure;
  }
  createService(pluginId) {
    return {
      registerDocumentHeaderProvider: (provider) => this.#register(pluginId, provider)
    };
  }
  renderAll() {
    if (this.#disposed) {
      return;
    }
    void this.#render("primary");
    void this.#render("secondary");
  }
  providerCount(pluginId) {
    return [...this.#providers.values()].filter((owned) => void 0 === pluginId || owned.pluginId === pluginId).length;
  }
  releasePlugin(pluginId) {
    let changed = false;
    for (const [key, owned] of [...this.#providers]) {
      if (owned.pluginId !== pluginId) {
        continue;
      }
      this.#providers.delete(key);
      changed = true;
    }
    if (changed) {
      this.renderAll();
    }
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#providers.clear();
    for (const paneId of ["primary", "secondary"]) {
      this.#generation[paneId] += 1;
      this.#containers[paneId].replaceChildren();
      this.#containers[paneId].hidden = true;
    }
  }
  #register(pluginId, provider) {
    if (this.#disposed) {
      throw new Error("Document header host is disposed");
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(provider.id)) {
      throw new Error("Document header provider ID is invalid");
    }
    const key = `${pluginId}:${provider.id}`;
    if (this.#providers.has(key)) {
      throw new Error(`Document header provider is already registered: ${key}`);
    }
    const owned = { key, pluginId, provider };
    this.#providers.set(key, owned);
    this.renderAll();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.#providers.delete(key);
        this.renderAll();
      }
    };
  }
  async #render(paneId) {
    const generation = ++this.#generation[paneId];
    const snapshot = this.#getSnapshot(paneId);
    const container = this.#containers[paneId];
    if (!snapshot) {
      container.replaceChildren();
      container.hidden = true;
      return;
    }
    const rendered = [];
    for (const owned of [...this.#providers.values()]) {
      let viewModel;
      try {
        viewModel = await owned.provider.provide(snapshot);
      } catch (error) {
        this.#providers.delete(owned.key);
        this.#onFailure(owned.pluginId, "provider", error);
        continue;
      }
      if (this.#disposed || generation !== this.#generation[paneId]) {
        return;
      }
      if (!viewModel) {
        continue;
      }
      try {
        rendered.push(this.#renderContribution(owned, paneId, snapshot, viewModel));
      } catch (error) {
        this.#providers.delete(owned.key);
        this.#onFailure(owned.pluginId, "render", error);
      }
    }
    if (this.#disposed || generation !== this.#generation[paneId]) {
      return;
    }
    container.replaceChildren(...rendered);
    container.hidden = 0 === rendered.length;
  }
  #renderContribution(owned, paneId, snapshot, viewModel) {
    const contribution = element2(this.#document, "section", "v2-document-contribution");
    contribution.dataset.pluginId = owned.pluginId;
    contribution.dataset.providerId = owned.provider.id;
    const summary = element2(this.#document, "button", "v2-document-contribution-summary");
    summary.type = "button";
    summary.setAttribute("aria-expanded", String(viewModel.expanded));
    const title = element2(this.#document, "span", "v2-document-contribution-title");
    title.textContent = `${viewModel.title} \xB7 ${viewModel.summary}`;
    summary.append(title);
    for (const badge of viewModel.badges ?? []) {
      const badgeElement = element2(this.#document, "span", "v2-document-contribution-badge");
      badgeElement.dataset.tone = badge.tone ?? "neutral";
      badgeElement.textContent = badge.label;
      summary.append(badgeElement);
    }
    if (!viewModel.toggleAction || !owned.provider.onAction) {
      summary.disabled = true;
    } else {
      summary.addEventListener("click", () => {
        void this.#handleAction(
          owned,
          paneId,
          snapshot,
          viewModel.toggleAction
        );
      });
    }
    contribution.append(summary);
    if (viewModel.expanded && 0 < (viewModel.fields?.length ?? 0)) {
      const fields = element2(this.#document, "dl", "v2-document-contribution-fields");
      for (const field of viewModel.fields ?? []) {
        const key = element2(this.#document, "dt");
        key.textContent = field.key;
        const value = element2(this.#document, "dd");
        value.dataset.kind = field.kind;
        value.textContent = field.value ?? field.kind;
        fields.append(key, value);
      }
      contribution.append(fields);
    }
    return contribution;
  }
  async #handleAction(owned, paneId, renderedSnapshot, action) {
    const current = this.#getSnapshot(paneId);
    if (!current || current.path !== renderedSnapshot.path || current.bufferVersion !== renderedSnapshot.bufferVersion) {
      return;
    }
    try {
      await owned.provider.onAction?.({ type: action }, current);
    } catch (error) {
      this.#providers.delete(owned.key);
      this.#onFailure(owned.pluginId, "provider", error);
    }
    this.renderAll();
  }
};

// apps/desktop/src/plugin-host.ts
var DEFAULT_GRANTS = /* @__PURE__ */ new Set([
  "commands",
  "documents.editActive",
  "documents.readActive",
  "editor.extensions",
  "extensions.consume",
  "extensions.register",
  "navigation.openMarkdown",
  "process.vcs",
  "ui.documentHeader",
  "ui.views",
  "storage.workspace",
  "workspace.readMarkdown",
  "workspace.readText",
  "workspace.modifyMarkdown",
  "workspace.modifyText",
  "workspace.writeMedia",
  "workspace.writeTextBatch",
  "workspace.watchMarkdown"
]);
var DesktopPluginHost = class {
  #commands;
  #documents;
  #extensions;
  #editor;
  #headers;
  #navigation;
  #storage;
  #views;
  #vcs;
  #workspace;
  #grantedPermissions;
  #onDiagnostic;
  constructor(options) {
    this.#commands = options.commands;
    this.#documents = options.documents;
    this.#extensions = options.extensions;
    this.#editor = options.editor;
    this.#headers = options.headers;
    this.#navigation = options.navigation;
    this.#storage = options.storage;
    this.#views = options.views;
    this.#vcs = options.vcs;
    this.#workspace = options.workspace;
    this.#grantedPermissions = options.grantedPermissions ?? DEFAULT_GRANTS;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {
    });
  }
  createServices(manifest) {
    const declared = new Set(manifest.permissions ?? []);
    const allowed = (permission) => declared.has(permission) && this.#grantedPermissions.has(permission);
    const services = {
      logger: this.#createLogger(manifest.id),
      ...allowed("commands") && this.#commands ? { commands: this.#commands.createService(manifest) } : {},
      ...allowed("documents.readActive") ? { documents: this.#documents.createService(manifest.id, {
        editActive: allowed("documents.editActive")
      }) } : {},
      ...allowed("editor.extensions") && this.#editor ? { editor: this.#editor.createService(manifest.id, allowed("workspace.writeMedia")) } : {},
      ...(allowed("extensions.consume") || allowed("extensions.register")) && this.#extensions ? {
        extensions: this.#extensions.createService(manifest.id, {
          consume: allowed("extensions.consume"),
          register: allowed("extensions.register")
        })
      } : {},
      ...allowed("navigation.openMarkdown") && this.#navigation ? { navigation: this.#navigation.createService() } : {},
      ...allowed("process.vcs") && this.#vcs && "mdular.vcs" === manifest.id && "0.1.0" === manifest.version && "vcs.js" === manifest.entry ? { vcs: this.#vcs.createService(manifest.id) } : {},
      ...allowed("ui.documentHeader") ? { ui: this.#headers.createService(manifest.id) } : {},
      ...allowed("ui.views") && this.#views ? { views: this.#views.createService(manifest) } : {},
      ...allowed("storage.workspace") ? { storage: this.#storage.createService(manifest.id) } : {},
      ...(allowed("workspace.readMarkdown") || allowed("workspace.readText") || allowed("workspace.watchMarkdown") || allowed("workspace.modifyMarkdown") || allowed("workspace.modifyText") || allowed("workspace.writeTextBatch")) && this.#workspace ? {
        workspace: this.#workspace.createService(manifest.id, {
          read: allowed("workspace.readMarkdown"),
          readText: allowed("workspace.readText"),
          watch: allowed("workspace.watchMarkdown"),
          modifyMarkdown: allowed("workspace.modifyMarkdown"),
          modifyText: allowed("workspace.modifyText"),
          writeTextBatch: allowed("workspace.writeTextBatch")
        })
      } : {}
    };
    return services;
  }
  releaseServices(pluginId) {
    this.#commands?.releasePlugin(pluginId);
    this.#documents.releasePlugin?.(pluginId);
    this.#extensions?.releasePlugin(pluginId);
    this.#editor?.releasePlugin(pluginId);
    this.#headers.releasePlugin?.(pluginId);
    this.#views?.releasePlugin(pluginId);
    this.#vcs?.releasePlugin(pluginId);
    this.#workspace?.releasePlugin(pluginId);
  }
  #createLogger(pluginId) {
    return {
      debug: (message, data) => this.#onDiagnostic(pluginId, "debug", message, data),
      info: (message, data) => this.#onDiagnostic(pluginId, "info", message, data),
      warn: (message, data) => this.#onDiagnostic(pluginId, "warn", message, data),
      error: (message, data) => this.#onDiagnostic(pluginId, "error", message, data)
    };
  }
};

// apps/desktop/src/plugin-navigation.ts
var DesktopPluginNavigationHost = class {
  #openMarkdown;
  constructor(openMarkdown) {
    this.#openMarkdown = openMarkdown;
  }
  createService() {
    return {
      openMarkdown: async (value, options = {}) => {
        const path = workspacePath(value);
        if (!path.toLocaleLowerCase("en-US").endsWith(".md")) {
          throw new Error("Plugin navigation is limited to Markdown files");
        }
        if (void 0 !== options.placement && "active-pane" !== options.placement && "secondary-pane" !== options.placement) {
          throw new Error("Plugin navigation placement is invalid");
        }
        if (void 0 !== options.focus && "boolean" !== typeof options.focus) {
          throw new Error("Plugin navigation focus option is invalid");
        }
        await this.#openMarkdown(path, {
          placement: options.placement ?? "active-pane",
          focus: options.focus ?? true
        });
      }
    };
  }
};

// apps/desktop/src/plugin-storage.ts
var PLUGIN_STORAGE_LIMITS = Object.freeze({
  maxKeyCharacters: 512,
  maxValueBytes: 64 * 1024,
  maxNamespaceBytes: 1024 * 1024
});
var STORAGE_PREFIX = "mdular:v2:plugin-storage:v1:";
function failure(kind, message) {
  return { ok: false, error: { kind, message } };
}
function storageError(error) {
  const name = null !== error && "object" === typeof error && "name" in error ? String(error.name) : "";
  return failure(
    "QuotaExceededError" === name ? "quota" : "unavailable",
    error instanceof Error ? error.message : String(error)
  );
}
function validKey(key) {
  return 0 < key.length && key.length <= PLUGIN_STORAGE_LIMITS.maxKeyCharacters && !/[\u0000-\u001F\u007F]/u.test(key);
}
function isJsonValue2(value, seen = /* @__PURE__ */ new Set()) {
  if (null === value || "string" === typeof value || "boolean" === typeof value) {
    return true;
  }
  if ("number" === typeof value) {
    return Number.isFinite(value);
  }
  if ("object" !== typeof value) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (Object.prototype !== prototype && null !== prototype) {
      return false;
    }
  }
  seen.add(value);
  const valid = Array.isArray(value) ? value.every((entry) => isJsonValue2(entry, seen)) : Object.entries(value).every(
    ([key, entry]) => "" !== key && isJsonValue2(entry, seen)
  );
  seen.delete(value);
  return valid;
}
function isVersionedJsonValue(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value) && "schemaVersion" in value && Number.isSafeInteger(value.schemaVersion) && 0 < Number(value.schemaVersion) && "value" in value && isJsonValue2(value.value);
}
function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
function namespacePrefix(workspaceIdentity, pluginId) {
  const workspace = `${STORAGE_PREFIX}${encodeURIComponent(workspaceIdentity)}:`;
  return void 0 === pluginId ? workspace : `${workspace}${encodeURIComponent(pluginId)}:`;
}
var DesktopPluginStorageManager = class {
  #storage;
  #workspaceIdentity;
  constructor(storage, workspaceIdentity) {
    this.#storage = storage;
    this.#workspaceIdentity = workspaceIdentity;
  }
  createService(pluginId) {
    return {
      get: (key) => this.#get(pluginId, key),
      set: (key, value) => this.#set(pluginId, key, value),
      remove: (key) => this.#remove(pluginId, key)
    };
  }
  async migrateDocumentPath(previousPath, nextPath) {
    if (!validKey(previousPath) || !validKey(nextPath)) {
      return failure("invalid-key", "Document path is invalid for plugin storage migration");
    }
    let identity;
    try {
      identity = await this.#workspaceIdentity();
    } catch (error) {
      return storageError(error);
    }
    if (!identity || !this.#storage) {
      return failure("unavailable", "Workspace plugin storage is unavailable");
    }
    const workspacePrefix = namespacePrefix(identity);
    const previousPrefix = `document:${encodeURIComponent(previousPath)}:`;
    const nextPrefix = `document:${encodeURIComponent(nextPath)}:`;
    const moves = [];
    try {
      for (let index = 0; index < this.#storage.length; index += 1) {
        const storageKey = this.#storage.key(index);
        if (!storageKey?.startsWith(workspacePrefix)) {
          continue;
        }
        const pluginSeparator = storageKey.indexOf(":", workspacePrefix.length);
        if (-1 === pluginSeparator) {
          continue;
        }
        const encodedUserKey = storageKey.slice(pluginSeparator + 1);
        let userKey;
        try {
          userKey = decodeURIComponent(encodedUserKey);
        } catch {
          continue;
        }
        if (!userKey.startsWith(previousPrefix)) {
          continue;
        }
        const nextUserKey = `${nextPrefix}${userKey.slice(previousPrefix.length)}`;
        const destinationKey = `${storageKey.slice(0, pluginSeparator + 1)}` + encodeURIComponent(nextUserKey);
        const sourceValue = this.#storage.getItem(storageKey);
        if (null === sourceValue) {
          continue;
        }
        moves.push({
          sourceKey: storageKey,
          destinationKey,
          sourceValue,
          destinationValue: this.#storage.getItem(destinationKey)
        });
      }
      const written = [];
      try {
        for (const move of moves) {
          this.#storage.setItem(move.destinationKey, move.sourceValue);
          written.push(move);
        }
      } catch (error) {
        for (const move of written.reverse()) {
          if (null === move.destinationValue) {
            this.#storage.removeItem(move.destinationKey);
          } else {
            this.#storage.setItem(move.destinationKey, move.destinationValue);
          }
        }
        return storageError(error);
      }
      for (const move of moves) {
        this.#storage.removeItem(move.sourceKey);
      }
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }
  async #resolveKey(pluginId, key) {
    if (!validKey(pluginId) || !validKey(key)) {
      return failure("invalid-key", "Plugin storage key is empty, too long or contains controls");
    }
    let identity;
    try {
      identity = await this.#workspaceIdentity();
    } catch (error) {
      return storageError(error);
    }
    if (!identity || !this.#storage) {
      return failure("unavailable", "Workspace plugin storage is unavailable");
    }
    const namespace = namespacePrefix(identity, pluginId);
    return {
      ok: true,
      value: { namespace, storageKey: `${namespace}${encodeURIComponent(key)}` }
    };
  }
  async #get(pluginId, key) {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) {
      return resolved;
    }
    try {
      const value = this.#storage?.getItem(resolved.value.storageKey) ?? null;
      if (null === value) {
        return { ok: true, value: null };
      }
      const parsed = JSON.parse(value);
      if (!isVersionedJsonValue(parsed)) {
        return failure("invalid-value", "Stored plugin value is not versioned JSON");
      }
      return { ok: true, value: parsed };
    } catch (error) {
      return failure(
        "invalid-value",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  async #set(pluginId, key, value) {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) {
      return resolved;
    }
    let encoded;
    try {
      if (!isVersionedJsonValue(value)) {
        return failure("invalid-value", "Plugin storage accepts only versioned JSON");
      }
      encoded = JSON.stringify(value);
    } catch (error) {
      return failure("serialization", error instanceof Error ? error.message : String(error));
    }
    if (byteLength(encoded) > PLUGIN_STORAGE_LIMITS.maxValueBytes) {
      return failure("quota", "Plugin storage value exceeds the per-value limit");
    }
    try {
      let namespaceBytes = 0;
      if (this.#storage) {
        for (let index = 0; index < this.#storage.length; index += 1) {
          const storageKey = this.#storage.key(index);
          if (!storageKey?.startsWith(resolved.value.namespace) || storageKey === resolved.value.storageKey) {
            continue;
          }
          const stored = this.#storage.getItem(storageKey);
          if (null !== stored) {
            namespaceBytes += byteLength(storageKey) + byteLength(stored);
          }
        }
        namespaceBytes += byteLength(resolved.value.storageKey) + byteLength(encoded);
        if (namespaceBytes > PLUGIN_STORAGE_LIMITS.maxNamespaceBytes) {
          return failure("quota", "Plugin storage namespace exceeds its quota");
        }
        this.#storage.setItem(resolved.value.storageKey, encoded);
      }
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }
  async #remove(pluginId, key) {
    const resolved = await this.#resolveKey(pluginId, key);
    if (!resolved.ok) {
      return resolved;
    }
    try {
      this.#storage?.removeItem(resolved.value.storageKey);
      return { ok: true, value: null };
    } catch (error) {
      return storageError(error);
    }
  }
};
var DesktopWorkspaceIdentity = class {
  constructor(bridge, crypto) {
    this.#cached = null;
    this.get = () => {
      this.#cached ??= this.#load();
      return this.#cached;
    };
    this.#bridge = bridge;
    this.#crypto = crypto;
  }
  #bridge;
  #crypto;
  #cached;
  invalidate() {
    this.#cached = null;
  }
  async #load() {
    if (!this.#crypto?.subtle) {
      return null;
    }
    try {
      const path = await this.#bridge.invoke("workspace_get_path", {});
      if ("string" !== typeof path || "" === path) {
        return null;
      }
      const digest = await this.#crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `workspace-sha256:${hex}`;
    } catch {
      return null;
    }
  }
};

// apps/desktop/src/plugin-views.ts
var MAX_ITEMS = 500;
var MAX_BOARD_COLUMNS = 64;
var MAX_BOARD_ITEMS = 2e3;
var MAX_BOARD_ITEM_FIELDS = 8;
var MAX_TEXT = 4096;
var MAX_HIGHLIGHTS = 32;
var MAX_FIELDS = 16;
var MAX_FIELD_OPTIONS = 64;
var MAX_FIELD_VALUE = 64 * 1024;
var MAX_ACTIONS = 16;
var MAX_ITEM_ACTIONS = 16;
var MAX_READER_BLOCKS = 500;
var MAX_READER_OUTLINE = 256;
var MAX_READER_LIST_ITEMS = 128;
var MAX_READER_TEXT = 64 * 1024;
var MAX_READER_TOTAL_TEXT = 4 * 1024 * 1024;
function boundedString(value, label, maximum = MAX_TEXT) {
  if ("string" !== typeof value || maximum < value.length) {
    throw new Error(`${label} must be a string no longer than ${maximum} characters`);
  }
  return value;
}
function normalizeHighlights(value, text) {
  if (void 0 === value) {
    return void 0;
  }
  if (!Array.isArray(value) || MAX_HIGHLIGHTS < value.length) {
    throw new Error("Plugin view highlights are malformed or exceed the limit");
  }
  const normalized = value.map((range) => {
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.start >= range.end || text.length < range.end) {
      throw new Error("Plugin view highlight range is invalid");
    }
    return { start: range.start, end: range.end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  if (normalized.some((range, index) => 0 < index && (normalized[index - 1]?.end ?? 0) > range.start)) {
    throw new Error("Plugin view highlight ranges overlap");
  }
  return normalized;
}
function normalizeImage(value) {
  const path = boundedString(value?.path, "Plugin workspace image path", 1024);
  const segments = path.split("/");
  if ("" === path || path.startsWith("/") || path.includes("\\") || segments.some((segment) => "" === segment || "." === segment || ".." === segment)) {
    throw new Error("Plugin workspace image path is invalid");
  }
  const alt = boundedString(value.alt, "Plugin workspace image alt text", 1024);
  if (void 0 !== value.presentation && !["cover", "thumbnail", "content"].includes(value.presentation)) {
    throw new Error("Plugin workspace image presentation is invalid");
  }
  for (const coordinate of [value.focusX, value.focusY]) {
    if (void 0 !== coordinate && ("number" !== typeof coordinate || !Number.isFinite(coordinate) || coordinate < 0 || 100 < coordinate)) {
      throw new Error("Plugin workspace image focus is invalid");
    }
  }
  return {
    path: segments.join("/"),
    alt,
    ...value.presentation ? { presentation: value.presentation } : {},
    ...void 0 === value.focusX ? {} : { focusX: value.focusX },
    ...void 0 === value.focusY ? {} : { focusY: value.focusY }
  };
}
function normalizeItem(value) {
  const id = boundedString(value?.id, "Plugin view item ID", 512);
  if ("" === id) {
    throw new Error("Plugin view item ID must not be empty");
  }
  const title = boundedString(value.title, "Plugin view item title");
  const description = void 0 === value.description ? void 0 : boundedString(value.description, "Plugin view item description");
  const badges = void 0 === value.badges ? void 0 : Array.isArray(value.badges) ? value.badges.map((badge) => boundedString(badge, "Plugin view badge", 128)) : (() => {
    throw new Error("Plugin view item badges are malformed");
  })();
  if (badges && 16 < badges.length) {
    throw new Error("Plugin view item has too many badges");
  }
  const actions = void 0 === value.actions ? void 0 : Array.isArray(value.actions) ? value.actions.map((action) => normalizeItemAction(action)) : (() => {
    throw new Error("Plugin view item actions are malformed");
  })();
  if (actions && (MAX_ITEM_ACTIONS < actions.length || new Set(actions.map((action) => action.id)).size !== actions.length)) {
    throw new Error("Plugin view item actions are duplicated or exceed the limit");
  }
  if (void 0 !== value.appearance && !["default", "completed"].includes(value.appearance)) {
    throw new Error("Plugin view item appearance is invalid");
  }
  return {
    id,
    title,
    ...void 0 === description ? {} : { description },
    ...void 0 === badges ? {} : { badges },
    ...true === value.selected ? { selected: true } : {},
    ...value.appearance ? { appearance: value.appearance } : {},
    ...void 0 === actions ? {} : { actions },
    ...void 0 === value.image ? {} : { image: normalizeImage(value.image) },
    ...void 0 === value.titleHighlights ? {} : { titleHighlights: normalizeHighlights(value.titleHighlights, title) },
    ...void 0 === value.descriptionHighlights || void 0 === description ? {} : { descriptionHighlights: normalizeHighlights(value.descriptionHighlights, description) }
  };
}
function normalizeItemAction(value) {
  return normalizeAction(value);
}
function normalizeField(value) {
  const id = boundedString(value?.id, "Plugin view field ID", 128);
  if ("" === id) {
    throw new Error("Plugin view field ID must not be empty");
  }
  const label = boundedString(value.label, "Plugin view field label", 256);
  const fieldValue = boundedString(value.value, "Plugin view field value", MAX_FIELD_VALUE);
  const description = void 0 === value.description ? void 0 : boundedString(value.description, "Plugin view field description", 512);
  if ("select" === value.kind) {
    if (!Array.isArray(value.options) || 0 === value.options.length || MAX_FIELD_OPTIONS < value.options.length) {
      throw new Error("Plugin view select options are malformed or exceed the limit");
    }
    const options = value.options.map((option) => ({
      value: boundedString(option?.value, "Plugin view select option value", 512),
      label: boundedString(option?.label, "Plugin view select option label", 256)
    }));
    if (new Set(options.map((option) => option.value)).size !== options.length) {
      throw new Error("Plugin view select option values must be unique");
    }
    if (!options.some((option) => option.value === fieldValue)) {
      throw new Error("Plugin view select value must match an option");
    }
    return {
      id,
      kind: "select",
      label,
      value: fieldValue,
      options,
      ...void 0 === description ? {} : { description },
      ...true === value.readOnly ? { readOnly: true } : {}
    };
  }
  if ("text" !== value.kind && "textarea" !== value.kind) {
    throw new Error("Plugin view field kind is unsupported");
  }
  const placeholder = void 0 === value.placeholder ? void 0 : boundedString(value.placeholder, "Plugin view field placeholder", 256);
  const rows = void 0 === value.rows ? void 0 : value.rows;
  if (void 0 !== rows && ("textarea" !== value.kind || !Number.isSafeInteger(rows) || rows < 2 || 24 < rows)) {
    throw new Error("Plugin view field rows are invalid");
  }
  return {
    id,
    kind: value.kind,
    label,
    value: fieldValue,
    ...void 0 === placeholder ? {} : { placeholder },
    ...void 0 === description ? {} : { description },
    ...void 0 === rows ? {} : { rows },
    ...true === value.readOnly ? { readOnly: true } : {},
    ...void 0 === value.submitActionId ? {} : { submitActionId: boundedString(
      value.submitActionId,
      "Plugin view field submit action ID",
      128
    ) }
  };
}
function normalizeAction(value) {
  const id = boundedString(value?.id, "Plugin view action ID", 128);
  if ("" === id) {
    throw new Error("Plugin view action ID must not be empty");
  }
  const label = boundedString(value.label, "Plugin view action label", 256);
  if (void 0 !== value.tone && !["neutral", "primary", "danger"].includes(value.tone)) {
    throw new Error("Plugin view action tone is invalid");
  }
  return {
    id,
    label,
    ...value.tone ? { tone: value.tone } : {},
    ...true === value.disabled ? { disabled: true } : {}
  };
}
function normalizeActions(value) {
  const actions = void 0 === value ? void 0 : Array.isArray(value) ? value.map(normalizeAction) : (() => {
    throw new Error("Plugin view actions are malformed");
  })();
  if (actions && (MAX_ACTIONS < actions.length || new Set(actions.map((action) => action.id)).size !== actions.length)) {
    throw new Error("Plugin view actions are duplicated or exceed the limit");
  }
  return actions;
}
function normalizeFields(value, maximum = MAX_FIELDS) {
  const fields = void 0 === value ? void 0 : Array.isArray(value) ? value.map(normalizeField) : (() => {
    throw new Error("Plugin view fields are malformed");
  })();
  if (fields && (maximum < fields.length || new Set(fields.map((field) => field.id)).size !== fields.length)) {
    throw new Error("Plugin view fields are duplicated or exceed the limit");
  }
  return fields;
}
function normalizeCollectionState(value) {
  if (!value || 1 !== value.schemaVersion || "collection" !== value.kind || !Array.isArray(value.items) || MAX_ITEMS < value.items.length) {
    throw new Error("Plugin collection view state is malformed or exceeds the item limit");
  }
  const title = boundedString(value.title, "Plugin view title", 256);
  const input = void 0 === value.input ? void 0 : {
    value: boundedString(value.input.value, "Plugin view input", 2048),
    ...void 0 === value.input.placeholder ? {} : { placeholder: boundedString(value.input.placeholder, "Plugin view placeholder", 256) },
    ...void 0 === value.input.ariaLabel ? {} : { ariaLabel: boundedString(value.input.ariaLabel, "Plugin view input label", 256) }
  };
  const fields = normalizeFields(value.fields);
  const actions = normalizeActions(value.actions);
  return {
    schemaVersion: 1,
    kind: "collection",
    title,
    ...void 0 === input ? {} : { input },
    ...void 0 === fields ? {} : { fields },
    ...void 0 === actions ? {} : { actions },
    ...void 0 === value.status ? {} : { status: boundedString(value.status, "Plugin view status", 512) },
    ...void 0 === value.emptyMessage ? {} : { emptyMessage: boundedString(value.emptyMessage, "Plugin view empty message", 512) },
    ...true === value.busy ? { busy: true } : {},
    ...true === value.dismissOnActivate ? { dismissOnActivate: true } : {},
    items: value.items.map(normalizeItem)
  };
}
function normalizeBoardItem(value) {
  const id = boundedString(value?.id, "Plugin board item ID", 1024);
  if ("" === id) {
    throw new Error("Plugin board item ID must not be empty");
  }
  const badges = void 0 === value.badges ? void 0 : Array.isArray(value.badges) ? value.badges.map((badge) => boundedString(badge, "Plugin board badge", 128)) : (() => {
    throw new Error("Plugin board item badges are malformed");
  })();
  if (badges && 16 < badges.length) {
    throw new Error("Plugin board item has too many badges");
  }
  const actions = void 0 === value.actions ? void 0 : Array.isArray(value.actions) ? value.actions.map(normalizeItemAction) : (() => {
    throw new Error("Plugin board item actions are malformed");
  })();
  if (actions && (MAX_ITEM_ACTIONS < actions.length || new Set(actions.map((action) => action.id)).size !== actions.length)) {
    throw new Error("Plugin board item actions are duplicated or exceed the limit");
  }
  if (void 0 !== value.appearance && !["default", "completed"].includes(value.appearance)) {
    throw new Error("Plugin board item appearance is invalid");
  }
  return {
    id,
    title: boundedString(value.title, "Plugin board item title"),
    ...void 0 === value.description ? {} : { description: boundedString(value.description, "Plugin board item description") },
    ...void 0 === badges ? {} : { badges },
    ...value.appearance ? { appearance: value.appearance } : {},
    ...true === value.draggable ? { draggable: true } : {},
    ...void 0 === value.fields ? {} : { fields: normalizeFields(value.fields, MAX_BOARD_ITEM_FIELDS) },
    ...void 0 === actions ? {} : { actions }
  };
}
function normalizeBoardColumn(value) {
  const id = boundedString(value?.id, "Plugin board column ID", 512);
  if ("" === id || !Array.isArray(value.items)) {
    throw new Error("Plugin board column is malformed");
  }
  return {
    id,
    title: boundedString(value.title, "Plugin board column title", 256),
    ...true === value.locked ? { locked: true } : {},
    items: value.items.map(normalizeBoardItem)
  };
}
function normalizeBoardState(value) {
  if (!value || 1 !== value.schemaVersion || "board" !== value.kind || !Array.isArray(value.columns) || MAX_BOARD_COLUMNS < value.columns.length || void 0 !== value.layout && !["board", "list"].includes(value.layout)) {
    throw new Error("Plugin board state is malformed or exceeds the column limit");
  }
  const columns = value.columns.map(normalizeBoardColumn);
  const itemIds = columns.flatMap((column) => column.items.map((item) => item.id));
  if (MAX_BOARD_ITEMS < itemIds.length || new Set(columns.map((column) => column.id)).size !== columns.length || new Set(itemIds).size !== itemIds.length) {
    throw new Error("Plugin board IDs are duplicated or exceed the item limit");
  }
  const fields = normalizeFields(value.fields);
  const actions = normalizeActions(value.actions);
  return {
    schemaVersion: 1,
    kind: "board",
    title: boundedString(value.title, "Plugin board title", 256),
    layout: value.layout ?? "board",
    ...void 0 === fields ? {} : { fields },
    ...void 0 === actions ? {} : { actions },
    ...void 0 === value.status ? {} : { status: boundedString(value.status, "Plugin board status", 512) },
    ...true === value.busy ? { busy: true } : {},
    ...void 0 === value.emptyMessage ? {} : { emptyMessage: boundedString(value.emptyMessage, "Plugin board empty message", 512) },
    columns
  };
}
function normalizeReaderBlock(value) {
  const id = boundedString(value?.id, "Plugin reader block ID", 512);
  if ("" === id) {
    throw new Error("Plugin reader block ID must not be empty");
  }
  if ("heading" === value.kind) {
    if (!Number.isSafeInteger(value.level) || value.level < 1 || 6 < value.level) {
      throw new Error("Plugin reader heading level is invalid");
    }
    return {
      id,
      kind: "heading",
      level: value.level,
      text: boundedString(value.text, "Plugin reader heading", MAX_TEXT)
    };
  }
  if ("list" === value.kind) {
    if (!Array.isArray(value.items) || MAX_READER_LIST_ITEMS < value.items.length) {
      throw new Error("Plugin reader list is malformed or exceeds the limit");
    }
    return {
      id,
      kind: "list",
      items: value.items.map((item) => boundedString(item, "Plugin reader list item", MAX_TEXT)),
      ...true === value.ordered ? { ordered: true } : {}
    };
  }
  if ("image" === value.kind) {
    return {
      id,
      kind: "image",
      image: normalizeImage(value.image),
      ...void 0 === value.caption ? {} : { caption: boundedString(value.caption, "Plugin reader image caption", 1024) }
    };
  }
  if (!["paragraph", "quote", "code", "nested"].includes(value.kind)) {
    throw new Error("Plugin reader block kind is unsupported");
  }
  return {
    id,
    kind: value.kind,
    text: boundedString(value.text, "Plugin reader block text", MAX_READER_TEXT),
    ..."code" === value.kind && void 0 !== value.language ? { language: boundedString(value.language, "Plugin reader code language", 64) } : {}
  };
}
function normalizeReaderState(value) {
  if (!Array.isArray(value.outline) || MAX_READER_OUTLINE < value.outline.length || !Array.isArray(value.blocks) || MAX_READER_BLOCKS < value.blocks.length) {
    throw new Error("Plugin reader state is malformed or exceeds the limit");
  }
  const title = boundedString(value.title, "Plugin reader title", 256);
  const status = void 0 === value.status ? void 0 : boundedString(value.status, "Plugin reader status", 512);
  const sourcePath = boundedString(value.sourcePath, "Plugin reader source path", 1024);
  const sourceSegments = sourcePath.split("/");
  if ("" === sourcePath || sourcePath.startsWith("/") || sourcePath.includes("\\") || sourceSegments.some((segment) => "" === segment || "." === segment || ".." === segment) || !sourcePath.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("Plugin reader source path is invalid");
  }
  const outline = value.outline.map((item) => {
    const id = boundedString(item?.id, "Plugin reader outline ID", 512);
    if ("" === id || !Number.isSafeInteger(item.level) || item.level < 1 || 6 < item.level) {
      throw new Error("Plugin reader outline item is invalid");
    }
    return {
      id,
      label: boundedString(item.label, "Plugin reader outline label", MAX_TEXT),
      level: item.level
    };
  });
  const blocks = value.blocks.map(normalizeReaderBlock);
  const totalText = new TextEncoder().encode([
    title,
    status ?? "",
    ...outline.map((item) => item.label),
    ...blocks.flatMap((block) => {
      if ("heading" === block.kind || "paragraph" === block.kind || "quote" === block.kind || "code" === block.kind || "nested" === block.kind) {
        return [block.text];
      }
      if ("list" === block.kind) {
        return block.items;
      }
      if ("image" === block.kind) {
        return [block.image.alt, block.caption ?? ""];
      }
      return [];
    })
  ].join("\n")).byteLength;
  if (MAX_READER_TOTAL_TEXT < totalText) {
    throw new Error("Plugin reader text exceeds the total limit");
  }
  if (new Set(outline.map((item) => item.id)).size !== outline.length || new Set(blocks.map((block) => block.id)).size !== blocks.length || outline.some((item) => !blocks.some((block) => block.id === item.id && "heading" === block.kind))) {
    throw new Error("Plugin reader IDs are duplicated or the outline is inconsistent");
  }
  return {
    schemaVersion: 1,
    kind: "reader",
    title,
    sourcePath: sourceSegments.join("/"),
    ...void 0 === status ? {} : { status },
    ...void 0 === value.cover ? {} : { cover: normalizeImage(value.cover) },
    outline,
    blocks,
    ...void 0 === value.actions ? {} : { actions: normalizeActions(value.actions) }
  };
}
function normalizeState(value) {
  if (!value || 1 !== value.schemaVersion) {
    throw new Error("Plugin view state is malformed");
  }
  if ("board" === value.kind) {
    return normalizeBoardState(value);
  }
  if ("collection" === value.kind) {
    return normalizeCollectionState(value);
  }
  if ("reader" === value.kind) {
    return normalizeReaderState(value);
  }
  throw new Error("Plugin view kind is unsupported");
}
function viewKey(pluginId, viewId) {
  return `${pluginId}\0${viewId}`;
}
var DesktopPluginViewHost = class {
  #document;
  #onFailure;
  #imageResolver;
  #states = /* @__PURE__ */ new Map();
  #owners = /* @__PURE__ */ new Map();
  #listeners = /* @__PURE__ */ new Map();
  #imageLeases = /* @__PURE__ */ new Set();
  #readerBlocks = /* @__PURE__ */ new Map();
  #overlay;
  #panel;
  #title;
  #input;
  #fields;
  #actions;
  #status;
  #list;
  #board;
  #reader;
  #readerOutline;
  #readerArticle;
  #lightbox;
  #lightboxImage;
  #lightboxCaption;
  #onKeyDown = (event) => {
    if (this.#overlay.hidden) {
      return;
    }
    if ("Escape" === event.key) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.#lightbox.hidden) {
        this.#closeLightbox();
        return;
      }
      this.hideCurrent(true);
      return;
    }
    const state = this.#currentKey ? this.#states.get(this.#currentKey) : void 0;
    const target = event.target;
    if (target?.dataset.pluginFieldId) {
      return;
    }
    if (!state || "collection" !== state.kind || 0 === state.items.length) {
      return;
    }
    if ("ArrowDown" === event.key || "ArrowUp" === event.key) {
      event.preventDefault();
      const delta = "ArrowDown" === event.key ? 1 : -1;
      this.#selectedIndex = (this.#selectedIndex + delta + state.items.length) % state.items.length;
      this.#syncSelection();
      return;
    }
    if ("Enter" === event.key) {
      event.preventDefault();
      const item = state.items[this.#selectedIndex];
      if (item) {
        this.#activateItem(item.id, state);
      }
    }
  };
  #currentKey = null;
  #selectedIndex = 0;
  #renderGeneration = 0;
  #dragItemId = null;
  #lightboxReturnFocus = null;
  #disposed = false;
  constructor(options) {
    this.#document = options.document;
    this.#onFailure = options.onFailure;
    this.#imageResolver = options.imageResolver;
    this.#overlay = this.#document.createElement("section");
    this.#overlay.id = "v2-plugin-view-overlay";
    this.#overlay.className = "v2-plugin-view-overlay";
    this.#overlay.hidden = true;
    this.#overlay.setAttribute("role", "dialog");
    this.#overlay.setAttribute("aria-modal", "true");
    this.#panel = this.#document.createElement("div");
    this.#panel.className = "v2-plugin-view-panel";
    this.#panel.tabIndex = -1;
    const header = this.#document.createElement("header");
    header.className = "v2-plugin-view-header";
    this.#title = this.#document.createElement("h2");
    const close = this.#document.createElement("button");
    close.type = "button";
    close.textContent = "\xD7";
    close.setAttribute("aria-label", "Close plugin view");
    close.addEventListener("click", () => this.hideCurrent(true));
    header.append(this.#title, close);
    this.#input = this.#document.createElement("input");
    this.#input.className = "v2-plugin-view-input";
    this.#input.type = "search";
    this.#input.autocomplete = "off";
    this.#input.addEventListener("input", () => {
      this.#dispatch({ type: "input", payload: { value: this.#input.value } });
    });
    this.#fields = this.#document.createElement("div");
    this.#fields.className = "v2-plugin-view-fields";
    this.#status = this.#document.createElement("p");
    this.#status.className = "v2-plugin-view-status";
    this.#status.setAttribute("role", "status");
    this.#list = this.#document.createElement("ul");
    this.#list.className = "v2-plugin-view-list";
    this.#board = this.#document.createElement("div");
    this.#board.className = "v2-plugin-board";
    this.#board.hidden = true;
    this.#reader = this.#document.createElement("div");
    this.#reader.className = "v2-plugin-reader";
    this.#reader.hidden = true;
    this.#readerOutline = this.#document.createElement("nav");
    this.#readerOutline.className = "v2-plugin-reader-outline";
    this.#readerOutline.setAttribute("aria-label", "Document outline");
    this.#readerArticle = this.#document.createElement("article");
    this.#readerArticle.className = "v2-plugin-reader-article";
    this.#reader.append(this.#readerOutline, this.#readerArticle);
    this.#actions = this.#document.createElement("div");
    this.#actions.className = "v2-plugin-view-actions";
    this.#panel.append(
      header,
      this.#input,
      this.#fields,
      this.#status,
      this.#reader,
      this.#board,
      this.#list,
      this.#actions
    );
    this.#overlay.append(this.#panel);
    this.#lightbox = this.#document.createElement("section");
    this.#lightbox.className = "v2-plugin-image-lightbox";
    this.#lightbox.hidden = true;
    this.#lightbox.setAttribute("role", "dialog");
    this.#lightbox.setAttribute("aria-modal", "true");
    const lightboxClose = this.#document.createElement("button");
    lightboxClose.type = "button";
    lightboxClose.className = "v2-plugin-image-lightbox-close";
    lightboxClose.textContent = "\xD7";
    lightboxClose.setAttribute("aria-label", "Close image preview");
    lightboxClose.addEventListener("click", () => this.#closeLightbox());
    this.#lightboxImage = this.#document.createElement("img");
    this.#lightboxImage.className = "v2-plugin-image-lightbox-image";
    this.#lightboxCaption = this.#document.createElement("p");
    this.#lightboxCaption.className = "v2-plugin-image-lightbox-caption";
    this.#lightbox.append(lightboxClose, this.#lightboxImage, this.#lightboxCaption);
    this.#lightbox.addEventListener("click", (event) => {
      if (event.target === this.#lightbox) {
        this.#closeLightbox();
      }
    });
    this.#overlay.append(this.#lightbox);
    this.#overlay.addEventListener("keydown", this.#onKeyDown);
    this.#overlay.addEventListener("click", (event) => {
      if (event.target === this.#overlay) {
        this.hideCurrent(true);
      }
    });
    options.container.append(this.#overlay);
  }
  createService(manifest) {
    const declared = new Set((manifest.contributes?.views ?? []).map((view) => view.id));
    const owned = (viewId) => {
      if (!declared.has(viewId)) {
        throw new Error(`View is not declared by ${manifest.id}: ${viewId}`);
      }
      return { pluginId: manifest.id, viewId, key: viewKey(manifest.id, viewId) };
    };
    return {
      setState: (viewId, state) => {
        const entry = owned(viewId);
        this.#owners.set(entry.key, entry);
        this.#states.set(entry.key, normalizeState(state));
        if (entry.key === this.#currentKey) {
          this.#renderCurrent();
        }
      },
      onAction: (viewId, listener) => {
        const entry = { ...owned(viewId), listener };
        const listeners = this.#listeners.get(entry.key) ?? /* @__PURE__ */ new Set();
        listeners.add(entry);
        this.#listeners.set(entry.key, listeners);
        let disposed = false;
        return {
          dispose: () => {
            if (disposed) {
              return;
            }
            disposed = true;
            listeners.delete(entry);
            if (0 === listeners.size) {
              this.#listeners.delete(entry.key);
            }
          }
        };
      },
      reveal: async (viewId) => {
        const entry = owned(viewId);
        if (!this.#states.has(entry.key)) {
          throw new Error(`Plugin view has no state: ${viewId}`);
        }
        this.#currentKey = entry.key;
        this.#selectedIndex = 0;
        this.#overlay.hidden = false;
        this.#renderCurrent();
        const state = this.#states.get(entry.key);
        if (state && "collection" === state.kind && state.input) {
          this.#input.focus();
        } else {
          this.#panel.focus();
        }
      },
      revealReaderBlock: (viewId, blockId) => {
        const entry = owned(viewId);
        if (this.#currentKey !== entry.key) {
          throw new Error(`Plugin reader view is not visible: ${viewId}`);
        }
        const block = this.#readerBlocks.get(blockId);
        if (!block) {
          throw new Error(`Plugin reader block is unavailable: ${blockId}`);
        }
        block.scrollIntoView?.({ block: "start" });
      },
      hide: (viewId) => {
        const entry = owned(viewId);
        if (this.#currentKey === entry.key) {
          this.hideCurrent(false);
        }
      }
    };
  }
  releasePlugin(pluginId) {
    for (const [key, owner] of [...this.#owners]) {
      if (owner.pluginId !== pluginId) {
        continue;
      }
      this.#owners.delete(key);
      this.#states.delete(key);
      this.#listeners.delete(key);
      if (this.#currentKey === key) {
        this.hideCurrent(false);
      }
    }
  }
  viewCount(pluginId) {
    return [...this.#owners.values()].filter((owner) => void 0 === pluginId || owner.pluginId === pluginId).length;
  }
  hideCurrent(emitDismiss) {
    if (this.#overlay.hidden) {
      return;
    }
    if (emitDismiss) {
      this.#dispatch({ type: "dismiss" });
    }
    this.#overlay.hidden = true;
    this.#currentKey = null;
    this.#renderGeneration += 1;
    this.#dragItemId = null;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#list.replaceChildren();
    this.#board.replaceChildren();
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#states.clear();
    this.#owners.clear();
    this.#listeners.clear();
    this.#currentKey = null;
    this.#dragItemId = null;
    this.#renderGeneration += 1;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#overlay.removeEventListener("keydown", this.#onKeyDown);
    this.#overlay.remove();
  }
  #renderCurrent() {
    const state = this.#currentKey ? this.#states.get(this.#currentKey) : void 0;
    if (!state) {
      return;
    }
    this.#renderGeneration += 1;
    this.#dragItemId = null;
    this.#releaseImages();
    this.#closeLightbox(false);
    this.#title.textContent = state.title;
    if ("reader" === state.kind) {
      this.#renderReader(state);
      return;
    }
    if ("board" === state.kind) {
      this.#renderBoard(state);
      return;
    }
    this.#board.hidden = true;
    this.#board.replaceChildren();
    this.#reader.hidden = true;
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
    this.#readerBlocks.clear();
    this.#list.hidden = false;
    this.#input.hidden = !state.input;
    if (state.input) {
      this.#input.value = state.input.value;
      this.#input.placeholder = state.input.placeholder ?? "";
      this.#input.setAttribute("aria-label", state.input.ariaLabel ?? state.title);
    }
    this.#fields.replaceChildren(...(state.fields ?? []).map((field) => this.#renderField(field)));
    this.#fields.hidden = 0 === (state.fields?.length ?? 0);
    this.#status.textContent = state.status ?? (state.busy ? "Loading\u2026" : "");
    this.#status.hidden = "" === this.#status.textContent;
    const items = state.items.map((item, index) => this.#renderItem(item, index, state));
    if (0 === items.length && state.emptyMessage) {
      const empty = this.#document.createElement("li");
      empty.className = "v2-plugin-view-empty";
      empty.textContent = state.emptyMessage;
      items.push(empty);
    }
    this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, state.items.length - 1));
    this.#list.replaceChildren(...items);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action))
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
    this.#syncSelection();
  }
  #renderBoard(state) {
    this.#input.hidden = true;
    this.#reader.hidden = true;
    this.#readerOutline.replaceChildren();
    this.#readerArticle.replaceChildren();
    this.#readerBlocks.clear();
    this.#list.hidden = true;
    this.#list.replaceChildren();
    this.#fields.replaceChildren(...(state.fields ?? []).map((field) => this.#renderField(field)));
    this.#fields.hidden = 0 === (state.fields?.length ?? 0);
    this.#status.textContent = state.status ?? (state.busy ? "Loading\u2026" : "");
    this.#status.hidden = "" === this.#status.textContent;
    this.#board.hidden = false;
    this.#board.dataset.layout = state.layout ?? "board";
    const columns = state.columns.map((column) => this.#renderBoardColumn(column));
    const itemCount = state.columns.reduce((total, column) => total + column.items.length, 0);
    if (0 === itemCount && state.emptyMessage) {
      const empty = this.#document.createElement("p");
      empty.className = "v2-plugin-view-empty";
      empty.textContent = state.emptyMessage;
      columns.push(empty);
    }
    this.#board.replaceChildren(...columns);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action))
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
  }
  #renderBoardColumn(column) {
    const section = this.#document.createElement("section");
    section.className = "v2-plugin-board-column";
    section.dataset.columnId = column.id;
    section.dataset.locked = String(true === column.locked);
    const heading = this.#document.createElement("h3");
    heading.textContent = `${column.title} (${String(column.items.length)})`;
    const items = this.#document.createElement("div");
    items.className = "v2-plugin-board-items";
    items.replaceChildren(...column.items.map((item) => this.#renderBoardItem(item)));
    if (!column.locked) {
      items.addEventListener("dragover", (rawEvent) => {
        if (!this.#dragItemId) {
          return;
        }
        const event = rawEvent;
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        section.dataset.dragTarget = "true";
      });
      items.addEventListener("dragleave", () => {
        delete section.dataset.dragTarget;
      });
      items.addEventListener("drop", (rawEvent) => {
        const event = rawEvent;
        event.preventDefault();
        delete section.dataset.dragTarget;
        const id = this.#dragItemId;
        this.#dragItemId = null;
        if (id) {
          this.#dispatch({ type: "board-drop", payload: { id, columnId: column.id } });
        }
      });
    }
    section.append(heading, items);
    return section;
  }
  #renderBoardItem(item) {
    const card = this.#document.createElement("article");
    card.className = "v2-plugin-board-item";
    card.dataset.itemId = item.id;
    card.dataset.appearance = item.appearance ?? "default";
    card.draggable = true === item.draggable;
    if (item.draggable) {
      card.addEventListener("dragstart", (rawEvent) => {
        this.#dragItemId = item.id;
        card.dataset.dragging = "true";
        const transfer = rawEvent.dataTransfer;
        if (transfer) {
          transfer.effectAllowed = "move";
          transfer.setData("text/plain", item.id);
        }
      });
      card.addEventListener("dragend", () => {
        this.#dragItemId = null;
        delete card.dataset.dragging;
      });
    }
    const open = this.#document.createElement("button");
    open.type = "button";
    open.className = "v2-plugin-board-item-open";
    const title = this.#document.createElement("strong");
    title.textContent = item.title;
    open.append(title);
    if (item.description) {
      const description = this.#document.createElement("span");
      description.textContent = item.description;
      open.append(description);
    }
    open.addEventListener("click", () => {
      this.#dispatch({ type: "activate", payload: { id: item.id } });
    });
    card.append(open);
    if (0 < (item.badges?.length ?? 0)) {
      const badges = this.#document.createElement("div");
      badges.className = "v2-plugin-board-item-badges";
      for (const text of item.badges ?? []) {
        const badge = this.#document.createElement("span");
        badge.textContent = text;
        badges.append(badge);
      }
      card.append(badges);
    }
    if (0 < (item.fields?.length ?? 0)) {
      const fields = this.#document.createElement("div");
      fields.className = "v2-plugin-board-item-fields";
      fields.replaceChildren(...(item.fields ?? []).map((field) => this.#renderField(field, item.id)));
      card.append(fields);
    }
    if (0 < (item.actions?.length ?? 0)) {
      const actions = this.#document.createElement("div");
      actions.className = "v2-plugin-view-item-actions";
      for (const action of item.actions ?? []) {
        const button = this.#document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.dataset.itemActionId = action.id;
        button.dataset.tone = action.tone ?? "neutral";
        button.disabled = true === action.disabled;
        button.addEventListener("click", () => {
          this.#dispatch({
            type: "item-command",
            payload: { id: item.id, actionId: action.id }
          });
        });
        actions.append(button);
      }
      card.append(actions);
    }
    return card;
  }
  #renderReader(state) {
    this.#input.hidden = true;
    this.#fields.hidden = true;
    this.#fields.replaceChildren();
    this.#list.hidden = true;
    this.#list.replaceChildren();
    this.#board.hidden = true;
    this.#board.replaceChildren();
    this.#status.textContent = state.status ?? state.sourcePath;
    this.#status.hidden = "" === this.#status.textContent;
    this.#reader.hidden = false;
    this.#readerBlocks.clear();
    const outline = state.outline.map((item) => {
      const button = this.#document.createElement("button");
      button.type = "button";
      button.className = "v2-plugin-reader-outline-item";
      button.dataset.level = String(item.level);
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.#readerBlocks.get(item.id)?.scrollIntoView?.({ block: "start" });
      });
      return button;
    });
    this.#readerOutline.replaceChildren(...outline);
    this.#readerOutline.hidden = 0 === outline.length;
    const articleChildren = [];
    if (state.cover) {
      articleChildren.push(this.#renderImage(state.cover, state.title));
    }
    for (const block of state.blocks) {
      const element4 = this.#renderReaderBlock(block);
      this.#readerBlocks.set(block.id, element4);
      articleChildren.push(element4);
    }
    this.#readerArticle.replaceChildren(...articleChildren);
    this.#actions.replaceChildren(
      ...(state.actions ?? []).map((action) => this.#renderAction(action))
    );
    this.#actions.hidden = 0 === (state.actions?.length ?? 0);
  }
  #renderReaderBlock(block) {
    let element4;
    if ("heading" === block.kind) {
      element4 = this.#document.createElement(`h${String(block.level)}`);
      element4.textContent = block.text;
    } else if ("paragraph" === block.kind) {
      element4 = this.#document.createElement("p");
      element4.textContent = block.text;
    } else if ("quote" === block.kind) {
      element4 = this.#document.createElement("blockquote");
      element4.textContent = block.text;
    } else if ("code" === block.kind) {
      const pre = this.#document.createElement("pre");
      const code = this.#document.createElement("code");
      code.textContent = block.text;
      if (block.language) {
        code.dataset.language = block.language;
      }
      pre.append(code);
      element4 = pre;
    } else if ("nested" === block.kind) {
      element4 = this.#document.createElement("aside");
      element4.className = "v2-plugin-reader-nested";
      element4.textContent = block.text;
    } else if ("list" === block.kind) {
      const list = this.#document.createElement(block.ordered ? "ol" : "ul");
      list.replaceChildren(...block.items.map((item) => {
        const entry = this.#document.createElement("li");
        entry.textContent = item;
        return entry;
      }));
      element4 = list;
    } else if ("image" === block.kind) {
      element4 = this.#renderImage(block.image, block.caption);
    } else {
      throw new Error("Plugin reader block kind is unsupported");
    }
    element4.dataset.readerBlockId = block.id;
    return element4;
  }
  #renderImage(image, caption) {
    const generation = this.#renderGeneration;
    const figure = this.#document.createElement("figure");
    figure.className = "v2-plugin-workspace-image";
    figure.dataset.presentation = image.presentation ?? "content";
    figure.dataset.state = "loading";
    const trigger = this.#document.createElement("button");
    trigger.type = "button";
    trigger.className = "v2-plugin-workspace-image-trigger";
    trigger.disabled = true;
    const element4 = this.#document.createElement("img");
    element4.alt = image.alt;
    element4.loading = "lazy";
    element4.decoding = "async";
    element4.hidden = true;
    if (element4.style) {
      element4.style.objectPosition = `${String(image.focusX ?? 50)}% ${String(image.focusY ?? 50)}%`;
    }
    const placeholder = this.#document.createElement("span");
    placeholder.className = "v2-plugin-workspace-image-placeholder";
    placeholder.textContent = "Image unavailable";
    trigger.append(element4, placeholder);
    figure.append(trigger);
    if (caption) {
      const figcaption = this.#document.createElement("figcaption");
      figcaption.textContent = caption;
      figure.append(figcaption);
    }
    if (!this.#imageResolver) {
      figure.dataset.state = "unavailable";
      return figure;
    }
    void this.#imageResolver.acquire(image.path).then((lease) => {
      if (this.#disposed || generation !== this.#renderGeneration || this.#overlay.hidden) {
        void lease.dispose();
        return;
      }
      this.#imageLeases.add(lease);
      element4.src = lease.url;
      element4.hidden = false;
      placeholder.hidden = true;
      trigger.disabled = false;
      figure.dataset.state = "ready";
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#openLightbox(lease.url, image, caption, trigger);
      });
    }).catch(() => {
      if (generation === this.#renderGeneration) {
        figure.dataset.state = "unavailable";
      }
    });
    return figure;
  }
  #openLightbox(url, image, caption, returnFocus) {
    this.#lightboxReturnFocus = returnFocus;
    this.#lightboxImage.src = url;
    this.#lightboxImage.alt = image.alt;
    if (this.#lightboxImage.style) {
      this.#lightboxImage.style.objectPosition = `${String(image.focusX ?? 50)}% ${String(image.focusY ?? 50)}%`;
    }
    this.#lightboxCaption.textContent = caption ?? image.alt;
    this.#lightboxCaption.hidden = "" === this.#lightboxCaption.textContent;
    this.#lightbox.hidden = false;
    this.#lightbox.children[0]?.focus?.();
  }
  #closeLightbox(restoreFocus = true) {
    const returnFocus = this.#lightboxReturnFocus;
    this.#lightboxReturnFocus = null;
    this.#lightbox.hidden = true;
    this.#lightboxImage.src = "";
    this.#lightboxImage.alt = "";
    this.#lightboxCaption.textContent = "";
    if (restoreFocus) {
      returnFocus?.focus?.();
    }
  }
  #releaseImages() {
    for (const lease of this.#imageLeases) {
      void lease.dispose();
    }
    this.#imageLeases.clear();
  }
  #renderField(field, itemId) {
    const wrapper = this.#document.createElement("div");
    wrapper.className = "v2-plugin-view-field";
    const label = this.#document.createElement("label");
    label.textContent = field.label;
    let control;
    if ("textarea" === field.kind) {
      control = this.#document.createElement("textarea");
      control.rows = field.rows ?? 8;
      control.placeholder = field.placeholder ?? "";
    } else if ("select" === field.kind) {
      control = this.#document.createElement("select");
      control.replaceChildren(...field.options.map((option) => {
        const element4 = this.#document.createElement("option");
        element4.value = option.value;
        element4.textContent = option.label;
        return element4;
      }));
    } else {
      control = this.#document.createElement("input");
      control.type = "text";
      control.placeholder = field.placeholder ?? "";
      control.autocomplete = "off";
    }
    control.value = field.value;
    if ("select" === field.kind) {
      control.disabled = true === field.readOnly;
    } else {
      control.readOnly = true === field.readOnly;
    }
    control.dataset.pluginFieldId = field.id;
    control.setAttribute("aria-label", field.label);
    const eventName = "select" === field.kind ? "change" : "input";
    control.addEventListener(eventName, () => {
      this.#dispatch(void 0 === itemId ? { type: "field", payload: { id: field.id, value: control.value } } : {
        type: "item-field",
        payload: { id: itemId, fieldId: field.id, value: control.value }
      });
    });
    if ("select" !== field.kind && field.submitActionId) {
      const submitActionId = field.submitActionId;
      control.addEventListener("keydown", (rawEvent) => {
        const event = rawEvent;
        if ("Enter" !== event.key || event.shiftKey || event.isComposing) {
          return;
        }
        event.preventDefault();
        this.#dispatch({ type: "command", payload: { id: submitActionId } });
      });
    }
    label.append(control);
    wrapper.append(label);
    if (field.description) {
      const description = this.#document.createElement("small");
      description.textContent = field.description;
      wrapper.append(description);
    }
    return wrapper;
  }
  #renderAction(action) {
    const button = this.#document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.dataset.actionId = action.id;
    button.dataset.tone = action.tone ?? "neutral";
    button.disabled = true === action.disabled;
    button.addEventListener("click", () => {
      this.#dispatch({ type: "command", payload: { id: action.id } });
    });
    return button;
  }
  #renderItem(item, index, state) {
    const row = this.#document.createElement("li");
    row.className = "v2-plugin-view-item";
    row.dataset.index = String(index);
    row.dataset.pluginSelected = String(true === item.selected);
    row.dataset.appearance = item.appearance ?? "default";
    if (item.image) {
      row.append(this.#renderImage(item.image, item.title));
    }
    const button = this.#document.createElement("button");
    button.type = "button";
    button.dataset.itemId = item.id;
    const title = this.#document.createElement("span");
    title.className = "v2-plugin-view-item-title";
    this.#appendHighlighted(title, item.title, item.titleHighlights);
    button.append(title);
    if (item.description) {
      const description = this.#document.createElement("span");
      description.className = "v2-plugin-view-item-description";
      this.#appendHighlighted(description, item.description, item.descriptionHighlights);
      button.append(description);
    }
    for (const badgeText of item.badges ?? []) {
      const badge = this.#document.createElement("span");
      badge.className = "v2-plugin-view-item-badge";
      badge.textContent = badgeText;
      button.append(badge);
    }
    button.addEventListener("mouseenter", () => {
      this.#selectedIndex = index;
      this.#syncSelection();
    });
    button.addEventListener("click", () => this.#activateItem(item.id, state));
    row.append(button);
    if (0 < (item.actions?.length ?? 0)) {
      const actions = this.#document.createElement("div");
      actions.className = "v2-plugin-view-item-actions";
      for (const action of item.actions ?? []) {
        const actionButton = this.#document.createElement("button");
        actionButton.type = "button";
        actionButton.textContent = action.label;
        actionButton.dataset.itemActionId = action.id;
        actionButton.dataset.tone = action.tone ?? "neutral";
        actionButton.disabled = true === action.disabled;
        actionButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this.#dispatch({
            type: "item-command",
            payload: { id: item.id, actionId: action.id }
          });
        });
        actions.append(actionButton);
      }
      row.append(actions);
    }
    return row;
  }
  #appendHighlighted(container, text, ranges) {
    let cursor = 0;
    for (const range of ranges ?? []) {
      if (cursor < range.start) {
        const plain = this.#document.createElement("span");
        plain.textContent = text.slice(cursor, range.start);
        container.append(plain);
      }
      const marked = this.#document.createElement("mark");
      marked.textContent = text.slice(range.start, range.end);
      container.append(marked);
      cursor = range.end;
    }
    if (cursor < text.length || 0 === container.children.length) {
      const plain = this.#document.createElement("span");
      plain.textContent = text.slice(cursor);
      container.append(plain);
    }
  }
  #activateItem(itemId, state) {
    this.#dispatch({ type: "activate", payload: { id: itemId } });
    if (state.dismissOnActivate) {
      this.hideCurrent(false);
    }
  }
  #syncSelection() {
    const rows = [...this.#list.children];
    rows.forEach((row, index) => {
      row.dataset.selected = String(index === this.#selectedIndex);
      if (index === this.#selectedIndex) {
        row.scrollIntoView?.({ block: "nearest" });
      }
    });
  }
  #dispatch(action) {
    const currentKey = this.#currentKey;
    if (!currentKey) {
      return;
    }
    for (const owned of [...this.#listeners.get(currentKey) ?? []]) {
      try {
        void Promise.resolve(owned.listener(action)).catch((error) => {
          this.#onFailure(owned.pluginId, "provider", error);
        });
      } catch (error) {
        this.#onFailure(owned.pluginId, "provider", error);
      }
    }
  }
};

// apps/desktop/src/plugin-vcs.ts
var MAX_STATUS_ENTRIES = 2e3;
var MAX_PATH_LENGTH = 1024;
var MAX_BRANCH_LENGTH = 256;
var MAX_DIFF_BYTES = 2 * 1024 * 1024;
var EXTERNAL_CLIENTS = /* @__PURE__ */ new Set([
  "default",
  "source-git",
  "tortoise-git",
  "explorer",
  "finder"
]);
function isRecord6(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function stringValue(value, label, maximum) {
  if ("string" !== typeof value || maximum < value.length) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}
function booleanValue(value, label) {
  if ("boolean" !== typeof value) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}
function pathValue(value, label) {
  return workspacePath(stringValue(value, label, MAX_PATH_LENGTH));
}
function repositoryKind(value) {
  if (!["none", "git", "svn"].includes(String(value))) {
    throw new Error("VCS repository kind is malformed");
  }
  return value;
}
function statusEntry(value) {
  if (!isRecord6(value)) {
    throw new Error("VCS status entry is malformed");
  }
  const status = stringValue(value.status, "VCS status code", 2);
  const indexStatus = stringValue(value.indexStatus, "VCS index status", 1);
  const workingTreeStatus = stringValue(value.workingTreeStatus, "VCS working tree status", 1);
  if (2 !== status.length || 1 !== indexStatus.length || 1 !== workingTreeStatus.length) {
    throw new Error("VCS status code is malformed");
  }
  return {
    path: pathValue(value.path, "VCS status path"),
    status,
    indexStatus,
    workingTreeStatus
  };
}
function decodeVcsStatus(value) {
  if (!isRecord6(value) || !Array.isArray(value.entries)) {
    throw new Error("VCS status snapshot is malformed");
  }
  if (MAX_STATUS_ENTRIES < value.entries.length) {
    throw new Error("VCS status snapshot exceeds the entry limit");
  }
  const kind = repositoryKind(value.kind);
  const branch = void 0 === value.branch ? void 0 : stringValue(value.branch, "VCS branch", MAX_BRANCH_LENGTH);
  if ("none" === kind && (branch || 0 < value.entries.length)) {
    throw new Error("Non-repository VCS status must be empty");
  }
  return {
    kind,
    ...branch ? { branch } : {},
    entries: value.entries.map(statusEntry),
    truncated: booleanValue(value.truncated, "VCS status truncated marker")
  };
}
function diffSection(value) {
  if (!isRecord6(value) || !["working-tree", "staged"].includes(String(value.kind))) {
    throw new Error("VCS diff section is malformed");
  }
  const text = stringValue(value.text, "VCS diff text", MAX_DIFF_BYTES);
  if (MAX_DIFF_BYTES < new TextEncoder().encode(text).byteLength) {
    throw new Error("VCS diff text exceeds the byte limit");
  }
  return {
    kind: value.kind,
    text,
    truncated: booleanValue(value.truncated, "VCS diff truncated marker")
  };
}
function decodeVcsDiff(value) {
  if (!isRecord6(value) || !Array.isArray(value.sections) || 2 < value.sections.length) {
    throw new Error("VCS diff result is malformed");
  }
  const kind = repositoryKind(value.kind);
  if ("none" === kind) {
    throw new Error("VCS diff cannot target a non-repository");
  }
  return {
    kind,
    path: pathValue(value.path, "VCS diff path"),
    sections: value.sections.map(diffSection)
  };
}
function externalClient(value) {
  if ("string" !== typeof value || !EXTERNAL_CLIENTS.has(value)) {
    throw new Error("External VCS client is malformed");
  }
  return value;
}
var DesktopPluginVcsHost = class {
  #bridge;
  #activePlugins = /* @__PURE__ */ new Map();
  constructor(bridge) {
    this.#bridge = bridge;
  }
  createService(pluginId) {
    const ownership = Symbol(pluginId);
    this.#activePlugins.set(pluginId, ownership);
    const assertActive = () => {
      if (this.#activePlugins.get(pluginId) !== ownership) {
        throw new Error("VCS service has been released");
      }
    };
    return {
      status: async () => {
        assertActive();
        const wire = await this.#bridge.invoke("workspace_vcs_status", {});
        assertActive();
        return decodeVcsStatus(wire);
      },
      diff: async (path) => {
        assertActive();
        const checkedPath = pathValue(path, "VCS diff path");
        const wire = await this.#bridge.invoke("workspace_vcs_diff", {
          request: { path: checkedPath }
        });
        assertActive();
        const result = decodeVcsDiff(wire);
        if (result.path !== checkedPath) {
          throw new Error("VCS diff returned a different path");
        }
        return result;
      },
      openExternal: async (client) => {
        assertActive();
        const checkedClient = externalClient(client);
        const wire = await this.#bridge.invoke("workspace_vcs_open_external", {
          request: { client: checkedClient }
        });
        assertActive();
        if (!isRecord6(wire)) {
          throw new Error("External VCS result is malformed");
        }
        return { client: externalClient(wire.client) };
      }
    };
  }
  releasePlugin(pluginId) {
    this.#activePlugins.delete(pluginId);
  }
};

// apps/desktop/src/plugin-workspace.ts
var POLL_INTERVAL_MS = 2e3;
var MAX_TEXT_WRITE_OPERATIONS = 128;
var MAX_TEXT_WRITE_FILE_BYTES = 2 * 1024 * 1024;
var MAX_TEXT_WRITE_TOTAL_BYTES = 8 * 1024 * 1024;
var MAX_OWNED_BATCH_TOKENS = 8;
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set(["md", "json", "txt", "yaml", "yml"]);
function isRecord7(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function assertString2(value, label) {
  if ("string" !== typeof value) {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
function textWritePath(value) {
  const path = workspacePath(value);
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error("Text batch writes are limited to Markdown, JSON, text and YAML files");
  }
  return path;
}
function decodeReceipt(value) {
  if (!isRecord7(value)) {
    throw new Error("Text batch receipt is malformed");
  }
  const path = textWritePath(assertString2(value.path, "Text batch receipt path"));
  const revision = assertString2(value.revision, "Text batch receipt revision");
  if (!/^sha256:[a-f0-9]{64}$/u.test(revision)) {
    throw new Error("Text batch receipt revision is malformed");
  }
  return { path, revision };
}
function decodeReceipts(value) {
  if (!Array.isArray(value)) {
    throw new Error("Text batch receipts must be an array");
  }
  return value.map(decodeReceipt);
}
function decodeCommitResult(value) {
  if (!isRecord7(value) || "complete" !== value.status && "partial" !== value.status) {
    throw new Error("Text batch apply result is malformed");
  }
  const created = decodeReceipts(value.created);
  if ("complete" === value.status) {
    return { status: "complete", created };
  }
  if (!isRecord7(value.failed)) {
    throw new Error("Text batch failure is malformed");
  }
  const index = value.failed.index;
  if (!Number.isSafeInteger(index) || Number(index) < 0) {
    throw new Error("Text batch failure index is malformed");
  }
  return {
    status: "partial",
    created,
    failed: {
      index: Number(index),
      path: assertString2(value.failed.path, "Text batch failure path"),
      kind: assertString2(value.failed.kind, "Text batch failure kind"),
      message: assertString2(value.failed.message, "Text batch failure message")
    }
  };
}
function decodeRollbackResult(value) {
  if (!isRecord7(value) || !Array.isArray(value.removed) || !Array.isArray(value.retained)) {
    throw new Error("Text batch rollback result is malformed");
  }
  return {
    removed: value.removed.map((path) => textWritePath(assertString2(path, "Removed path"))),
    retained: value.retained.map((entry) => {
      if (!isRecord7(entry)) {
        throw new Error("Text batch rollback failure is malformed");
      }
      return {
        path: assertString2(entry.path, "Retained path"),
        kind: assertString2(entry.kind, "Rollback failure kind"),
        message: assertString2(entry.message, "Rollback failure message")
      };
    })
  };
}
function decodeMarkdownInventory(value) {
  if (!Array.isArray(value)) {
    throw new Error("Workspace file inventory must be an array");
  }
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (!isRecord7(item) || "string" !== typeof item.relative_path || "number" !== typeof item.last_modified_ms || !Number.isSafeInteger(item.last_modified_ms) || item.last_modified_ms < 0) {
      throw new Error("Workspace file inventory entry is malformed");
    }
    const path = workspacePath(item.relative_path);
    if (!path.toLocaleLowerCase("en-US").endsWith(".md")) {
      continue;
    }
    if (seen.has(path)) {
      throw new Error(`Workspace file inventory repeats ${path}`);
    }
    seen.add(path);
    entries.push({ path, lastModifiedMs: item.last_modified_ms });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
function markdownPath(value) {
  const path = workspacePath(value);
  if (!path.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("Plugin workspace access is limited to Markdown files");
  }
  return path;
}
function directoryPath(value) {
  if (void 0 === value || "" === value) {
    return null;
  }
  return workspacePath(value.replace(/\/$/u, ""));
}
function inventoryMap(entries) {
  return new Map(entries.map((entry) => [entry.path, entry.lastModifiedMs]));
}
var DesktopPluginWorkspaceHost = class {
  #bridge;
  #workspaceAdapter;
  #window;
  #onFailure;
  #watchers = /* @__PURE__ */ new Set();
  #textWritePlans = /* @__PURE__ */ new Map();
  #textWriteRollbacks = /* @__PURE__ */ new Map();
  #textEdits = /* @__PURE__ */ new Map();
  #nextBatchToken = 1;
  #inventory = null;
  #timer = null;
  #polling = false;
  #disposed = false;
  constructor(options) {
    this.#bridge = options.bridge;
    this.#workspaceAdapter = options.workspaceAdapter;
    this.#window = options.window;
    this.#onFailure = options.onFailure;
  }
  createService(pluginId, capabilities) {
    if (this.#disposed) {
      throw new Error("Plugin workspace host is disposed");
    }
    return {
      ...capabilities.read ? {
        readMarkdown: (path) => this.#readMarkdown(path),
        listMarkdown: (directory) => this.#listMarkdown(directory),
        listMarkdownEntries: (directory) => this.#listMarkdownEntries(directory)
      } : {},
      ...capabilities.readText ? { readText: (path) => this.#readText(path) } : {},
      ...capabilities.modifyMarkdown ? {
        beginMarkdownEdit: (path) => this.#beginMarkdownEdit(pluginId, path),
        commitMarkdownEdit: (editId, content) => this.#commitMarkdownEdit(pluginId, editId, content)
      } : {},
      ...capabilities.modifyText ? {
        beginTextEdit: (path) => this.#beginTextEdit(pluginId, path),
        commitTextEdit: (editId, content) => this.#commitTextEdit(pluginId, editId, content)
      } : {},
      ...capabilities.watch ? { watchMarkdown: (listener) => this.#watch(pluginId, listener) } : {},
      ...capabilities.writeTextBatch ? {
        planTextWrites: (operations, policy) => this.#planTextWrites(pluginId, operations, policy),
        commitTextWritePlan: (planId) => this.#commitTextWritePlan(pluginId, planId),
        rollbackTextWrites: (rollbackId) => this.#rollbackTextWrites(pluginId, rollbackId)
      } : {}
    };
  }
  notifyWorkspaceReset() {
    if (this.#disposed) {
      return;
    }
    this.#inventory = null;
    this.#textWritePlans.clear();
    this.#textWriteRollbacks.clear();
    this.#textEdits.clear();
    this.#dispatch({ kind: "reset" });
    if (0 < this.#watchers.size) {
      this.#schedule(0);
    }
  }
  releasePlugin(pluginId) {
    for (const watcher of [...this.#watchers]) {
      if (watcher.pluginId === pluginId) {
        this.#watchers.delete(watcher);
      }
    }
    if (0 === this.#watchers.size) {
      this.#stopPolling();
    }
    for (const [planId, plan] of [...this.#textWritePlans]) {
      if (plan.pluginId === pluginId) {
        this.#textWritePlans.delete(planId);
      }
    }
    for (const [rollbackId, rollback] of [...this.#textWriteRollbacks]) {
      if (rollback.pluginId === pluginId) {
        this.#textWriteRollbacks.delete(rollbackId);
      }
    }
    for (const [editId, edit] of [...this.#textEdits]) {
      if (edit.pluginId === pluginId) {
        this.#textEdits.delete(editId);
      }
    }
  }
  watcherCount(pluginId) {
    return [...this.#watchers].filter((watcher) => void 0 === pluginId || watcher.pluginId === pluginId).length;
  }
  async pollNow() {
    if (this.#disposed || this.#polling || 0 === this.#watchers.size) {
      return;
    }
    this.#polling = true;
    try {
      const next = inventoryMap(await this.#loadInventory());
      const previous = this.#inventory;
      this.#inventory = next;
      if (!previous) {
        return;
      }
      for (const path of previous.keys()) {
        if (!next.has(path)) {
          this.#dispatch({ path, kind: "deleted" });
        }
      }
      for (const [path, modified] of next) {
        const before = previous.get(path);
        if (void 0 === before) {
          this.#dispatch({ path, kind: "created" });
        } else if (before !== modified) {
          this.#dispatch({ path, kind: "changed" });
        }
      }
    } finally {
      this.#polling = false;
    }
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#watchers.clear();
    this.#textWritePlans.clear();
    this.#textWriteRollbacks.clear();
    this.#textEdits.clear();
    this.#inventory = null;
    this.#stopPolling();
  }
  async #readMarkdown(value) {
    return this.#readTextPath(markdownPath(value));
  }
  async #readText(value) {
    return this.#readTextPath(textWritePath(value));
  }
  async #readTextPath(path) {
    const result = await this.#workspaceAdapter.read(path);
    if (!result.ok) {
      throw new Error(`${result.error.kind}: ${result.error.message}`);
    }
    if (MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(result.snapshot.content).byteLength) {
      throw new Error("Plugin text read exceeds the file limit");
    }
    return result.snapshot.content;
  }
  async #listMarkdown(directory) {
    const scope = directoryPath(directory);
    return (await this.#loadInventory()).map((entry) => entry.path).filter((path) => !scope || path.startsWith(`${scope}/`));
  }
  async #listMarkdownEntries(directory) {
    const scope = directoryPath(directory);
    return (await this.#loadInventory()).filter((entry) => !scope || entry.path.startsWith(`${scope}/`)).map((entry) => ({ ...entry }));
  }
  async #loadInventory() {
    return decodeMarkdownInventory(
      await this.#bridge.invoke("workspace_list_files", {})
    );
  }
  async #beginMarkdownEdit(pluginId, value) {
    return this.#beginTextEditKind(pluginId, value, "markdown");
  }
  async #beginTextEdit(pluginId, value) {
    return this.#beginTextEditKind(pluginId, value, "text");
  }
  async #beginTextEditKind(pluginId, value, kind) {
    if (this.#disposed) {
      throw new Error("Plugin workspace host is disposed");
    }
    const path = "markdown" === kind ? markdownPath(value) : textWritePath(value);
    const result = await this.#workspaceAdapter.read(path);
    if (!result.ok) {
      throw new Error(`${result.error.kind}: ${result.error.message}`);
    }
    if ("read-write" !== result.snapshot.access.kind) {
      throw new Error(`read-only: ${result.snapshot.access.message}`);
    }
    if (MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(result.snapshot.content).byteLength) {
      throw new Error(`${"markdown" === kind ? "Markdown" : "Text"} edit content exceeds the file limit`);
    }
    this.#trimOwnedTokens(this.#textEdits, pluginId);
    return this.#storeTextEdit(pluginId, kind, result.snapshot);
  }
  async #commitMarkdownEdit(pluginId, editId, content) {
    return this.#commitTextEditKind(pluginId, editId, content, "markdown");
  }
  async #commitTextEdit(pluginId, editId, content) {
    return this.#commitTextEditKind(pluginId, editId, content, "text");
  }
  async #commitTextEditKind(pluginId, editId, content, kind) {
    const label = "markdown" === kind ? "Markdown" : "Text";
    const edit = this.#textEdits.get(editId);
    if (!edit || edit.pluginId !== pluginId || edit.kind !== kind) {
      throw new Error(`${label} edit is unknown`);
    }
    if (edit.committing) {
      throw new Error(`${label} edit is already committing`);
    }
    if ("string" !== typeof content || MAX_TEXT_WRITE_FILE_BYTES < new TextEncoder().encode(content).byteLength) {
      throw new Error(`${label} edit content exceeds the file limit`);
    }
    edit.committing = true;
    const result = await this.#workspaceAdapter.write({
      path: edit.snapshot.path,
      pathKey: edit.snapshot.pathKey,
      expectedRevision: edit.snapshot.revision,
      content,
      format: edit.snapshot.format
    });
    if (result.ok) {
      this.#textEdits.delete(editId);
      return { status: "written", path: result.snapshot.path, content: result.snapshot.content };
    }
    if ("conflict" === result.kind) {
      this.#textEdits.delete(editId);
      return { status: "conflict", current: this.#storeTextEdit(pluginId, kind, result.current) };
    }
    edit.committing = false;
    throw new Error(`${result.kind}: ${result.message}`);
  }
  #storeTextEdit(pluginId, kind, snapshot) {
    const editId = this.#token(pluginId, "edit");
    this.#textEdits.set(editId, {
      pluginId,
      editId,
      kind,
      snapshot,
      committing: false
    });
    return { editId, path: snapshot.path, content: snapshot.content };
  }
  async #planTextWrites(pluginId, operations, policy) {
    if (this.#disposed) {
      throw new Error("Plugin workspace host is disposed");
    }
    if ("fail-if-existing" !== policy && "skip-existing" !== policy) {
      throw new Error("Text batch conflict policy is invalid");
    }
    if (!Array.isArray(operations) || 0 === operations.length || MAX_TEXT_WRITE_OPERATIONS < operations.length) {
      throw new Error("Text batch operation count is outside the allowed range");
    }
    const encoder = new TextEncoder();
    const seen = /* @__PURE__ */ new Set();
    let totalBytes = 0;
    const normalized = operations.map((operation) => {
      if (!operation || "string" !== typeof operation.content) {
        throw new Error("Text batch operation is malformed");
      }
      const path = textWritePath(operation.path);
      const identity = path.toLocaleLowerCase("en-US");
      if (seen.has(identity)) {
        throw new Error(`Text batch path is duplicated: ${path}`);
      }
      seen.add(identity);
      const bytes = encoder.encode(operation.content).byteLength;
      if (MAX_TEXT_WRITE_FILE_BYTES < bytes) {
        throw new Error(`Text batch file exceeds the per-file limit: ${path}`);
      }
      totalBytes += bytes;
      if (MAX_TEXT_WRITE_TOTAL_BYTES < totalBytes) {
        throw new Error("Text batch exceeds the total content limit");
      }
      return { path, content: operation.content, bytes };
    });
    const entries = [];
    for (const operation of normalized) {
      const exists = await this.#bridge.invoke("workspace_exists", {
        relativePath: operation.path
      });
      if ("boolean" !== typeof exists) {
        throw new Error("Workspace existence result is malformed");
      }
      entries.push({
        path: operation.path,
        bytes: operation.bytes,
        disposition: exists ? "skip-existing" === policy ? "skip" : "conflict" : "create"
      });
    }
    this.#trimOwnedTokens(this.#textWritePlans, pluginId);
    const planId = this.#token(pluginId, "plan");
    this.#textWritePlans.set(planId, {
      pluginId,
      planId,
      policy,
      operations: normalized.map(({ path, content }) => ({ path, content })),
      entries,
      committing: false
    });
    return { planId, policy, entries };
  }
  async #commitTextWritePlan(pluginId, planId) {
    const plan = this.#textWritePlans.get(planId);
    if (!plan || plan.pluginId !== pluginId) {
      throw new Error("Text write plan is unknown");
    }
    if (plan.committing) {
      throw new Error("Text write plan is already committing");
    }
    if (plan.entries.some((entry) => "conflict" === entry.disposition)) {
      throw new Error("Text write plan has unresolved conflicts");
    }
    const skipped = plan.entries.filter((entry) => "skip" === entry.disposition).map((entry) => entry.path);
    const createPaths = new Set(plan.entries.filter((entry) => "create" === entry.disposition).map((entry) => entry.path));
    const operations = plan.operations.filter((operation) => createPaths.has(operation.path));
    if (0 === operations.length) {
      this.#textWritePlans.delete(planId);
      return { status: "complete", created: [], skipped };
    }
    plan.committing = true;
    let decoded;
    try {
      decoded = decodeCommitResult(await this.#bridge.invoke(
        "workspace_apply_text_batch",
        { request: { schemaVersion: 1, operations } }
      ));
    } catch (error) {
      plan.committing = false;
      throw error;
    }
    this.#textWritePlans.delete(planId);
    const created = decoded.created.map((receipt) => receipt.path);
    let rollbackId;
    if (0 < decoded.created.length) {
      this.#trimOwnedTokens(this.#textWriteRollbacks, pluginId);
      rollbackId = this.#token(pluginId, "rollback");
      this.#textWriteRollbacks.set(rollbackId, {
        pluginId,
        rollbackId,
        receipts: decoded.created
      });
    }
    if ("partial" === decoded.status) {
      return {
        status: "partial",
        created,
        skipped,
        failed: decoded.failed,
        ...rollbackId ? { rollbackId } : {}
      };
    }
    return {
      status: "complete",
      created,
      skipped,
      ...rollbackId ? { rollbackId } : {}
    };
  }
  async #rollbackTextWrites(pluginId, rollbackId) {
    const rollback = this.#textWriteRollbacks.get(rollbackId);
    if (!rollback || rollback.pluginId !== pluginId) {
      throw new Error("Text write rollback is unknown");
    }
    const result = decodeRollbackResult(await this.#bridge.invoke(
      "workspace_rollback_text_batch",
      { request: { schemaVersion: 1, receipts: rollback.receipts } }
    ));
    const retainedPaths = new Set(result.retained.map((entry) => entry.path));
    const retainedReceipts = rollback.receipts.filter((receipt) => retainedPaths.has(receipt.path));
    if (0 === retainedReceipts.length) {
      this.#textWriteRollbacks.delete(rollbackId);
    } else {
      this.#textWriteRollbacks.set(rollbackId, { ...rollback, receipts: retainedReceipts });
    }
    return result;
  }
  #token(pluginId, kind) {
    const token = `${pluginId}:${kind}:${this.#nextBatchToken}`;
    this.#nextBatchToken += 1;
    return token;
  }
  #trimOwnedTokens(values, pluginId) {
    const owned = [...values].filter(([, value]) => value.pluginId === pluginId);
    while (MAX_OWNED_BATCH_TOKENS <= owned.length) {
      const oldest = owned.shift();
      if (oldest) {
        values.delete(oldest[0]);
      }
    }
  }
  #watch(pluginId, listener) {
    if (this.#disposed) {
      throw new Error("Plugin workspace host is disposed");
    }
    const owned = { pluginId, listener };
    this.#watchers.add(owned);
    if (1 === this.#watchers.size) {
      this.#schedule(0);
    }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.#watchers.delete(owned);
        if (0 === this.#watchers.size) {
          this.#stopPolling();
        }
      }
    };
  }
  #dispatch(change) {
    for (const owned of [...this.#watchers]) {
      try {
        owned.listener(change);
      } catch (error) {
        this.#onFailure(owned.pluginId, "provider", error);
      }
    }
  }
  #schedule(delayMs = POLL_INTERVAL_MS) {
    if (this.#disposed || 0 === this.#watchers.size || null !== this.#timer) {
      return;
    }
    this.#timer = this.#window.setTimeout(() => {
      this.#timer = null;
      void this.pollNow().catch(() => {
      }).finally(() => this.#schedule());
    }, delayMs);
  }
  #stopPolling() {
    if (null !== this.#timer) {
      this.#window.clearTimeout(this.#timer);
    }
    this.#timer = null;
    this.#inventory = null;
  }
};

// apps/desktop/src/updater-handshake.ts
function isRecord8(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function decodeRequest(value) {
  if (!isRecord8(value)) {
    return null;
  }
  if ("string" !== typeof value.requestId || !/^restart-[1-9][0-9]*$/u.test(value.requestId) || 128 < value.requestId.length || "string" !== typeof value.version || "" === value.version.trim() || 6e4 !== value.timeoutMs) {
    return null;
  }
  return {
    requestId: value.requestId,
    version: value.version,
    timeoutMs: 6e4
  };
}
function reasonForHost(reason) {
  if ("save-error" === reason.kind || "recovery-error" === reason.kind) {
    return { kind: reason.kind, message: reason.message.slice(0, 512) };
  }
  return { kind: reason.kind };
}
function responseForHost(result) {
  return "ready" === result.kind ? { kind: "ready" } : { kind: "blocked", reasons: result.reasons.map(reasonForHost) };
}
async function installUpdaterRestartHandshake(bridge, prepareForRestart) {
  let disposed = false;
  const inFlight = /* @__PURE__ */ new Set();
  const unlisten = await bridge.listen("update-prepare-restart", (payload) => {
    const request = decodeRequest(payload);
    if (!request || disposed || inFlight.has(request.requestId)) {
      return;
    }
    inFlight.add(request.requestId);
    void (async () => {
      let result;
      try {
        result = responseForHost(await prepareForRestart());
      } catch {
        result = {
          kind: "blocked",
          reasons: [{
            kind: "recovery-error",
            message: "Application restart preparation failed"
          }]
        };
      }
      if (disposed) {
        return;
      }
      try {
        await bridge.invoke("updater_respond_prepare_restart", {
          requestId: request.requestId,
          result
        });
      } catch {
      } finally {
        inFlight.delete(request.requestId);
      }
    })();
  });
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      inFlight.clear();
      unlisten();
    }
  };
}

// apps/desktop/src/desktop-application.ts
function isRecord9(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function trackNativeDocument(adapter, session) {
  const candidate = adapter;
  return candidate.trackDocument?.(session.state.path) ?? { dispose() {
  } };
}
function decodeWorkspaceFiles(value) {
  if (!Array.isArray(value)) {
    throw new Error("Workspace file list must be an array");
  }
  const files = value.map((entry) => {
    if (!isRecord9(entry) || "string" !== typeof entry.relative_path) {
      throw new Error("Workspace file entry is malformed");
    }
    return { path: workspacePath(entry.relative_path) };
  });
  return files.filter(({ path }) => path.toLocaleLowerCase("en-US").endsWith(".md")).sort((left, right) => left.path.localeCompare(right.path));
}
function messageFrom2(error) {
  return error instanceof Error ? error.message : String(error);
}
function remapViewAfterContentReplacement(view, before, after) {
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < shared - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }
  const oldEnd = before.length - suffix;
  const newEnd = after.length - suffix;
  const mapOffset = (offset) => {
    if (offset <= prefix) {
      return offset;
    }
    if (oldEnd <= offset) {
      return offset + (after.length - before.length);
    }
    return Math.min(newEnd, prefix + Math.min(offset - prefix, newEnd - prefix));
  };
  return {
    ...view,
    selectionAnchor: Math.max(0, mapOffset(view.selectionAnchor)),
    selectionHead: Math.max(0, mapOffset(view.selectionHead))
  };
}
function element3(document2, tagName, options = {}) {
  const result = document2.createElement(tagName);
  if (options.id) {
    result.id = options.id;
  }
  if (options.className) {
    result.className = options.className;
  }
  if (void 0 !== options.text) {
    result.textContent = options.text;
  }
  return result;
}
var DesktopApplication = class {
  #bridge;
  #workspaceAdapter;
  #recoveryStore;
  #windowLifecycle;
  #layoutPreferenceStore;
  #bundledPluginCatalogLoader;
  #document;
  #window;
  #panes;
  #codeMirrorDocuments = new CodeMirrorDocumentPool();
  #recovery;
  #trackedSessions = /* @__PURE__ */ new Map();
  #mediaTransactions = /* @__PURE__ */ new Set();
  #root;
  #runtimeStatus;
  #pathInput;
  #fileSelect;
  #openButton;
  #splitButton;
  #recoveryPanel;
  #recoveryText;
  #restoreRecoveryButton;
  #laterRecoveryButton;
  #discardRecoveryButton;
  #saveButton;
  #diffButton;
  #documentTitle;
  #documentStatus;
  #primaryPluginHeaders;
  #conflictPanel;
  #conflictText;
  #reloadConflictButton;
  #keepConflictRecoveryButton;
  #continueConflictButton;
  #panesHost;
  #primaryPane;
  #editorHost;
  #placeholder;
  #diffHost;
  #diffView;
  #secondaryPane;
  #secondaryDocumentTitle;
  #secondaryDocumentStatus;
  #secondaryPluginHeaders;
  #secondarySaveButton;
  #secondaryDiffButton;
  #closeSecondaryButton;
  #secondaryEditorHost;
  #secondaryPlaceholder;
  #secondaryDiffHost;
  #secondaryDiffView;
  #pluginRuntime;
  #pluginAssets;
  #pluginCommands;
  #pluginDocuments;
  #pluginEditor;
  #pluginExtensions;
  #pluginHeaders;
  #pluginStorage;
  #pluginViews;
  #pluginWorkspace;
  #workspaceIdentity;
  #onWindowBlur = () => {
    void this.#recovery.flushAll("blur").then(() => this.#renderSessionState());
  };
  #onWindowResize = () => {
    this.#syncSecondaryAvailability();
  };
  #watchSubscription = null;
  #closeSubscription = null;
  #updaterHandshakeSubscription = null;
  #editor = null;
  #editorPluginBinding = null;
  #editorSaveBinding = null;
  #sessionBinding = null;
  #secondaryEditor = null;
  #secondaryEditorPluginBinding = null;
  #secondaryEditorSaveBinding = null;
  #secondarySessionBinding = null;
  #currentSession = null;
  #pendingRecovery = [];
  #busy = false;
  #closing = false;
  #lifecycleRegistrationStarted = false;
  #updaterHandshakeRegistrationStarted = false;
  #disposed = false;
  constructor(options) {
    this.#bridge = options.bridge;
    this.#workspaceAdapter = options.workspaceAdapter;
    this.#recoveryStore = options.recoveryStore;
    this.#windowLifecycle = options.windowLifecycle;
    this.#layoutPreferenceStore = options.layoutPreferenceStore ?? createDesktopLayoutPreferenceStore(options.window);
    this.#bundledPluginCatalogLoader = options.bundledPluginCatalogLoader ?? loadDesktopBundledPluginCatalog;
    this.#document = options.document;
    this.#window = options.window;
    const registry = new SessionRegistry();
    this.#panes = new PaneController(registry);
    const layoutPreference = this.#loadLayoutPreference();
    if (layoutPreference) {
      this.#panes.restoreLayout(layoutPreference);
    }
    this.#recovery = new RecoveryCoordinator({
      store: options.recoveryStore,
      scheduler: {
        schedule: (delayMs, task) => this.#window.setTimeout(task, delayMs),
        cancel: (timer) => this.#window.clearTimeout(timer)
      },
      clock: { now: () => Date.now() }
    });
    this.#root = element3(this.#document, "main", { id: "v2-app-root" });
    this.#root.dataset.adapter = "tauri";
    this.#root.dataset.persistence = this.#workspaceAdapter.capabilities.persistence;
    this.#root.dataset.recovery = options.recoveryStore.constructor.name;
    this.#root.setAttribute("aria-labelledby", "v2-app-title");
    const header = element3(this.#document, "header", { className: "v2-app-header" });
    const title = element3(this.#document, "h1", {
      id: "v2-app-title",
      text: `${this.#document.title} V2`
    });
    this.#runtimeStatus = element3(this.#document, "p", {
      id: "v2-runtime-status",
      className: "v2-runtime-status",
      text: "Tauri workspace adapter \xB7 explicit save"
    });
    header.append(title, this.#runtimeStatus);
    const workspaceBar = element3(this.#document, "section", { className: "v2-workspace-bar" });
    workspaceBar.setAttribute("aria-label", "Workspace document controls");
    this.#fileSelect = element3(this.#document, "select", { id: "v2-file-select" });
    this.#fileSelect.setAttribute("aria-label", "Known Markdown files");
    this.#replaceFileOptions([]);
    this.#pathInput = element3(this.#document, "input", { id: "v2-document-path" });
    this.#pathInput.type = "text";
    this.#pathInput.placeholder = "notes/example.md";
    this.#pathInput.autocomplete = "off";
    this.#pathInput.setAttribute("aria-label", "Workspace-relative Markdown path");
    const refreshButton = element3(this.#document, "button", { text: "Refresh files" });
    refreshButton.type = "button";
    const chooseButton = element3(this.#document, "button", { text: "Open folder" });
    chooseButton.type = "button";
    this.#openButton = element3(this.#document, "button", { text: "Open document" });
    this.#openButton.type = "button";
    this.#splitButton = element3(this.#document, "button", { text: "Open in split" });
    this.#splitButton.type = "button";
    const pluginCommands = element3(this.#document, "div", {
      id: "v2-plugin-commands",
      className: "v2-plugin-commands"
    });
    workspaceBar.append(
      this.#fileSelect,
      this.#pathInput,
      refreshButton,
      chooseButton,
      this.#openButton,
      this.#splitButton,
      pluginCommands
    );
    this.#recoveryPanel = element3(this.#document, "section", {
      id: "v2-recovery-panel",
      className: "v2-recovery-panel"
    });
    this.#recoveryPanel.hidden = true;
    this.#recoveryPanel.setAttribute("aria-live", "polite");
    this.#recoveryText = element3(this.#document, "p");
    const recoveryActions = element3(this.#document, "div", {
      className: "v2-recovery-actions"
    });
    this.#restoreRecoveryButton = element3(this.#document, "button", {
      text: "Restore recovery"
    });
    this.#restoreRecoveryButton.type = "button";
    this.#laterRecoveryButton = element3(this.#document, "button", { text: "Later" });
    this.#laterRecoveryButton.type = "button";
    this.#discardRecoveryButton = element3(this.#document, "button", {
      text: "Discard recovery"
    });
    this.#discardRecoveryButton.type = "button";
    recoveryActions.append(
      this.#restoreRecoveryButton,
      this.#laterRecoveryButton,
      this.#discardRecoveryButton
    );
    this.#recoveryPanel.append(this.#recoveryText, recoveryActions);
    this.#primaryPane = element3(this.#document, "section", {
      id: "v2-primary-pane",
      className: "v2-document-pane v2-primary-pane"
    });
    this.#primaryPane.setAttribute("aria-label", "Primary document pane");
    const documentHeader = element3(this.#document, "header", { className: "v2-document-header" });
    const identity = element3(this.#document, "div", { className: "v2-document-identity" });
    this.#documentTitle = element3(this.#document, "div", {
      className: "v2-document-title",
      text: "No document open"
    });
    this.#documentStatus = element3(this.#document, "p", {
      id: "v2-primary-status",
      className: "v2-document-status",
      text: "Choose a workspace-relative Markdown path."
    });
    this.#documentStatus.setAttribute("role", "status");
    this.#documentStatus.setAttribute("aria-live", "polite");
    this.#primaryPluginHeaders = element3(this.#document, "div", {
      id: "v2-primary-plugin-headers",
      className: "v2-document-contributions"
    });
    this.#primaryPluginHeaders.hidden = true;
    identity.append(this.#documentTitle, this.#documentStatus, this.#primaryPluginHeaders);
    this.#saveButton = element3(this.#document, "button", { text: "Save" });
    this.#saveButton.type = "button";
    this.#saveButton.disabled = true;
    this.#diffButton = element3(this.#document, "button", { text: "Diff" });
    this.#diffButton.type = "button";
    this.#diffButton.disabled = true;
    const primaryActions = element3(this.#document, "div", { className: "v2-pane-actions" });
    primaryActions.append(this.#diffButton, this.#saveButton);
    documentHeader.append(identity, primaryActions);
    this.#conflictPanel = element3(this.#document, "section", {
      id: "v2-conflict-panel",
      className: "v2-conflict-panel"
    });
    this.#conflictPanel.hidden = true;
    this.#conflictPanel.setAttribute("aria-live", "assertive");
    this.#conflictText = element3(this.#document, "p");
    const conflictActions = element3(this.#document, "div", {
      className: "v2-conflict-actions"
    });
    this.#reloadConflictButton = element3(this.#document, "button", { text: "Reload disk" });
    this.#reloadConflictButton.type = "button";
    this.#keepConflictRecoveryButton = element3(this.#document, "button", {
      text: "Keep buffer as recovery copy"
    });
    this.#keepConflictRecoveryButton.type = "button";
    this.#continueConflictButton = element3(this.#document, "button", {
      text: "Continue editing"
    });
    this.#continueConflictButton.type = "button";
    conflictActions.append(
      this.#reloadConflictButton,
      this.#keepConflictRecoveryButton,
      this.#continueConflictButton
    );
    this.#conflictPanel.append(this.#conflictText, conflictActions);
    this.#editorHost = element3(this.#document, "div", {
      id: "v2-primary-editor-host",
      className: "v2-editor-host"
    });
    this.#placeholder = element3(this.#document, "p", {
      className: "v2-editor-placeholder",
      text: "Open a Markdown document to start editing."
    });
    this.#editorHost.append(this.#placeholder);
    this.#diffHost = element3(this.#document, "div", {
      id: "v2-primary-diff",
      className: "v2-diff-host"
    });
    this.#diffView = new DesktopDiffView(
      this.#document,
      this.#diffHost,
      options.diffWorkerFactory ? new LineDiffTaskRunner(options.diffWorkerFactory) : createDesktopLineDiffRunner(this.#window)
    );
    this.#primaryPane.append(documentHeader, this.#editorHost, this.#diffHost);
    this.#secondaryPane = element3(this.#document, "section", {
      id: "v2-secondary-pane",
      className: "v2-document-pane v2-secondary-pane"
    });
    this.#secondaryPane.hidden = true;
    this.#secondaryPane.setAttribute("aria-label", "Secondary document pane");
    const secondaryHeader = element3(this.#document, "header", {
      className: "v2-document-header"
    });
    const secondaryIdentity = element3(this.#document, "div", {
      className: "v2-document-identity"
    });
    this.#secondaryDocumentTitle = element3(this.#document, "div", {
      className: "v2-document-title",
      text: "No document open"
    });
    this.#secondaryDocumentStatus = element3(this.#document, "p", {
      id: "v2-secondary-status",
      className: "v2-document-status",
      text: "Open a document in split view."
    });
    this.#secondaryDocumentStatus.setAttribute("role", "status");
    this.#secondaryDocumentStatus.setAttribute("aria-live", "polite");
    this.#secondaryPluginHeaders = element3(this.#document, "div", {
      id: "v2-secondary-plugin-headers",
      className: "v2-document-contributions"
    });
    this.#secondaryPluginHeaders.hidden = true;
    secondaryIdentity.append(
      this.#secondaryDocumentTitle,
      this.#secondaryDocumentStatus,
      this.#secondaryPluginHeaders
    );
    const secondaryActions = element3(this.#document, "div", {
      className: "v2-pane-actions"
    });
    this.#secondarySaveButton = element3(this.#document, "button", { text: "Save" });
    this.#secondarySaveButton.type = "button";
    this.#secondarySaveButton.disabled = true;
    this.#secondaryDiffButton = element3(this.#document, "button", { text: "Diff" });
    this.#secondaryDiffButton.type = "button";
    this.#secondaryDiffButton.disabled = true;
    this.#closeSecondaryButton = element3(this.#document, "button", { text: "Close split" });
    this.#closeSecondaryButton.type = "button";
    secondaryActions.append(
      this.#secondaryDiffButton,
      this.#secondarySaveButton,
      this.#closeSecondaryButton
    );
    secondaryHeader.append(secondaryIdentity, secondaryActions);
    this.#secondaryEditorHost = element3(this.#document, "div", {
      id: "v2-secondary-editor-host",
      className: "v2-editor-host"
    });
    this.#secondaryPlaceholder = element3(this.#document, "p", {
      className: "v2-editor-placeholder",
      text: "Open a document in split view."
    });
    this.#secondaryEditorHost.append(this.#secondaryPlaceholder);
    this.#secondaryDiffHost = element3(this.#document, "div", {
      id: "v2-secondary-diff",
      className: "v2-diff-host"
    });
    this.#secondaryDiffView = new DesktopDiffView(
      this.#document,
      this.#secondaryDiffHost,
      options.diffWorkerFactory ? new LineDiffTaskRunner(options.diffWorkerFactory) : createDesktopLineDiffRunner(this.#window)
    );
    this.#secondaryPane.append(
      secondaryHeader,
      this.#secondaryEditorHost,
      this.#secondaryDiffHost
    );
    this.#panesHost = element3(this.#document, "section", {
      id: "v2-panes",
      className: "v2-panes"
    });
    this.#panesHost.dataset.split = "false";
    this.#panesHost.append(this.#primaryPane, this.#secondaryPane);
    this.#root.append(
      header,
      workspaceBar,
      this.#recoveryPanel,
      this.#conflictPanel,
      this.#panesHost
    );
    let pluginRuntime = null;
    const onPluginFailure = (pluginId, phase, error) => {
      void pluginRuntime?.reportFailure(pluginId, phase, error).finally(() => {
        if (pluginRuntime && !this.#disposed) {
          this.#root.dataset.plugins = `disabled:${pluginRuntime.listDisabledPluginIds().length}`;
        }
        this.#pluginHeaders.renderAll();
      });
    };
    this.#pluginDocuments = new DesktopPluginDocumentHub(
      onPluginFailure,
      (edit) => this.#applyPluginActiveEdit(edit),
      () => {
        const panes = this.#panes.state;
        return [panes.primary.session, panes.secondary.session].filter((session) => null !== session);
      }
    );
    this.#pluginExtensions = new DesktopPluginExtensionHost(onPluginFailure);
    this.#pluginEditor = new DesktopPluginEditorHost();
    this.#pluginHeaders = new DesktopDocumentHeaderHost({
      document: this.#document,
      containers: {
        primary: this.#primaryPluginHeaders,
        secondary: this.#secondaryPluginHeaders
      },
      getSnapshot: (paneId) => {
        const session = this.#panes.state[paneId].session;
        return session ? snapshotFromSession(session) : null;
      },
      onFailure: onPluginFailure
    });
    let browserStorage = null;
    if (void 0 !== options.pluginKeyValueStorage) {
      browserStorage = options.pluginKeyValueStorage;
    } else {
      try {
        browserStorage = options.window.localStorage;
      } catch {
        browserStorage = null;
      }
    }
    if (options.workspaceIdentityProvider) {
      this.#workspaceIdentity = null;
    } else {
      let hostCrypto = null;
      try {
        hostCrypto = options.window.crypto;
      } catch {
        hostCrypto = null;
      }
      this.#workspaceIdentity = new DesktopWorkspaceIdentity(this.#bridge, hostCrypto);
    }
    const workspaceIdentity = options.workspaceIdentityProvider ?? this.#workspaceIdentity?.get ?? (async () => null);
    this.#pluginStorage = new DesktopPluginStorageManager(browserStorage, workspaceIdentity);
    this.#pluginCommands = new DesktopPluginCommandHost({
      document: this.#document,
      window: this.#window,
      container: pluginCommands,
      onFailure: onPluginFailure
    });
    this.#pluginAssets = new DesktopPluginAssetHost({ bridge: this.#bridge });
    this.#pluginViews = new DesktopPluginViewHost({
      document: this.#document,
      container: this.#root,
      onFailure: onPluginFailure,
      imageResolver: this.#pluginAssets
    });
    this.#pluginWorkspace = new DesktopPluginWorkspaceHost({
      bridge: this.#bridge,
      workspaceAdapter: this.#workspaceAdapter,
      window: this.#window,
      onFailure: onPluginFailure
    });
    const pluginNavigation = new DesktopPluginNavigationHost(
      (path, navigationOptions) => this.#openMarkdownFromPlugin(path, navigationOptions)
    );
    const pluginVcs = new DesktopPluginVcsHost(this.#bridge);
    const pluginHost = new DesktopPluginHost({
      commands: this.#pluginCommands,
      documents: this.#pluginDocuments,
      editor: this.#pluginEditor,
      extensions: this.#pluginExtensions,
      headers: this.#pluginHeaders,
      navigation: pluginNavigation,
      storage: this.#pluginStorage,
      views: this.#pluginViews,
      vcs: pluginVcs,
      workspace: this.#pluginWorkspace
    });
    pluginRuntime = new InProcessPluginRuntime(pluginHost);
    this.#pluginRuntime = pluginRuntime;
    this.#fileSelect.addEventListener("change", () => {
      if (this.#fileSelect.value) {
        this.#pathInput.value = this.#fileSelect.value;
      }
    });
    this.#pathInput.addEventListener("keydown", (event) => {
      if ("Enter" === event.key) {
        void this.openDocument();
      }
    });
    refreshButton.addEventListener("click", () => {
      void this.refreshFiles();
    });
    chooseButton.addEventListener("click", () => {
      void this.chooseWorkspace();
    });
    this.#openButton.addEventListener("click", () => {
      void this.openDocument();
    });
    this.#splitButton.addEventListener("click", () => {
      void this.openDocumentInSplit();
    });
    this.#saveButton.addEventListener("click", () => {
      this.#activatePane("primary");
      void this.saveDocument();
    });
    this.#diffButton.addEventListener("click", () => {
      this.toggleDiff("primary");
    });
    this.#secondarySaveButton.addEventListener("click", () => {
      this.#activatePane("secondary");
      void this.saveDocument();
    });
    this.#secondaryDiffButton.addEventListener("click", () => {
      this.toggleDiff("secondary");
    });
    this.#closeSecondaryButton.addEventListener("click", () => {
      this.closeSecondaryPane();
    });
    this.#primaryPane.addEventListener("focusin", () => {
      this.#activatePane("primary");
    });
    this.#primaryPane.addEventListener("pointerdown", () => {
      this.#activatePane("primary");
    });
    this.#secondaryPane.addEventListener("focusin", () => {
      this.#activatePane("secondary");
    });
    this.#secondaryPane.addEventListener("pointerdown", () => {
      this.#activatePane("secondary");
    });
    this.#reloadConflictButton.addEventListener("click", () => {
      void this.reloadConflictFromDisk();
    });
    this.#keepConflictRecoveryButton.addEventListener("click", () => {
      void this.keepConflictRecovery();
    });
    this.#continueConflictButton.addEventListener("click", () => {
      this.#activeEditor()?.focus();
      this.#renderSessionState("Conflict retained \xB7 editing may continue, but save stays disabled");
    });
    this.#restoreRecoveryButton.addEventListener("click", () => {
      void this.restoreNextRecovery();
    });
    this.#laterRecoveryButton.addEventListener("click", () => {
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
    });
    this.#discardRecoveryButton.addEventListener("click", () => {
      void this.discardNextRecovery();
    });
    this.#window.addEventListener("blur", this.#onWindowBlur);
    this.#window.addEventListener("resize", this.#onWindowResize);
    this.#syncSecondaryAvailability();
    if ("native-hints" === this.#workspaceAdapter.capabilities.externalWatch) {
      this.#watchSubscription = registry.bindWorkspaceWatch(
        this.#workspaceAdapter,
        (refresh) => this.#handleWorkspaceRefresh(refresh)
      );
    }
  }
  mount() {
    if (this.#disposed) {
      throw new Error("Cannot mount a disposed desktop application");
    }
    this.#document.body.replaceChildren(this.#root);
    void this.#installWindowLifecycle();
    void this.#installUpdaterHandshake();
    void this.#installBundledPlugins();
    void this.discoverRecovery();
  }
  prepareForRestart() {
    if (this.#disposed) {
      throw new Error("Cannot prepare a disposed desktop application");
    }
    return this.#recovery.prepareForRestart();
  }
  /** Called only after an application-owned rename succeeds; external renames never use it. */
  migratePluginDocumentStorage(previousPath, nextPath) {
    return this.#pluginStorage.migrateDocumentPath(
      workspacePath(previousPath),
      workspacePath(nextPath)
    );
  }
  async discoverRecovery() {
    try {
      const workspacePath2 = await this.#bridge.invoke("workspace_get_path", {});
      if (null === workspacePath2) {
        this.#pendingRecovery = [];
        this.#renderRecoveryPrompt();
        return;
      }
      if ("string" !== typeof workspacePath2 || "" === workspacePath2) {
        throw new Error("Workspace binding response is malformed");
      }
      this.#pendingRecovery = [...await this.#recoveryStore.list()];
      this.#renderRecoveryPrompt();
      if (0 < this.#pendingRecovery.length) {
        this.#runtimeStatus.textContent = `${this.#pendingRecovery.length} unresolved recovery cop${1 === this.#pendingRecovery.length ? "y" : "ies"}`;
      }
    } catch (error) {
      this.#pendingRecovery = [];
      this.#renderRecoveryPrompt();
      this.#runtimeStatus.textContent = `Recovery check error: ${messageFrom2(error)}`;
    }
  }
  async restoreNextRecovery() {
    if (this.#busy) {
      return;
    }
    const loaded = this.#pendingRecovery[0];
    if (!loaded) {
      return;
    }
    if (this.#panes.registry.get(loaded.record.pathKey)) {
      this.#runtimeStatus.textContent = "Recovery restore blocked because the document is already open";
      return;
    }
    this.#setBusy(true, "Restoring recovery\u2026");
    try {
      const read = await this.#workspaceAdapter.read(loaded.record.path);
      if (!read.ok) {
        this.#runtimeStatus.textContent = `Recovery read error: ${read.error.kind}: ${read.error.message}`;
        return;
      }
      if (read.snapshot.pathKey !== loaded.record.pathKey) {
        throw new Error("Recovery document identity no longer matches the workspace file");
      }
      const opened = this.#panes.open(read.snapshot, this.#workspaceAdapter, {
        target: "primary"
      });
      this.#saveLayoutPreference();
      this.#untrackSession(opened.releasedSession);
      const outcome = opened.session.restoreRecovery(loaded.record);
      this.#trackSession(opened.session);
      this.#bindSession(
        opened.paneId,
        opened.session,
        "conflict" === outcome.kind ? "Recovery restored with an external-change conflict" : "stale" === outcome.kind ? "Recovery already matches disk" : `Recovery restored from ${loaded.generation}`
      );
      if ("stale" === outcome.kind) {
        await this.#recoveryStore.remove(loaded.record.pathKey);
      }
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
    } catch (error) {
      this.#runtimeStatus.textContent = `Recovery restore error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async discardNextRecovery() {
    if (this.#busy) {
      return;
    }
    const loaded = this.#pendingRecovery[0];
    if (!loaded) {
      return;
    }
    if (!this.#window.confirm(`Discard recovery for ${loaded.record.path}?`)) {
      return;
    }
    this.#setBusy(true, "Discarding recovery\u2026");
    try {
      await this.#recoveryStore.remove(loaded.record.pathKey);
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
      this.#runtimeStatus.textContent = "Recovery discarded";
    } catch (error) {
      this.#runtimeStatus.textContent = `Recovery discard error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async chooseWorkspace() {
    if (this.#busy) {
      return;
    }
    if (0 < this.#pendingRecovery.length) {
      this.#runtimeStatus.textContent = "Resolve or defer recovery prompts before changing workspace";
      return;
    }
    if (0 < this.#panes.registry.list().length) {
      this.#runtimeStatus.textContent = "Workspace change blocked while document sessions are open";
      return;
    }
    this.#setBusy(true, "Choosing workspace\u2026");
    try {
      const selected = await this.#bridge.invoke("workspace_pick_and_bind", {});
      if (null === selected) {
        this.#runtimeStatus.textContent = "Workspace selection cancelled";
        return;
      }
      if ("string" !== typeof selected || "" === selected) {
        throw new Error("Workspace binding result is malformed");
      }
      this.#workspaceIdentity?.invalidate();
      this.#pluginWorkspace.notifyWorkspaceReset();
      this.#pluginAssets.notifyWorkspaceReset();
      this.#runtimeStatus.textContent = "Workspace bound \xB7 choose a Markdown document";
      await this.#refreshFilesWhileBusy();
      await this.discoverRecovery();
    } catch (error) {
      this.#runtimeStatus.textContent = `Workspace error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async refreshFiles() {
    if (this.#busy) {
      return;
    }
    this.#setBusy(true, "Loading workspace files\u2026");
    try {
      await this.#refreshFilesWhileBusy();
    } catch (error) {
      this.#runtimeStatus.textContent = `Workspace error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async openDocument() {
    await this.#openDocumentAt("active");
  }
  async openDocumentInSplit() {
    await this.#openDocumentAt("secondary");
  }
  async #openMarkdownFromPlugin(path, options) {
    await this.#openDocumentAt(
      "secondary-pane" === options.placement ? "secondary" : "active",
      path,
      options.focus ?? true
    );
  }
  async #openWikiLink(paneId, rawTarget) {
    const withoutAnchor = rawTarget.split("#", 1)[0]?.trim() ?? "";
    if ("" === withoutAnchor || 512 < withoutAnchor.length || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\\)/u.test(withoutAnchor) || withoutAnchor.includes("\0")) {
      this.#statusForPane(paneId).textContent = "Wiki link target is invalid";
      return;
    }
    const markdownTarget = withoutAnchor.toLocaleLowerCase("en-US").endsWith(".md") ? withoutAnchor : `${withoutAnchor}.md`;
    let path = markdownTarget;
    if (!markdownTarget.includes("/")) {
      const match = [...this.#fileSelect.options].find((option) => option.value.split("/").at(-1)?.toLocaleLowerCase("en-US") === markdownTarget.toLocaleLowerCase("en-US"));
      path = match?.value ?? markdownTarget;
    } else {
      const currentPath = this.#panes.state[paneId].session?.state.path;
      const directory = currentPath?.split("/").slice(0, -1).join("/") ?? "";
      path = "" === directory ? markdownTarget : `${directory}/${markdownTarget}`;
    }
    try {
      path = workspacePath(path);
    } catch {
      this.#statusForPane(paneId).textContent = "Wiki link escapes the workspace";
      return;
    }
    this.#activatePane(paneId);
    await this.#openMarkdownFromPlugin(path, {
      placement: "secondary" === paneId ? "secondary-pane" : "active-pane",
      focus: true
    });
  }
  async #applyPluginActiveEdit(edit) {
    const session = this.#currentSession;
    if (!session || session.state.path !== edit.path || session.state.bufferVersion !== edit.expectedBufferVersion) {
      return {
        status: "stale",
        current: session ? snapshotFromSession(session) : null
      };
    }
    if ("read-only" === session.state.savedSnapshot.access.kind) {
      return {
        status: "read-only",
        message: session.state.savedSnapshot.access.message
      };
    }
    const before = session.state.buffer;
    const paneViews = ["primary", "secondary"].flatMap((paneId) => {
      const editor = "primary" === paneId ? this.#editor : this.#secondaryEditor;
      return editor && this.#panes.state[paneId].session === session ? [{ editor, view: editor.captureView() }] : [];
    });
    session.edit(edit.content);
    this.#syncSessionBindings(session);
    for (const { editor, view } of paneViews) {
      editor.restoreView(remapViewAfterContentReplacement(view, before, edit.content));
    }
    this.#pluginDocuments.emit("change", session);
    this.#refreshDiffForSession(session);
    this.#renderSessionState("Metadata updated in the editor \xB7 save to persist");
    void this.#recovery.notifyChanged(session).catch((error) => {
      this.#activeDocumentStatus().textContent = `Metadata updated, but recovery scheduling failed: ${messageFrom2(error)}`;
    });
    return { status: "applied", snapshot: snapshotFromSession(session) };
  }
  async #rollbackMediaAsset(receipt) {
    try {
      const result = decodeMediaRollbackResult(await this.#bridge.invoke(
        "workspace_rollback_media_asset",
        { request: { schemaVersion: 1, receipt } }
      ));
      return "retained" === result.status ? `${result.kind}: ${result.message}` : null;
    } catch (error) {
      return messageFrom2(error);
    }
  }
  async #insertMedia(paneId, input) {
    const session = this.#panes.state[paneId].session;
    if (!session) {
      throw new Error("No document is open in this pane");
    }
    const initial = session.state;
    if ("read-only" === initial.savedSnapshot.access.kind) {
      throw new Error(initial.savedSnapshot.access.message);
    }
    if (this.#mediaTransactions.has(session)) {
      throw new Error("Another media insertion is still running for this document");
    }
    if (0 >= input.file.size || MEDIA_INSERT_LIMITS.maxFileBytes < input.file.size) {
      throw new Error("Media file is empty or exceeds the file limit");
    }
    const originEditor = "primary" === paneId ? this.#editor : this.#secondaryEditor;
    if (!originEditor) {
      throw new Error("The editor is unavailable");
    }
    const paneViews = ["primary", "secondary"].flatMap((candidatePaneId) => {
      const editor = "primary" === candidatePaneId ? this.#editor : this.#secondaryEditor;
      return editor && this.#panes.state[candidatePaneId].session === session ? [{ paneId: candidatePaneId, editor, view: editor.captureView() }] : [];
    });
    this.#mediaTransactions.add(session);
    for (const { editor } of paneViews) {
      editor.setReadOnly(true);
    }
    this.#statusForPane(paneId).textContent = `${"paste" === input.source ? "Pasting" : "Dropping"} media\u2026`;
    let receipt = null;
    try {
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      if (bytes.byteLength !== input.file.size) {
        throw new Error("Media file changed while it was being read");
      }
      const contentBase64 = encodeMediaBase64(bytes);
      if (this.#panes.state[paneId].session !== session || session.state.path !== initial.path || session.state.bufferVersion !== initial.bufferVersion || session.state.buffer !== initial.buffer) {
        throw new Error("Document changed before media insertion");
      }
      const createdAt = /* @__PURE__ */ new Date();
      for (let attempt = 0; attempt < MEDIA_INSERT_LIMITS.maxCollisionAttempts; attempt += 1) {
        const path = createMediaAssetPath(input.file.name, input.file.type, createdAt, attempt);
        const result = decodeMediaWriteResult(await this.#bridge.invoke(
          "workspace_write_media_asset",
          {
            request: {
              schemaVersion: 1,
              path,
              mimeType: input.file.type.toLocaleLowerCase("en-US"),
              contentBase64
            }
          }
        ));
        if ("written" === result.status) {
          receipt = result.receipt;
          break;
        }
        if ("already-exists" !== result.kind) {
          throw new Error(`${result.kind}: ${result.message}`);
        }
      }
      if (!receipt) {
        throw new Error("Unable to allocate a unique media filename");
      }
      if (this.#panes.state[paneId].session !== session || session.state.path !== initial.path || session.state.bufferVersion !== initial.bufferVersion || session.state.buffer !== initial.buffer) {
        throw new Error("Document changed while the media asset was being written");
      }
      const edit = applyMediaMarkdownEdit(
        initial.buffer,
        input.selectionAnchor,
        input.selectionHead,
        markdownMediaLink(receipt.path, input.file.name)
      );
      session.edit(edit.content);
      const insertedVersion = session.state.bufferVersion;
      this.#syncSessionBindings(session);
      for (const { editor } of paneViews) {
        editor.setReadOnly(true);
      }
      for (const { paneId: candidatePaneId, editor, view } of paneViews) {
        editor.restoreView(candidatePaneId === paneId ? {
          ...view,
          selectionAnchor: edit.cursor,
          selectionHead: edit.cursor,
          focused: true
        } : remapViewAfterContentReplacement(view, initial.buffer, edit.content));
      }
      this.#pluginDocuments.emit("change", session);
      this.#refreshDiffForSession(session);
      let recoveryError = null;
      try {
        const outcome = await this.#recovery.flush(session, "manual");
        if ("persisted" !== outcome.kind) {
          recoveryError = "error" === outcome.kind ? outcome.message : "superseded" === outcome.kind ? "the document changed during recovery persistence" : "the media link did not require a recovery record";
        }
      } catch (error) {
        recoveryError = messageFrom2(error);
      }
      if (recoveryError) {
        const current = session.state;
        if (current.bufferVersion === insertedVersion && current.buffer === edit.content) {
          session.edit(initial.buffer);
          this.#syncSessionBindings(session);
          for (const { editor } of paneViews) {
            editor.setReadOnly(true);
          }
          for (const { editor, view } of paneViews) {
            editor.restoreView(view);
          }
          this.#pluginDocuments.emit("change", session);
          this.#refreshDiffForSession(session);
          try {
            await this.#recovery.flush(session, "manual");
          } catch {
          }
          const rollbackError = await this.#rollbackMediaAsset(receipt);
          receipt = null;
          throw new Error(
            `Recovery persistence failed: ${recoveryError}` + (rollbackError ? `; media rollback was retained: ${rollbackError}` : "")
          );
        }
        receipt = null;
        throw new Error(
          `Recovery persistence did not complete after a concurrent edit: ${recoveryError}; the media asset was retained`
        );
      }
      receipt = null;
      this.#renderSessionState("Media inserted \xB7 recovery copy updated \xB7 save to persist");
    } catch (error) {
      if (receipt) {
        const rollbackError = await this.#rollbackMediaAsset(receipt);
        receipt = null;
        if (rollbackError) {
          throw new Error(`${messageFrom2(error)}; media rollback was retained: ${rollbackError}`);
        }
      }
      throw error;
    } finally {
      this.#mediaTransactions.delete(session);
      this.#syncSessionBindings(session);
    }
  }
  async #openDocumentAt(target, requestedPath, focus = true) {
    if (this.#busy) {
      return;
    }
    this.#setBusy(true, "secondary" === target ? "Opening split document\u2026" : "Opening document\u2026");
    try {
      const path = workspacePath(requestedPath ?? this.#pathInput.value.trim());
      this.#pathInput.value = path;
      const result = await this.#workspaceAdapter.read(path);
      if (!result.ok) {
        this.#activeDocumentStatus().textContent = `${result.error.kind}: ${result.error.message}`;
        return;
      }
      const resolvedTarget = "active" === target ? this.#panes.state.activePane : target;
      this.#closeDiff(resolvedTarget);
      this.#capturePaneView(resolvedTarget);
      const opened = this.#panes.open(result.snapshot, this.#workspaceAdapter, {
        target
      });
      this.#saveLayoutPreference();
      this.#untrackSession(opened.releasedSession);
      this.#trackSession(opened.session);
      this.#bindSession(
        opened.paneId,
        opened.session,
        opened.fellBackToPrimary ? "Split is unavailable at this width \xB7 opened in primary" : opened.reusedSession ? "Open session reused" : "Document opened",
        focus
      );
    } catch (error) {
      this.#activeDocumentStatus().textContent = `Open error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async saveDocument() {
    if (this.#busy || !this.#currentSession) {
      return;
    }
    const session = this.#currentSession;
    this.#setBusy(true, "Saving\u2026");
    try {
      const outcome = await session.save();
      await this.#recovery.notifyChanged(session);
      this.#syncSessionBindings(session);
      if ("conflict" === outcome.kind) {
        this.#closeDiffForSession(session);
      } else {
        this.#refreshDiffForSession(session);
      }
      if ("saved" === outcome.kind || "still-dirty" === outcome.kind) {
        this.#pluginDocuments.emit("save", session);
      }
      if ("saved" === outcome.kind) {
        this.#renderSessionState("Saved");
      } else if ("still-dirty" === outcome.kind) {
        this.#renderSessionState("Saved one revision; newer edits remain");
      } else if ("conflict" === outcome.kind) {
        this.#renderSessionState("Save blocked by an external change");
      } else if ("error" === outcome.kind) {
        this.#renderSessionState(`Save error: ${outcome.message}`);
      } else {
        this.#renderSessionState("No changes to save");
      }
    } catch (error) {
      this.#activeDocumentStatus().textContent = `Save error: ${messageFrom2(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }
  async reloadConflictFromDisk() {
    if (this.#busy || !this.#currentSession?.state.conflict) {
      return;
    }
    const session = this.#currentSession;
    if (!this.#window.confirm(
      `Reload ${session.state.path} from disk and discard the current editor buffer?`
    )) {
      return;
    }
    this.#setBusy(true, "Reloading disk after conflict\u2026");
    try {
      const result = await this.#workspaceAdapter.read(session.state.path);
      if (!result.ok) {
        this.#renderSessionState(
          `Reload blocked: ${result.error.kind}: ${result.error.message}`
        );
        return;
      }
      if (result.snapshot.pathKey !== session.state.pathKey) {
        throw new Error("Reloaded document identity no longer matches the open session");
      }
      session.reloadFromDisk(result.snapshot);
      const recovery = await this.#recovery.notifyChanged(session);
      this.#syncSessionBindings(session);
      this.#pluginDocuments.emit("change", session);
      this.#refreshDiffForSession(session);
      this.#renderSessionState(
        "error" === recovery?.kind ? `Disk reloaded, but recovery cleanup failed: ${recovery.message}` : "Disk reloaded \xB7 previous editor buffer discarded"
      );
    } catch (error) {
      this.#renderSessionState(`Reload error: ${messageFrom2(error)}`);
    } finally {
      this.#setBusy(false);
    }
  }
  async keepConflictRecovery() {
    if (this.#busy || !this.#currentSession?.state.conflict) {
      return;
    }
    const session = this.#currentSession;
    this.#setBusy(true, "Writing recovery copy\u2026");
    try {
      const outcome = await this.#recovery.flush(session, "manual");
      if ("persisted" === outcome.kind) {
        this.#renderSessionState("Recovery copy updated \xB7 conflict remains unresolved");
      } else if ("superseded" === outcome.kind) {
        this.#renderSessionState("Buffer changed during recovery write \xB7 write recovery again");
      } else if ("error" === outcome.kind) {
        this.#renderSessionState(`Recovery error: ${outcome.message}`);
      } else {
        this.#renderSessionState("No recovery copy was required");
      }
    } catch (error) {
      this.#renderSessionState(`Recovery error: ${messageFrom2(error)}`);
    } finally {
      this.#setBusy(false);
    }
  }
  toggleDiff(paneId = this.#panes.state.activePane) {
    if (this.#busy) {
      return;
    }
    const session = this.#panes.state[paneId].session;
    if (!session) {
      return;
    }
    this.#activatePane(paneId);
    const view = this.#diffForPane(paneId);
    if (view.isOpen) {
      this.#closeDiff(paneId);
      this.#renderSessionState("Diff closed \xB7 editor view restored");
      return;
    }
    const state = session.state;
    if (state.conflict) {
      this.#renderSessionState("Diff unavailable while the document has a conflict");
      return;
    }
    if ("saving" === state.saveState.kind) {
      this.#renderSessionState("Diff unavailable while the document is saving");
      return;
    }
    if ("error" === state.saveState.kind) {
      this.#renderSessionState("Diff unavailable while the document has a save error");
      return;
    }
    this.#capturePaneView(paneId);
    this.#editorHostForPane(paneId).hidden = true;
    view.open(session);
    this.#renderSessionState("Read-only diff \xB7 saved snapshot vs current buffer");
  }
  closeSecondaryPane() {
    if (this.#busy || !this.#panes.state.secondaryVisible) {
      return;
    }
    this.#closeDiff("secondary", false);
    this.#capturePaneView("secondary");
    this.#disposePaneBinding("secondary");
    if (this.#secondaryEditor) {
      this.#codeMirrorDocuments.detach("secondary", this.#secondaryEditor);
    }
    const closed = this.#panes.closeSecondary();
    this.#saveLayoutPreference();
    if (closed?.released) {
      this.#untrackSession(closed.session);
    }
    const primary = this.#panes.state.primary.session;
    this.#currentSession = primary;
    if (primary) {
      this.#pathInput.value = primary.state.path;
    }
    this.#renderSessionState("Split closed");
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#window.removeEventListener("blur", this.#onWindowBlur);
    this.#window.removeEventListener("resize", this.#onWindowResize);
    void this.#closeSubscription?.dispose();
    this.#closeSubscription = null;
    void this.#updaterHandshakeSubscription?.dispose();
    this.#updaterHandshakeSubscription = null;
    void this.#watchSubscription?.dispose();
    this.#watchSubscription = null;
    this.#sessionBinding?.dispose();
    this.#sessionBinding = null;
    this.#secondarySessionBinding?.dispose();
    this.#secondarySessionBinding = null;
    this.#editorSaveBinding?.dispose();
    this.#editorSaveBinding = null;
    this.#editorPluginBinding?.dispose();
    this.#editorPluginBinding = null;
    this.#secondaryEditorSaveBinding?.dispose();
    this.#secondaryEditorSaveBinding = null;
    this.#secondaryEditorPluginBinding?.dispose();
    this.#secondaryEditorPluginBinding = null;
    this.#diffView.dispose();
    this.#secondaryDiffView.dispose();
    void this.#pluginRuntime.deactivateAll().catch(() => {
    });
    this.#pluginCommands.dispose();
    this.#pluginViews.dispose();
    this.#pluginAssets.dispose();
    this.#pluginWorkspace.dispose();
    this.#pluginEditor.dispose();
    this.#pluginExtensions.dispose();
    this.#pluginHeaders.dispose();
    this.#codeMirrorDocuments.dispose();
    this.#editor?.dispose();
    this.#editor = null;
    this.#secondaryEditor?.dispose();
    this.#secondaryEditor = null;
    for (const tracked of this.#trackedSessions.values()) {
      tracked.dispose();
    }
    this.#trackedSessions.clear();
    this.#recovery.dispose();
    this.#panes.dispose();
  }
  async #installBundledPlugins() {
    try {
      const catalog = await this.#bundledPluginCatalogLoader();
      if (this.#disposed) {
        return;
      }
      const results = await this.#pluginRuntime.activateBundledCatalog(catalog);
      if (this.#disposed) {
        await this.#pluginRuntime.deactivateAll();
        return;
      }
      const disabled = results.filter((result) => "disabled" === result.kind).length;
      this.#root.dataset.plugins = 0 === disabled ? "ready" : `disabled:${disabled}`;
      this.#pluginHeaders.renderAll();
    } catch {
      if (!this.#disposed) {
        this.#root.dataset.plugins = "catalog-error";
      }
    }
  }
  async #installWindowLifecycle() {
    if (this.#lifecycleRegistrationStarted) {
      return;
    }
    this.#lifecycleRegistrationStarted = true;
    try {
      const subscription = await this.#windowLifecycle.onCloseRequested(
        (event) => this.#handleCloseRequested(event)
      );
      if (this.#disposed) {
        await subscription.dispose();
        return;
      }
      this.#closeSubscription = subscription;
    } catch (error) {
      if (!this.#disposed) {
        this.#runtimeStatus.textContent = `Close protection error: ${messageFrom2(error)}`;
      }
    }
  }
  async #installUpdaterHandshake() {
    if (this.#updaterHandshakeRegistrationStarted) {
      return;
    }
    this.#updaterHandshakeRegistrationStarted = true;
    try {
      const subscription = await installUpdaterRestartHandshake(
        this.#bridge,
        () => this.prepareForRestart()
      );
      if (this.#disposed) {
        await subscription.dispose();
        return;
      }
      this.#updaterHandshakeSubscription = subscription;
    } catch (error) {
      if (!this.#disposed) {
        this.#runtimeStatus.textContent = `Updater restart protection unavailable: ${messageFrom2(error)}`;
      }
    }
  }
  async #handleCloseRequested(event) {
    event.preventDefault();
    if (this.#disposed || this.#closing) {
      return;
    }
    this.#closing = true;
    this.#setBusy(true, "Preparing recovery before close\u2026");
    try {
      const result = await this.prepareForRestart();
      if ("blocked" === result.kind) {
        this.#runtimeStatus.textContent = `Close blocked: ${result.reasons.map((reason) => this.#describeRestartBlocker(reason)).join("; ")}`;
        return;
      }
      await this.#windowLifecycle.destroy();
      this.dispose();
    } catch (error) {
      this.#runtimeStatus.textContent = `Close blocked: ${messageFrom2(error)}`;
    } finally {
      this.#closing = false;
      if (!this.#disposed) {
        this.#setBusy(false);
      }
    }
  }
  #describeRestartBlocker(reason) {
    const session = [...this.#trackedSessions.keys()].find(
      (candidate) => candidate.state.pathKey === reason.pathKey
    );
    const path = session?.state.path ?? "unknown document";
    switch (reason.kind) {
      case "conflict":
        return `${path} has an unresolved conflict`;
      case "save-in-progress":
        return `${path} is still saving`;
      case "save-error":
        return `${path} has a save error: ${reason.message}`;
      case "recovery-error":
        return `${path} has a recovery error: ${reason.message}`;
      case "recovery-not-current":
        return `${path} recovery is not current`;
    }
  }
  async #refreshFilesWhileBusy() {
    const files = decodeWorkspaceFiles(
      await this.#bridge.invoke("workspace_list_files", {})
    );
    this.#replaceFileOptions(files);
    this.#runtimeStatus.textContent = `${files.length} Markdown document${1 === files.length ? "" : "s"}`;
  }
  #replaceFileOptions(files) {
    const placeholder = element3(this.#document, "option", { text: "Choose a Markdown file\u2026" });
    placeholder.value = "";
    const options = files.map(({ path }) => {
      const option = element3(this.#document, "option", { text: path });
      option.value = path;
      return option;
    });
    this.#fileSelect.replaceChildren(placeholder, ...options);
  }
  #ensureEditor(paneId) {
    if ("primary" === paneId) {
      if (this.#editor) {
        return this.#editor;
      }
      const textarea2 = element3(this.#document, "textarea", { id: "v2-editor-textarea" });
      textarea2.setAttribute("aria-label", "Primary Markdown editor");
      this.#editorHost.replaceChildren(textarea2);
      this.#editor = new CodeMirrorTextEditor(textarea2, {
        onOpenWikiLink: (target) => {
          void this.#openWikiLink("primary", target);
        },
        onInsertMedia: (input) => this.#insertMedia("primary", input),
        resolveMedia: (path) => this.#pluginAssets.resolveMedia(path),
        onDiagnostic: (message) => {
          this.#documentStatus.textContent = message;
        }
      });
      this.#editorPluginBinding = this.#pluginEditor.attach(this.#editor);
      this.#editorSaveBinding = this.#editor.bindSave(() => {
        this.#activatePane("primary");
        void this.saveDocument();
      });
      return this.#editor;
    }
    if (this.#secondaryEditor) {
      return this.#secondaryEditor;
    }
    const textarea = element3(this.#document, "textarea", {
      id: "v2-secondary-editor-textarea"
    });
    textarea.setAttribute("aria-label", "Secondary Markdown editor");
    this.#secondaryEditorHost.replaceChildren(textarea);
    this.#secondaryEditor = new CodeMirrorTextEditor(textarea, {
      onOpenWikiLink: (target) => {
        void this.#openWikiLink("secondary", target);
      },
      onInsertMedia: (input) => this.#insertMedia("secondary", input),
      resolveMedia: (path) => this.#pluginAssets.resolveMedia(path),
      onDiagnostic: (message) => {
        this.#secondaryDocumentStatus.textContent = message;
      }
    });
    this.#secondaryEditorPluginBinding = this.#pluginEditor.attach(this.#secondaryEditor);
    this.#secondaryEditorSaveBinding = this.#secondaryEditor.bindSave(() => {
      this.#activatePane("secondary");
      void this.saveDocument();
    });
    return this.#secondaryEditor;
  }
  #trackSession(session) {
    if (this.#trackedSessions.has(session)) {
      return;
    }
    const recovery = this.#recovery.track(session);
    const nativeWatch = trackNativeDocument(this.#workspaceAdapter, session);
    this.#trackedSessions.set(session, {
      dispose: async () => {
        recovery.dispose();
        await nativeWatch.dispose();
      }
    });
  }
  #untrackSession(session) {
    if (!session) {
      return;
    }
    this.#trackedSessions.get(session)?.dispose();
    this.#trackedSessions.delete(session);
    this.#codeMirrorDocuments.release(session);
  }
  #bindSession(paneId, session, message, focus = true) {
    this.#closeDiff(paneId, false);
    this.#currentSession = session;
    this.#pathInput.value = session.state.path;
    const editor = this.#ensureEditor(paneId);
    this.#disposePaneBinding(paneId);
    this.#codeMirrorDocuments.attach(paneId, editor, session);
    const binding = new SessionEditorBinding(session, editor, {
      onEdited: (edited) => {
        void this.#recovery.notifyChanged(edited).catch((error) => {
          this.#statusForPane(paneId).textContent = `Recovery error: ${messageFrom2(error)}`;
        });
        this.#syncSessionBindings(edited);
        this.#pluginDocuments.emit("change", edited);
        this.#refreshDiffForSession(edited);
        this.#renderSessionState();
      },
      onReadOnlyEdit: (error) => {
        this.#statusForPane(paneId).textContent = error.message;
      }
    });
    if ("primary" === paneId) {
      this.#sessionBinding = binding;
    } else {
      this.#secondarySessionBinding = binding;
    }
    editor.restoreView(this.#panes.state[paneId].view);
    if (focus) {
      editor.focus();
    }
    this.#pluginDocuments.emit("open", session);
    this.#renderSessionState(message);
  }
  #disposePaneBinding(paneId) {
    if ("primary" === paneId) {
      this.#sessionBinding?.dispose();
      this.#sessionBinding = null;
      return;
    }
    this.#secondarySessionBinding?.dispose();
    this.#secondarySessionBinding = null;
  }
  #capturePaneView(paneId) {
    const state = this.#panes.state[paneId];
    const editor = "primary" === paneId ? this.#editor : this.#secondaryEditor;
    if (!state.session || !editor) {
      return;
    }
    this.#panes.updateView(paneId, editor.captureView());
  }
  #syncSessionBindings(session) {
    if (this.#sessionBinding?.session === session) {
      this.#sessionBinding.syncFromSession();
    }
    if (this.#secondarySessionBinding?.session === session) {
      this.#secondarySessionBinding.syncFromSession();
    }
  }
  #diffForPane(paneId) {
    return "primary" === paneId ? this.#diffView : this.#secondaryDiffView;
  }
  #editorHostForPane(paneId) {
    return "primary" === paneId ? this.#editorHost : this.#secondaryEditorHost;
  }
  #closeDiff(paneId, restoreView = true) {
    const view = this.#diffForPane(paneId);
    if (!view.isOpen) {
      return;
    }
    view.close();
    this.#editorHostForPane(paneId).hidden = false;
    if (!restoreView) {
      return;
    }
    const editor = "primary" === paneId ? this.#editor : this.#secondaryEditor;
    if (editor) {
      editor.restoreView(this.#panes.state[paneId].view);
    }
  }
  #refreshDiffForSession(session) {
    for (const paneId of ["primary", "secondary"]) {
      const view = this.#diffForPane(paneId);
      if (view.isOpen && view.session === session) {
        view.refresh(session);
      }
    }
  }
  #closeDiffForSession(session) {
    for (const paneId of ["primary", "secondary"]) {
      const view = this.#diffForPane(paneId);
      if (view.isOpen && view.session === session) {
        this.#closeDiff(paneId);
      }
    }
  }
  #activeEditor() {
    return "primary" === this.#panes.state.activePane ? this.#editor : this.#secondaryEditor;
  }
  #activeDocumentStatus() {
    return this.#statusForPane(this.#panes.state.activePane);
  }
  #statusForPane(paneId) {
    return "primary" === paneId ? this.#documentStatus : this.#secondaryDocumentStatus;
  }
  #activatePane(paneId) {
    const session = this.#panes.state[paneId].session;
    if ("secondary" === paneId && (!this.#panes.state.secondaryAvailable || !this.#panes.state.secondaryVisible)) {
      return;
    }
    const previousPane = this.#panes.state.activePane;
    if (previousPane !== paneId) {
      this.#capturePaneView(previousPane);
    }
    this.#panes.activate(paneId);
    this.#currentSession = session;
    if (session) {
      this.#pathInput.value = session.state.path;
    }
    if (session) {
      this.#pluginDocuments.emit("activatePane", session);
    }
    this.#saveLayoutPreference();
    this.#renderSessionState();
  }
  #loadLayoutPreference() {
    try {
      return this.#layoutPreferenceStore.load();
    } catch {
      return null;
    }
  }
  #saveLayoutPreference() {
    try {
      this.#layoutPreferenceStore.save(this.#panes.layoutPreference);
    } catch {
    }
  }
  #syncSecondaryAvailability() {
    const width = this.#window.innerWidth;
    const available = !Number.isFinite(width) || 670 < width;
    const wasActive = this.#panes.state.activePane;
    if (!available && "secondary" === wasActive) {
      this.#capturePaneView("secondary");
    }
    if (!available) {
      this.#closeDiff("secondary", false);
    }
    this.#panes.setSecondaryAvailable(available);
    const activePane = this.#panes.state.activePane;
    this.#currentSession = this.#panes.state[activePane].session;
    if (this.#currentSession) {
      this.#pathInput.value = this.#currentSession.state.path;
    }
    if (this.#currentSession && wasActive !== activePane) {
      this.#pluginDocuments.emit("activatePane", this.#currentSession);
    }
    this.#renderSessionState();
  }
  #renderRecoveryPrompt() {
    const loaded = this.#pendingRecovery[0];
    this.#recoveryPanel.hidden = !loaded;
    if (!loaded) {
      this.#recoveryText.textContent = "";
      return;
    }
    const remaining = this.#pendingRecovery.length;
    const captured = new Date(loaded.record.capturedAt).toLocaleString();
    this.#recoveryText.textContent = `Unsaved recovery for ${loaded.record.path} (${loaded.generation}, ${captured}). ${remaining} unresolved cop${1 === remaining ? "y" : "ies"} in this workspace.`;
  }
  #handleWorkspaceRefresh(refresh) {
    const paneState = this.#panes.state;
    const isAttached = paneState.primary.session === refresh.session || paneState.secondary.session === refresh.session;
    if (!isAttached) {
      return;
    }
    if ("reloaded" === refresh.outcome.kind) {
      this.#syncSessionBindings(refresh.session);
      this.#pluginDocuments.emit("change", refresh.session);
    }
    if ("conflict" === refresh.outcome.kind || "missing" === refresh.outcome.kind) {
      this.#closeDiffForSession(refresh.session);
    } else if ("reloaded" === refresh.outcome.kind) {
      this.#refreshDiffForSession(refresh.session);
    }
    this.#renderSessionState(
      refresh.session !== this.#currentSession ? void 0 : "reloaded" === refresh.outcome.kind ? "Reloaded external change" : "conflict" === refresh.outcome.kind || "missing" === refresh.outcome.kind ? "External change requires attention" : void 0
    );
  }
  #renderSessionState(message) {
    const panes = this.#panes.state;
    this.#secondaryPane.hidden = !panes.secondaryVisible;
    this.#panesHost.dataset.split = String(panes.secondaryVisible);
    this.#root.dataset.activePane = panes.activePane;
    this.#primaryPane.dataset.active = String("primary" === panes.activePane);
    this.#secondaryPane.dataset.active = String("secondary" === panes.activePane);
    this.#renderPaneState("primary", "primary" === panes.activePane ? message : void 0);
    this.#renderPaneState("secondary", "secondary" === panes.activePane ? message : void 0);
    const session = panes[panes.activePane].session;
    this.#currentSession = session;
    this.#pluginDocuments.setActive(session);
    if (session) {
      this.#pathInput.value = session.state.path;
    }
    const state = session?.state;
    this.#root.dataset.dirty = String(state?.dirty ?? false);
    this.#root.dataset.conflict = state?.conflict?.kind ?? "none";
    this.#conflictPanel.hidden = !state?.conflict;
    if (state?.conflict) {
      this.#conflictText.textContent = "missing" === state.conflict.kind ? "The document is missing on disk. Saving to the old path is disabled." : "The document changed on disk. Saving is disabled until the conflict is resolved.";
    } else {
      this.#conflictText.textContent = "";
    }
    this.#pluginHeaders.renderAll();
  }
  #renderPaneState(paneId, message) {
    const session = this.#panes.state[paneId].session;
    const title = "primary" === paneId ? this.#documentTitle : this.#secondaryDocumentTitle;
    const status = this.#statusForPane(paneId);
    const saveButton = "primary" === paneId ? this.#saveButton : this.#secondarySaveButton;
    const diffButton = "primary" === paneId ? this.#diffButton : this.#secondaryDiffButton;
    const diffView = this.#diffForPane(paneId);
    if (!session) {
      title.textContent = "No document open";
      status.textContent = "primary" === paneId ? "Choose a workspace-relative Markdown path." : "Open a document in split view.";
      saveButton.disabled = true;
      diffButton.disabled = true;
      diffButton.textContent = "Diff";
      return;
    }
    const state = session.state;
    title.textContent = `${state.path}${state.dirty ? " *" : ""}`;
    saveButton.disabled = this.#busy || !state.dirty || null !== state.conflict;
    diffButton.textContent = diffView.isOpen ? "Close diff" : "Diff";
    diffButton.disabled = this.#busy || !diffView.isOpen && (null !== state.conflict || "idle" !== state.saveState.kind);
    if (message) {
      status.textContent = message;
      return;
    }
    if (diffView.isOpen) {
      status.textContent = "Read-only diff \xB7 saved snapshot vs current buffer";
      return;
    }
    if ("read-only" === state.savedSnapshot.access.kind) {
      status.textContent = state.savedSnapshot.access.message;
    } else if (state.conflict) {
      status.textContent = "External change conflict \xB7 saving is disabled";
    } else if ("error" === state.saveState.kind) {
      status.textContent = `Save error: ${state.saveState.message}`;
    } else if ("error" === state.recoveryState.kind) {
      status.textContent = `Recovery error: ${state.recoveryState.message}`;
    } else if (state.dirty) {
      status.textContent = "Unsaved changes \xB7 recovery pending";
    } else {
      status.textContent = "Saved";
    }
  }
  #setBusy(busy, message) {
    this.#busy = busy;
    this.#openButton.disabled = busy;
    this.#splitButton.disabled = busy;
    this.#restoreRecoveryButton.disabled = busy;
    this.#laterRecoveryButton.disabled = busy;
    this.#discardRecoveryButton.disabled = busy;
    this.#reloadConflictButton.disabled = busy;
    this.#keepConflictRecoveryButton.disabled = busy;
    this.#continueConflictButton.disabled = busy;
    this.#closeSecondaryButton.disabled = busy;
    if (message) {
      this.#runtimeStatus.textContent = message;
    }
    const primary = this.#panes.state.primary.session?.state;
    const secondary = this.#panes.state.secondary.session?.state;
    this.#saveButton.disabled = busy || !primary || !primary.dirty || null !== primary.conflict;
    this.#secondarySaveButton.disabled = busy || !secondary || !secondary.dirty || null !== secondary.conflict;
    this.#diffButton.disabled = busy || !primary || !this.#diffView.isOpen && (null !== primary.conflict || "idle" !== primary.saveState.kind);
    this.#secondaryDiffButton.disabled = busy || !secondary || !this.#secondaryDiffView.isOpen && (null !== secondary.conflict || "idle" !== secondary.saveState.kind);
  }
};

// apps/desktop/src/index.ts
var workspaceAdapter = new DesktopWorkspaceAdapter(tauriDesktopBridge);
var recoveryStore = new TauriRecoveryStore(tauriDesktopBridge);
var application = new DesktopApplication({
  bridge: tauriDesktopBridge,
  workspaceAdapter,
  recoveryStore,
  windowLifecycle: createTauriWindowLifecycle(),
  document,
  window
});
application.mount();
