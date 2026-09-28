import { useCallback, useEffect, useState } from 'react';

export type DocOrigin = 'bundled' | 'folder' | 'files';

export interface DocFile {
  /** Relative path within the source, e.g. "guide/install.md" */
  path: string;
  /** File name without directory, e.g. "install.md" */
  name: string;
  content: string;
  /** Where this doc comes from — determines how edits are saved. */
  origin: DocOrigin;
  /** File handle when opened via folder picker — enables writing back to disk. */
  handle?: FileSystemFileHandle;
}

export interface DocSource {
  name: string;
  files: DocFile[];
}

const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv']);

/** localStorage key for edits that cannot be written back to a real file. */
const overrideKey = (path: string) => `mdr-override:${path}`;

function readOverride(path: string): string | null {
  try {
    return localStorage.getItem(overrideKey(path));
  } catch {
    return null;
  }
}

function writeOverride(path: string, content: string) {
  try {
    localStorage.setItem(overrideKey(path), content);
  } catch {
    /* storage full or unavailable — ignore */
  }
}

function sortFiles(files: DocFile[]): DocFile[] {
  // Root-level files first (so a welcome/index doc opens by default), then by path.
  return files.sort((a, b) => {
    const depth = (p: string) => p.split('/').length;
    if (depth(a.path) !== depth(b.path)) return depth(a.path) - depth(b.path);
    return a.path.localeCompare(b.path, 'zh-Hans-CN', { numeric: true });
  });
}

/** Load docs bundled inside the app: public/docs/index.json lists md paths. */
async function loadBundledDocs(): Promise<DocSource | null> {
  try {
    const res = await fetch('docs/index.json');
    if (!res.ok) return null;
    const paths: string[] = await res.json();
    const loaded: DocFile[] = [];
    await Promise.all(
      paths.map(async (p) => {
        try {
          const r = await fetch(`docs/${p}`);
          if (!r.ok) return;
          const raw = await r.text();
          const content = readOverride(p) ?? raw;
          loaded.push({ path: p, name: p.split('/').pop() ?? p, content, origin: 'bundled' });
        } catch {
          /* skip unreadable file */
        }
      }),
    );
    if (loaded.length === 0) return null;
    return { name: '内置文档', files: sortFiles(loaded) };
  } catch {
    return null;
  }
}

async function walkDirectory(dir: FileSystemDirectoryHandle, prefix: string, out: DocFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return;
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDirectory(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, out);
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      try {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const content = await file.text();
        out.push({ path: `${prefix}${entry.name}`, name: entry.name, content, origin: 'folder', handle: fileHandle });
      } catch {
        /* skip unreadable file */
      }
    }
  }
}

export function useDocs() {
  const [source, setSource] = useState<DocSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBundledDocs().then((s) => {
      if (cancelled) return;
      if (s) setSource(s);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Open a local folder via File System Access API (Chromium), read+write. */
  const openFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setError('当前浏览器不支持打开文件夹，请使用 Chrome / Edge，或点击“选择文件”。');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const dir = await window.showDirectoryPicker({ id: 'md-reader', mode: 'readwrite' });
      const files: DocFile[] = [];
      await walkDirectory(dir, '', files);
      if (files.length === 0) {
        setError(`文件夹「${dir.name}」里没有找到 .md 文件`);
      } else {
        setSource({ name: dir.name, files: sortFiles(files) });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(`读取文件夹失败：${(e as Error).message}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fallback for browsers without directory picker: pick files manually. */
  const openFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setLoading(true);
    setError(null);
    const files: DocFile[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith('.md')) continue;
      files.push({ path: file.name, name: file.name, content: await file.text(), origin: 'files' });
    }
    if (files.length === 0) {
      setError('所选文件中没有 .md 文件');
    } else {
      setSource({ name: '选择的文件', files: sortFiles(files) });
    }
    setLoading(false);
  }, []);

  /**
   * Save edited content.
   * - folder docs: written back to the real file on disk.
   * - bundled / picked-file docs: kept in localStorage (no writable handle available).
   * Returns a user-facing note about where the change was saved.
   */
  const saveContent = useCallback(async (doc: DocFile, content: string): Promise<string> => {
    let note: string;
    if (doc.origin === 'folder' && doc.handle) {
      try {
        const perm = await doc.handle.requestPermission?.({ mode: 'readwrite' });
        if (perm === 'denied') throw new Error('没有写入权限');
        const writable = await (doc.handle as unknown as {
          createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
        }).createWritable();
        await writable.write(content);
        await writable.close();
        note = '已保存到文件';
      } catch (e) {
        throw new Error(`写入文件失败：${(e as Error).message}`);
      }
    } else {
      writeOverride(doc.path, content);
      note = '已保存到浏览器本地（内置/手动选择的文件无法写回磁盘）';
    }

    setSource((prev) => {
      if (!prev) return prev;
      return { ...prev, files: prev.files.map((f) => (f.path === doc.path ? { ...f, content } : f)) };
    });
    return note;
  }, []);

  /**
   * Merge externally obtained docs (drag & drop) into the current source.
   * No source yet → creates one; same path gets overwritten by the new version.
   */
  const addFiles = useCallback((incoming: DocFile[]) => {
    if (incoming.length === 0) {
      setError('拖入的内容里没有找到 .md 文件');
      return;
    }
    setError(null);
    setSource((prev) => {
      if (!prev) return { name: '拖入的文件', files: sortFiles(incoming) };
      const map = new Map(prev.files.map((f) => [f.path, f]));
      for (const f of incoming) map.set(f.path, f);
      return { ...prev, files: sortFiles([...map.values()]) };
    });
  }, []);

  return { source, loading, error, openFolder, openFiles, saveContent, addFiles };
}
