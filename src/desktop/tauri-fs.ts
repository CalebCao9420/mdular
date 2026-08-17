/// <reference path="../types/global.d.ts" />

interface TauriListedFile {
  relative_path: string;
  last_modified_ms: number;
}

let tauriWorkspaceBound = false;

function isTauriWorkspaceBound(): boolean {
  return tauriWorkspaceBound;
}

function setTauriWorkspaceBound(bound: boolean): void {
  tauriWorkspaceBound = bound;
}

function appPathToRelative(appPath: string): string {
  return appPath.replace(/^\//, '').replace(/\\/g, '/');
}

function relativeToAppPath(relative: string): string {
  const normalized = relative.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : '/' + normalized;
}

function isTauriMediaRelativePath(relativePath: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|ogg|oga|wav)$/i.test(relativePath);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

class TauriFileHandle {
  relativePath: string;

  constructor(relativePath: string) {
    this.relativePath = relativePath.replace(/\\/g, '/');
  }

  async getFile(): Promise<File> {
    const name = this.relativePath.split('/').pop() || 'file';
    const mtime = await tauriInvoke<number>('mdtk_file_mtime', {
      relativePath: this.relativePath,
    }).catch(() => Date.now());

    if (isTauriMediaRelativePath(this.relativePath)) {
      const b64 = await tauriInvoke<string>('mdtk_read_file_base64', {
        relativePath: this.relativePath,
      });
      const bytes = base64ToBytes(b64);
      return new File([bytes], name, { lastModified: mtime });
    }

    const text = await tauriInvoke<string>('mdtk_read_file', { relativePath: this.relativePath });
    return new File([text], name, { type: 'text/plain', lastModified: mtime });
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    const rel = this.relativePath;
    const isMedia = isTauriMediaRelativePath(rel);
    let textBuffer = '';
    let binaryChunks: Uint8Array[] = [];

    if (options?.keepExistingData) {
      try {
        if (isMedia) {
          const b64 = await tauriInvoke<string>('mdtk_read_file_base64', { relativePath: rel });
          binaryChunks.push(base64ToBytes(b64));
        } else {
          textBuffer = await tauriInvoke<string>('mdtk_read_file', { relativePath: rel });
        }
      } catch {
        // new file
      }
    }

    return {
      write: async (data: string | Blob | ArrayBuffer | Uint8Array) => {
        if (typeof data === 'string') {
          textBuffer += data;
          return;
        }
        if (data instanceof Blob) {
          binaryChunks.push(new Uint8Array(await data.arrayBuffer()));
          return;
        }
        binaryChunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      },
      seek: async (position: number) => {
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
          await tauriInvoke('mdtk_write_file_base64', {
            relativePath: rel,
            contentBase64: bytesToBase64(merged),
          });
          return;
        }
        await tauriInvoke('mdtk_write_file', { relativePath: rel, content: textBuffer });
      },
    };
  }

  async remove(): Promise<void> {
    await tauriInvoke('mdtk_delete_file', { relativePath: this.relativePath });
  }
}

async function tauriGetFileHandle(appPath: string, create = false): Promise<TauriFileHandle> {
  const relativePath = appPathToRelative(appPath);
  if (create) {
    await tauriInvoke('mdtk_ensure_parent_dirs', { relativePath });
    const exists = await tauriInvoke<boolean>('mdtk_exists', { relativePath });
    if (!exists) {
      if (isTauriMediaRelativePath(relativePath)) {
        await tauriInvoke('mdtk_write_file_base64', {
          relativePath,
          contentBase64: '',
        });
      } else {
        await tauriInvoke('mdtk_write_file', { relativePath, content: '' });
      }
    }
    return new TauriFileHandle(relativePath);
  }

  const exists = await tauriInvoke<boolean>('mdtk_exists', { relativePath });
  if (!exists) {
    const err = new Error('Not found');
    (err as Error & { name: string }).name = 'NotFoundError';
    throw err;
  }
  return new TauriFileHandle(relativePath);
}

async function tauriListWorkspaceFiles(): Promise<TauriListedFile[]> {
  return tauriInvoke<TauriListedFile[]>('mdtk_list_files');
}

async function tauriCreateDir(appDirPath: string): Promise<void> {
  const relativePath = appPathToRelative(appDirPath);
  await tauriInvoke('mdtk_create_dir', { relativePath });
}

async function tauriRemoveDir(appDirPath: string): Promise<void> {
  const relativePath = appPathToRelative(trimPrefix(appDirPath, '/'));
  await tauriInvoke('mdtk_remove_dir', { relativePath });
}

async function tauriPathIsDir(relativePath: string): Promise<boolean> {
  return tauriInvoke<boolean>('mdtk_is_dir', { relativePath });
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
  tauriPathIsDir,
});
