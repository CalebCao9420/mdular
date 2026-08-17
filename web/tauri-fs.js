// Generated from src/ — edit TypeScript and run: npm run build

let tauriWorkspaceBound = false;
function isTauriWorkspaceBound() {
  return tauriWorkspaceBound;
}
function setTauriWorkspaceBound(bound) {
  tauriWorkspaceBound = bound;
}
function appPathToRelative(appPath) {
  return appPath.replace(/^\//, "").replace(/\\/g, "/");
}
function relativeToAppPath(relative) {
  const normalized = relative.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : "/" + normalized;
}
function isTauriMediaRelativePath(relativePath) {
  return /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|ogg|oga|wav)$/i.test(relativePath);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
class TauriFileHandle {
  constructor(relativePath) {
    this.relativePath = relativePath.replace(/\\/g, "/");
  }
  async getFile() {
    const name = this.relativePath.split("/").pop() || "file";
    const mtime = await tauriInvoke("mdtk_file_mtime", {
      relativePath: this.relativePath
    }).catch(() => Date.now());
    if (isTauriMediaRelativePath(this.relativePath)) {
      const b64 = await tauriInvoke("mdtk_read_file_base64", {
        relativePath: this.relativePath
      });
      const bytes = base64ToBytes(b64);
      return new File([bytes], name, { lastModified: mtime });
    }
    const text = await tauriInvoke("mdtk_read_file", { relativePath: this.relativePath });
    return new File([text], name, { type: "text/plain", lastModified: mtime });
  }
  async createWritable(options) {
    const rel = this.relativePath;
    const isMedia = isTauriMediaRelativePath(rel);
    let textBuffer = "";
    let binaryChunks = [];
    if (options?.keepExistingData) {
      try {
        if (isMedia) {
          const b64 = await tauriInvoke("mdtk_read_file_base64", { relativePath: rel });
          binaryChunks.push(base64ToBytes(b64));
        } else {
          textBuffer = await tauriInvoke("mdtk_read_file", { relativePath: rel });
        }
      } catch {
      }
    }
    return {
      write: async (data) => {
        if (typeof data === "string") {
          textBuffer += data;
          return;
        }
        if (data instanceof Blob) {
          binaryChunks.push(new Uint8Array(await data.arrayBuffer()));
          return;
        }
        binaryChunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      },
      seek: async (position) => {
        if (isMedia || binaryChunks.length > 0) {
          return;
        }
        textBuffer = textBuffer.slice(0, position);
      },
      close: async () => {
        if (isMedia || binaryChunks.length > 0) {
          const total = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const chunk of binaryChunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          await tauriInvoke("mdtk_write_file_base64", {
            relativePath: rel,
            contentBase64: bytesToBase64(merged)
          });
          return;
        }
        await tauriInvoke("mdtk_write_file", { relativePath: rel, content: textBuffer });
      }
    };
  }
  async remove() {
    await tauriInvoke("mdtk_delete_file", { relativePath: this.relativePath });
  }
}
async function tauriGetFileHandle(appPath, create = false) {
  const relativePath = appPathToRelative(appPath);
  if (create) {
    await tauriInvoke("mdtk_ensure_parent_dirs", { relativePath });
    const exists2 = await tauriInvoke("mdtk_exists", { relativePath });
    if (!exists2) {
      if (isTauriMediaRelativePath(relativePath)) {
        await tauriInvoke("mdtk_write_file_base64", {
          relativePath,
          contentBase64: ""
        });
      } else {
        await tauriInvoke("mdtk_write_file", { relativePath, content: "" });
      }
    }
    return new TauriFileHandle(relativePath);
  }
  const exists = await tauriInvoke("mdtk_exists", { relativePath });
  if (!exists) {
    const err = new Error("Not found");
    err.name = "NotFoundError";
    throw err;
  }
  return new TauriFileHandle(relativePath);
}
async function tauriListWorkspaceFiles() {
  return tauriInvoke("mdtk_list_files");
}
async function tauriCreateDir(appDirPath) {
  const relativePath = appPathToRelative(appDirPath);
  await tauriInvoke("mdtk_create_dir", { relativePath });
}
async function tauriRemoveDir(appDirPath) {
  const relativePath = appPathToRelative(trimPrefix(appDirPath, "/"));
  await tauriInvoke("mdtk_remove_dir", { relativePath });
}
async function tauriPathIsDir(relativePath) {
  return tauriInvoke("mdtk_is_dir", { relativePath });
}
Object.assign(globalThis, {
  isTauriWorkspaceBound,
  setTauriWorkspaceBound,
  appPathToRelative,
  relativeToAppPath,
  TauriFileHandle,
  tauriGetFileHandle,
  tauriListWorkspaceFiles,
  tauriCreateDir,
  tauriRemoveDir,
  tauriPathIsDir
});
