// PageEditor — the microsite editor at its own route /admin/edit/<slug> (owner: "点进去有编辑器，
// 能有一些基础的文件系统，widget管理，那些轻量级编辑器的东西"). A small IDE: a file list (a page can
// have several source files), a CodeMirror editor per file, the importable SDK widgets, and a live
// render on the right. The list page (/admin/microsites) is now just the list and links here.
//
// The heavy editing pieces are open source (CodeMirror 6 via @uiw/react-codemirror), not hand-rolled.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

import { SeoPanel } from '@/components/admin/sections/microsites/SeoPanel';
import { EditorViewToggle } from '@/components/admin/sections/microsites/EditorViewToggle';
import { editorGridCls, editorColCls, type EditorView } from '@/lib/admin/editor-view';
import { useAutoBuild } from '@/lib/admin/use-auto-build';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { IMPORTABLE_MODULES, STARTER, type ImportableModule } from '@/lib/admin/microsite-imports';
import {
  loadDraft, stageFiles, shipFilesLive, previewView, usePinnedPreviewSrc,
  useMicrosites, type BuildView, type MicrositeSummary, type DraftFiles,
} from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';

const NEW = 'new';

// openExisting — load an existing page's files into the editor (skipped for a brand-new page), then
// auto-build a preview so the render on the right is fresh the moment the owner walks in, with no
// manual "build preview" click (owner: "每次点进去自动触发一下build preview"). Build failure is
// left to surface through setBuild (BuildLine) — it must not stop the files from loading.
async function openExisting(
  slug: string,
  setFiles: (f: DraftFiles) => void,
  setActive: (p: string) => void,
  setBuild: (b: BuildView | null) => void,
): Promise<void> {
  const files = await loadDraft(slug).catch((): DraftFiles => ({}));
  const paths = Object.keys(files);
  const hasFiles = paths.length > 0;
  const resolved: DraftFiles = hasFiles ? files : { 'App.tsx': STARTER };
  setFiles(resolved);
  setActive(hasFiles ? paths[0]! : 'App.tsx');
  setBuild(null);
  await stageFiles(slug, resolved, setBuild).catch(() => undefined);
}

