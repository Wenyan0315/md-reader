import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Moon, Sun, FolderOpen, FileText, Menu, X, BookOpen, ListTree, Pencil, Save, Eye, Import } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDocs, type DocFile } from '@/hooks/useDocs';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function textOf(children: React.ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (typeof children === 'object' && 'props' in (children as unknown as Record<string, unknown>)) {
    return textOf((children as unknown as { props: { children?: React.ReactNode } }).props.children);
  }
  return '';
}

interface TocItem {
  depth: number;
  text: string;
  id: string;
}

/** Same unique-id algorithm as the rendered headings: repeated headings get -2, -3 ... */
function extractToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[*`~\[\]()]/g, '').trim();
    if (!text) continue;
    const base = slugify(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    items.push({ depth: m[1].length, text, id: n === 1 ? base : `${base}-${n}` });
  }
  return items;
}

/** Assign unique ids: repeated headings get -2, -3 ... suffixes. */
function makeHeadingId(raw: string, seen: Map<string, number>): string {
  const base = slugify(raw);
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv']);

/** Recursively read a FileSystemEntry (from drag & drop) into DocFile list. */
async function readEntry(entry: FileSystemEntry, prefix: string, out: DocFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    if (file.name.toLowerCase().endsWith('.md')) {
      out.push({
        path: `${prefix}${file.name}`,
        name: file.name,
        content: await file.text(),
        origin: 'files',
      });
    }
  } else if (entry.isDirectory) {
    if (SKIP_DIRS.has(entry.name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    // readEntries returns batches of up to 100 — loop until empty.
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      for (const child of batch) {
        await readEntry(child, `${prefix}${entry.name}/`, out);
      }
    } while (batch.length > 0 && out.length < MAX_FILES);
  }
}

/** Extract all .md files from a drop event's DataTransfer. */
async function readDroppedItems(dt: DataTransfer): Promise<DocFile[]> {
  const out: DocFile[] = [];
  const items = Array.from(dt.items);
  const hasEntryApi = items.some((it) => typeof it.webkitGetAsEntry === 'function');

  if (hasEntryApi) {
    for (const item of items) {
      if (out.length >= MAX_FILES) break;
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        await readEntry(entry, '', out);
      } else {
        // No entry backing (e.g. some synthetic or partial drops) — fall back to plain file.
        const file = item.getAsFile();
        if (file && file.name.toLowerCase().endsWith('.md')) {
          out.push({ path: file.name, name: file.name, content: await file.text(), origin: 'files' });
        }
      }
    }
  } else {
    // Fallback: plain files only (no directory support).
    for (const file of Array.from(dt.files)) {
      if (out.length >= MAX_FILES) break;
      if (file.name.toLowerCase().endsWith('.md')) {
        out.push({ path: file.name, name: file.name, content: await file.text(), origin: 'files' });
      }
    }
  }
  return out;
}

export default function Home() {
  const { source, loading, error, openFolder, openFiles, saveContent, addFiles } = useDocs();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Switching documents leaves edit mode and clears any save notice.
  useEffect(() => {
    setEditMode(false);
    setSaveNote(null);
  }, [activePath]);

  const activeFile: DocFile | undefined = useMemo(
    () => source?.files.find((f) => f.path === activePath) ?? source?.files[0],
    [source, activePath],
  );

  const filtered: DocFile[] = useMemo(() => {
    if (!source) return [];
    const q = query.trim().toLowerCase();
    if (!q) return source.files;
    return source.files.filter((f) => f.path.toLowerCase().includes(q));
  }, [source, query]);

  const toc: TocItem[] = useMemo(() => (activeFile ? extractToc(activeFile.content) : []), [activeFile]);

  // Re-sync heading ids per document render: reset counter via ref below.
  const idCounter = useRef(new Map<string, number>());

  const markdownComponents = useMemo(() => {
    idCounter.current = new Map();
    const heading = (Tag: 'h1' | 'h2' | 'h3') =>
      function Heading({ children }: { children?: React.ReactNode }) {
        const raw = textOf(children);
        const id = makeHeadingId(raw, idCounter.current);
        return <Tag id={id}>{children}</Tag>;
      };
    return {
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        const isExternal = href?.startsWith('http');
        return (
          <a href={href} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noreferrer' : undefined}>
            {children}
          </a>
        );
      },
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
    };
  }, [activeFile?.path]);

  const scrollToHeading = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startEdit = () => {
    if (!activeFile) return;
    setDraft(activeFile.content);
    setSaveNote(null);
    setEditMode(true);
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const note = await saveContent(activeFile, draft);
      setSaveNote(note);
      setEditMode(false);
    } catch (e) {
      setSaveNote((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- drag & drop import ----------
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    try {
      const docs = await readDroppedItems(e.dataTransfer);
      addFiles(docs);
    } catch {
      setSaveNote('读取拖入内容失败');
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="p-3 space-y-2">
        <Input
          placeholder="搜索文件名…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            {query ? '没有匹配的文件' : '暂无文档'}
          </p>
        ) : (
          <ul className="px-2 pb-4 space-y-0.5">
            {filtered.map((f) => {
              const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : null;
              return (
                <li key={f.path}>
                  <button
                    onClick={() => {
                      setActivePath(f.path);
                      setNavOpen(false);
                    }}
                    className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors ${
                      f.path === activeFile?.path
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-start gap-1.5">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="min-w-0">
                        <span className="block truncate">{f.name.replace(/\.md$/i, '')}</span>
                        {dir && <span className="block truncate text-[11px] opacity-50">{dir}/</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNavOpen(true)}>
          <Menu className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">MD Reader</span>
          {source && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {source.name}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
            <FileText className="mr-1 h-3.5 w-3.5" />
            选择文件
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={openFolder}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            打开文件夹
          </Button>
          {activeFile && !editMode && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={startEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              编辑
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDark((d) => !d)}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          multiple
          className="hidden"
          onChange={(e) => {
            openFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 border-r lg:block">{sidebar}</aside>

        {/* Mobile drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 border-r bg-background">
              <div className="flex h-12 items-center justify-between border-b px-3">
                <span className="text-sm font-medium">文档列表</span>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setNavOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {sidebar}
            </div>
          </div>
        )}

        {/* Content */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {loading && !source ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              正在加载文档…
            </div>
          ) : !activeFile ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <p className="text-base font-medium">还没有可阅读的文档</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  点击右上角「打开文件夹」选择一个包含 .md 文件的目录，
                  <br className="hidden sm:block" />
                  或点击「选择文件」手动挑选 md 文件。
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          ) : (
            <div className="mx-auto flex max-w-6xl gap-8 px-5 py-8 sm:px-8">
              {editMode ? (
                <div className="flex min-w-0 flex-1 flex-col" style={{ height: 'calc(100vh - 7rem)' }}>
                  <div className="mb-3 flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{activeFile.name}</span>
                    {saveNote && <span className="truncate text-xs text-destructive">{saveNote}</span>}
                    <span className="ml-auto flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditMode(false)}>
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        取消
                      </Button>
                      <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={handleSave}>
                        <Save className="mr-1 h-3.5 w-3.5" />
                        {saving ? '保存中…' : '保存'}
                      </Button>
                    </span>
                  </div>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    placeholder="# 开始输入 Markdown…"
                    className="min-h-0 w-full flex-1 resize-none rounded-lg border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed focus-visible:ring-1"
                  />
                </div>
              ) : (
                <>
                  <article className="markdown min-w-0 flex-1">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                      components={markdownComponents}
                    >
                      {activeFile.content}
                    </ReactMarkdown>
                  </article>
                  {toc.length > 1 && (
                    <nav className="sticky top-8 hidden h-fit w-52 shrink-0 xl:block">
                      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <ListTree className="h-3.5 w-3.5" /> 目录
                      </p>
                      <ul className="space-y-1 border-l text-[13px]">
                        {toc.map((t, i) => (
                          <li key={`${t.id}-${i}`}>
                            <button
                              onClick={() => scrollToHeading(t.id)}
                              className="block w-full truncate text-left leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                              style={{ paddingLeft: `${(t.depth - 1) * 12 + 12}px` }}
                            >
                              {t.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Drag & drop overlay */}
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary/60 bg-card/90 px-14 py-12 text-center shadow-xl">
            <Import className="mx-auto h-10 w-10 text-primary" />
            <p className="mt-4 text-sm font-medium">松开以导入 .md 文件或整个文件夹</p>
            <p className="mt-1 text-xs text-muted-foreground">将合并到当前文档列表，同名文件会被覆盖</p>
          </div>
        </div>
      )}
    </div>
  );
}
