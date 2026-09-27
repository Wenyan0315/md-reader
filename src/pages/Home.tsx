import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Moon, Sun, FolderOpen, FileText, Menu, X, BookOpen, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export default function Home() {
  const { source, loading, error, openFolder, openFiles } = useDocs();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

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
    <div className="flex h-screen flex-col bg-background text-foreground">
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
              <article className="markdown min-w-0 flex-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