export function PageEditor({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  const run = useAction();
  const isNew = slug === NEW;
  const [pageSlug, setPageSlug] = useState(isNew ? '' : slug);
  const [files, setFiles] = useState<DraftFiles>({ 'App.tsx': STARTER });
  const [active, setActive] = useState('App.tsx');
  const [build, setBuild] = useState<BuildView | null>(null);
  // Editor layout gear: code-only / split (default) / render-only. Both columns stay mounted and
  // are hidden by CSS, so toggling never remounts CodeMirror or the preview (no flicker, no lost
  // build/long-poll).
  const [view, setView] = useState<EditorView>('split');

  useEffect(() => {
    void (isNew ? Promise.resolve() : openExisting(slug, setFiles, setActive, setBuild));
  }, [slug, isNew]);

  // Auto-build on edit: the preview follows live as the owner types (debounced), no "build preview"
  // click. Hung off the edit handler so a programmatic draft load (openExisting) never triggers it.
  const scheduleBuild = useAutoBuild(pageSlug, files, setBuild);
  const setActiveContent = useCallback((v: string) => {
    setFiles((prev) => ({ ...prev, [active]: v }));
    scheduleBuild();
  }, [active, scheduleBuild]);

  const addFile = useCallback((path: string) => {
    setFiles((prev) => (path === '' || prev[path] !== undefined) ? prev : { ...prev, [path]: '' });
    setActive((cur) => (path === '' ? cur : path));
  }, []);

  const publish = useCallback(() => {
    void run(() => shipFilesLive(pageSlug.trim(), files, build, setBuild), { success: t('published') });
  }, [run, pageSlug, files, build, t]);

  return (
    <div data-testid="microsite-editor">
      <EditorHeader slug={pageSlug} isNew={isNew} onSlug={setPageSlug} />
      <EditorViewToggle view={view} onChange={setView} />
      <div className={editorGridCls(view)}>
        <div className={editorColCls(view, 'code')} data-testid="microsite-code-col">
          <FileTabs files={files} active={active} onSwitch={setActive} onAdd={addFile} />
          <div className="border border-(--color-rule) rounded-b-[3px] overflow-hidden" data-testid="microsite-source">
            <CodeMirror
              value={files[active] ?? ''}
              onChange={setActiveContent}
              extensions={[javascript({ jsx: true, typescript: true })]}
              theme="dark"
              height="440px"
              className="text-[13px]"
            />
          </div>
          <EditorActions slug={pageSlug} build={build} onPublish={publish} />
          <SeoPanel slug={pageSlug} isNew={isNew} />
          <WidgetPanel />
        </div>
        <div className={editorColCls(view, 'render')} data-testid="microsite-render-col">
          <PreviewPane slug={pageSlug} />
        </div>
      </div>
    </div>
  );
}


// The reserved home page is served at the site ROOT — it has no /p/<slug> address and can't be renamed.
const HOME = 'home';

// EditorHeader — back to the list + the page's identity: a new page picks its slug (SlugField); an
// existing page's name is edited in place (SlugNameEditor); the home page shows the DOMAIN it serves.
function EditorHeader(
  { slug, isNew, onSlug }: { slug: string; isNew: boolean; onSlug: (v: string) => void },
) {
  const t = useTranslations('adminPages.microsites');
  return (
    <div className="mb-4">
      <Link
        href="/admin/microsites"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        <span data-testid="microsite-back">{t('backToList')}</span>
      </Link>
      {isNew
        ? <SlugField value={slug} onChange={onSlug} />
        : slug === HOME ? <HomeDomainHeading /> : <SlugNameEditor slug={slug} />}
    </div>
  );
}

// HomeDomainHeading — the home page IS the site root, so its address is the owner's DOMAIN, not
// /p/home (owner: "homepage 这边就应该显示域名").
function HomeDomainHeading() {
  const t = useTranslations('adminPages.microsites');
  const session = useAdminSession();
  const domain = session.kind === 'ready' ? domainOf(session.session.public_url) : '';
  return (
    <div className="flex items-baseline gap-3 mt-2 flex-wrap">
      <h2 data-testid="microsite-home-domain" className="font-serif text-[22px] text-(--color-ink)">{domain}</h2>
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent)">{t('homepageBadge')}</span>
    </div>
  );
}

// domainOf — the bare host for display (drop scheme + trailing slash). Empty stays empty.
function domainOf(publicURL: string): string {
  return publicURL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// SlugNameEditor — the page's name, edited in place (owner: "linguistics 直接可编辑，下面有条线，右边
// 保存按钮，点了打一个一秒钟的 ✅"): an underlined field + a Save button. Save renames when the name
// changed (jumps to the new editor route), and always flashes a 1s ✓ so the click is acknowledged.
function SlugNameEditor({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  const { renamePage } = useMicrosites();
  const run = useAction();
  const router = useRouter();
  const [raw, setRaw] = useState(slug);
  const [savedFlash, setSavedFlash] = useState(false);
  const save = useCallback((): void => {
    const next = raw.trim();
    const changed = next !== '' && next !== slug;
    changed
      ? void run(async () => {
          await renamePage(slug, next);
          router.push(`/admin/edit/${next}`);
        }, { success: t('renamed', { slug: next }) })
      : flashSaved(setSavedFlash);
  }, [raw, slug, renamePage, run, router, t]);
  return (
    <div className="flex items-baseline gap-3 mt-2">
      <span className="font-serif text-[22px] text-(--color-faint) shrink-0">{t('slugPrefix')}</span>
      <input
        value={raw} data-testid="microsite-name-input" aria-label="page name"
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => (e.key === 'Enter' ? save() : undefined)}
        className="sm-field-input font-serif text-[22px] flex-1 min-w-0 max-w-[18em]"
      />
      <button type="button" onClick={save} data-testid="microsite-name-save" className="sm-btn sm-btn-outline sm-btn-sm shrink-0">
        {t('saveName')}
      </button>
      {savedFlash && (
        <span data-testid="microsite-name-saved" role="status" className="mono text-(--color-accent) text-[12px] shrink-0">{t('nameSaved')}</span>
      )}
    </div>
  );
}

// flashSaved — show the ✓ for ~1s after a Save, then clear it.
function flashSaved(set: (v: boolean) => void): void {
  set(true);
  setTimeout(() => set(false), 1000);
}

function SlugField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <label className="block mt-2">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('slugLabel')}
      </span>
      <input
        type="text" value={value} placeholder={t('slugPlaceholder')} data-testid="microsite-slug"
        autoFocus onChange={(e) => onChange(e.target.value)} className="sm-field-input sm-mono"
      />
    </label>
  );
}

