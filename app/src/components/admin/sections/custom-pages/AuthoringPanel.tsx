// AuthoringPanel —— 在面板上写一个自定义页：粘源码 → 构建 → 看状态 → 上线。
//
// 这一块以前不存在。写这一组的能力**一直都在**（create / write_file / build /
// get_build / promote_to_live 齐全），只在 MCP 上，而那条例外的理由是
// 「面板没有这个界面」—— 用现状解释现状。删掉例外之后收口点名要这几条，这里是它们的脸。
//
// 三件事刻意做出来：
//   · 构建是**异步**的，所以「在跑」「成了」「失败了」必须在屏幕上分得出来 ——
//     一个悄悄失败、线上还是旧页的构建，在 owner 眼里跟成功一模一样。
//   · 失败要把**后端说的那句话**原样摆出来，不是「构建失败」四个字。
//   · 上线是单独一步：构建成功不等于 owner 想让它上线。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { publishPage, type BuildView } from '@/lib/admin/use-custom-pages';
import { useAction } from '@/lib/ui/use-action';

const STARTER = `export default function App() {
  return <main><h1>Hello</h1></main>;
}`;

export function AuthoringPanel() {
  const t = useTranslations('adminPages.customPages');
  const run = useAction();
  const [slug, setSlug] = useState('');
  const [source, setSource] = useState(STARTER);
  const [build, setBuild] = useState<BuildView | null>(null);

  const publish = useCallback(() => {
    setBuild(null);
    void run(() => publishPage(slug, source, setBuild), { success: t('published') });
  }, [run, slug, source, t]);

  return (
    <section className="mt-6 border border-(--color-rule) rounded-[3px] p-4">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('authorHeading')}
      </div>
      <p className="reading text-[12.5px] text-(--color-muted) mb-3">{t('authorHelp')}</p>
      <SlugField value={slug} onChange={setSlug} />
      <SourceField value={source} onChange={setSource} />
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button" onClick={publish} disabled={slug === ''}
          data-testid="custom-page-publish"
          className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40"
        >
          {t('publish')}
        </button>
        <BuildLine build={build} />
      </div>
    </section>
  );
}

function SlugField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <label className="block mb-3">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('slugLabel')}
      </span>
      <input
        type="text" value={value} placeholder="press-kit"
        data-testid="custom-page-slug"
        onChange={(e) => onChange(e.target.value)}
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

function SourceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <label className="block">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('sourceLabel')}
      </span>
      <textarea
        value={value} rows={14}
        data-testid="custom-page-source"
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
      />
    </label>
  );
}

// BuildLine —— 「在跑 / 成了 / 失败了」三态必须分得出来，而失败那一态要把后端说的
// 那句话原样摆出来：owner 要修的是源码里的某一行，不是「构建失败」四个字。
function BuildLine({ build }: { build: BuildView | null }) {
  return build === null ? null : <BuildState build={build} />;
}

function BuildState({ build }: { build: BuildView }) {
  return build.status === 'failed'
    ? <BuildFailed message={build.error_message ?? ''} />
    : <BuildProgress built={build.status === 'built'} />;
}

// BuildFailed —— **把后端说的那句话原样摆出来**。owner 要修的是源码里的某一行，
// 而「构建失败」四个字对他没有任何用处。
function BuildFailed({ message }: { message: string }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span data-testid="custom-page-build-failed" className="mono text-[11px] text-(--color-accent)">
      {t('buildFailed')} · {message}
    </span>
  );
}

function BuildProgress({ built }: { built: boolean }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span data-testid="custom-page-build-status" className="mono text-[11px] text-(--color-muted)">
      {built ? t('buildBuilt') : t('buildRunning')}
    </span>
  );
}
