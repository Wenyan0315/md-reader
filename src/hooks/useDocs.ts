import { useCallback, useEffect, useState } from 'react';

export interface DocFile {
  /** Relative path within the source, e.g. "guide/install.md" */
  path: string;
  /** File name without directory, e.g. "install.md" */
  name: string;
  content: string;
}

export interface DocSource {
  name: string;
  files: DocFile[];
}

const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv']);

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
          const content = await r.text();
          loaded.push({ path: p, name: p.split('/').pop() ?? p, content });
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
        const file = await (entry as FileSystemFileHandle).getFile();
        const content = await file.text();
        out.push({ path: `${prefix}${entry.name}`, name: entry.name, content });
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

  /** Open a local folder via File System Access API (Chromium). */
  const openFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setError('当前浏览器不支持打开文件夹，请使用 Chrome / Edge，或点击“选择文件”。');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const dir = await window.showDirectoryPicker({ id: 'md-reader' });
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
      files.push({ path: file.name, name: file.name, content: await file.text() });
    }
    if (files.length === 0) {
      setError('所选文件中没有 .md 文件');
    } else {
      setSource({ name: '选择的文件', files: sortFiles(files) });
    }
    setLoading(false);
  }, []);

  return { source, loading, error, openFolder, openFiles };
}