// FileTabs — a page can hold several source files; switch between them, and add one. A small file
// system, not a full tree (pages are a handful of files).
function FileTabs(
  { files, active, onSwitch, onAdd }:
  { files: DraftFiles; active: string; onSwitch: (p: string) => void; onAdd: (p: string) => void },
) {
  const t = useTranslations('adminPages.microsites');
  return (
    <div
      className="flex items-stretch gap-1 border border-(--color-rule) border-b-0 rounded-t-[3px] px-1 pt-1 overflow-x-auto"
      data-testid="microsite-files"
    >
      {Object.keys(files).map((path) => (
        <FileTab key={path} path={path} active={path === active} onSwitch={onSwitch} />
      ))}
      <AddFileButton onAdd={onAdd} label={t('addFile')} />
    </div>
  );
}

function FileTab(
  { path, active, onSwitch }: { path: string; active: boolean; onSwitch: (p: string) => void },
) {
  const tone = active
    ? 'bg-(--color-paper) text-(--color-ink) border-(--color-rule)'
    : 'text-(--color-muted) border-transparent hover:text-(--color-ink)';
  return (
    <button
      type="button" onClick={() => onSwitch(path)} data-testid={`microsite-file-${path}`}
      className={`mono text-[11px] px-3 py-1.5 border border-b-0 rounded-t-[3px] whitespace-nowrap ${tone}`}
    >
      {path}
    </button>
  );
}

// AddFileButton — an inline text field, not a window.prompt: the browser dialog is ugly and can't
// be driven in a test. Click the label → type a path → Enter (or blur) creates the file.
function AddFileButton(
  { onAdd, label }: { onAdd: (p: string) => void; label: string },
) {
  const t = useTranslations('adminPages.microsites');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const commit = useCallback(() => {
    onAdd(name.trim());
    setName('');
    setAdding(false);
  }, [name, onAdd]);
  return adding ? (
    <input
      autoFocus value={name} placeholder={t('addFilePlaceholder')} data-testid="microsite-add-file-input"
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => (e.key === 'Enter' ? commit() : undefined)}
      onBlur={commit}
      className="mono text-[11px] px-2 py-1.5 w-36 bg-transparent border-b border-(--color-accent) text-(--color-ink) outline-none"
    />
  ) : (
    <button
      type="button" onClick={() => setAdding(true)} data-testid="microsite-add-file"
      className="mono text-[11px] px-2 py-1.5 text-(--color-accent) hover:underline whitespace-nowrap"
    >
      {label}
    </button>
  );
}

// PreviewPane — the page's live render, resolved from the shared microsites list by slug. Its own
// component so PageEditor doesn't carry the list lookup + empty/render branch.
function PreviewPane({ slug }: { slug: string }) {
  const hook = useMicrosites();
  const staged = hook.rows.find((r) => r.slug === slug.trim());
  return staged === undefined ? <PreviewEmpty /> : <EditorPreview page={staged} />;
}

// EditorActions — no manual "build preview" button: the page auto-compiles as the owner types
// (useAutoBuild) and on open, so the preview is always current (owner: "他应该自己 compile，时刻都是
// 最新的"). What's left is Publish (promote the current build live) + the live build status.
function EditorActions(
  { slug, build, onPublish }:
  { slug: string; build: BuildView | null; onPublish: () => void },
) {
  const t = useTranslations('adminPages.microsites');
  const disabled = slug.trim() === '';
  return (
    <div className="flex items-center gap-3 mt-3">
      <button
        type="button" onClick={onPublish} disabled={disabled}
        data-testid="microsite-publish" className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40"
      >
        {t('publish')}
      </button>
      {disabled ? <NeedSlugHint /> : <BuildLine build={build} />}
    </div>
  );
}

// NeedSlugHint — why the build/publish buttons are disabled: a new page needs a slug before it can
// be built (the slug is the page's address). Says so, rather than leaving the owner to guess.
function NeedSlugHint() {
  const t = useTranslations('adminPages.microsites');
  return (
    <span data-testid="microsite-need-slug" className="mono text-[11px] text-(--color-faint)">
      {t('needSlug')}
    </span>
  );
}

function BuildLine({ build }: { build: BuildView | null }) {
  return build === null ? null : <BuildState build={build} />;
}

function BuildState({ build }: { build: BuildView }) {
  return build.status === 'failed'
    ? <BuildFailed message={build.error_message ?? ''} />
    : <BuildProgress built={build.status === 'built'} />;
}

function BuildFailed({ message }: { message: string }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <span data-testid="microsite-build-failed" className="mono text-[11px] text-(--color-accent)">
      {t('buildFailed')} · {message}
    </span>
  );
}

function BuildProgress({ built }: { built: boolean }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <span data-testid="microsite-build-status" className="mono text-[11px] text-(--color-muted)">
      {built ? t('buildBuilt') : t('buildRunning')}
    </span>
  );
}

// WidgetPanel — which SDK widgets this page can import. The builder vendors these; a gate pins the
// list to stay consistent with builder/vendor. Read-only reference (managing = importing them).
function WidgetPanel() {
  const t = useTranslations('adminPages.microsites');
  return (
    <details className="mt-4" data-testid="microsite-imports">
      <summary className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) cursor-pointer">
        {t('importsSummary')}
      </summary>
      <ul className="mt-2 space-y-2">
        {IMPORTABLE_MODULES.map((m) => <WidgetRow key={m.module} entry={m} />)}
      </ul>
    </details>
  );
}

function WidgetRow({ entry }: { entry: ImportableModule }) {
  return (
    <li className="reading text-[12px] text-(--color-muted)">
      <code className="mono text-[11.5px] text-(--color-ink)">{entry.module}</code>
      <span className="mono text-[11px]"> {entry.exports.join(' · ')}</span>
      <div className="text-[11.5px]">{entry.note}</div>
    </li>
  );
}

// EditorPreview — the page's live staging render, following builds via the shared long-poll.
function EditorPreview({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  const view = previewView(page);
  const src = usePinnedPreviewSrc(view.buildID, view.src);
  return src === '' ? <PreviewEmpty /> : (
    <div className="border border-(--color-rule) rounded-sm overflow-hidden" data-testid="microsite-staging">
      <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-(--color-rule)/60">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {t('stagingLabel')}
        </span>
        <span data-testid="microsite-staging-state" className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-muted)">
          {view.status}
        </span>
      </div>
      <iframe
        key={view.buildID} data-testid="microsite-staging-frame" src={src}
        title={t('stagingFrameTitle')} sandbox="allow-scripts"
        className="w-full h-[440px] border-0 bg-(--color-paper)"
      />
    </div>
  );
}

function PreviewEmpty() {
  const t = useTranslations('adminPages.microsites');
  return (
    <div
      data-testid="microsite-preview-empty"
      className="border border-dashed border-(--color-rule) rounded-[3px] h-[440px] grid place-items-center mono text-[11px] text-(--color-faint)"
    >
      {t('previewEmpty')}
    </div>
  );
}
