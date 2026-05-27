// PreviewPane —— ResumeComposer 右侧 PDF-shape 文字预览。
//
// 不做真 PDF render —— vector render 在 backend resumerender 包里跑（per
// memory:feedback-pdf-ephemeral，PDF 永远 ephemeral，server 现 render
// bytes）。这里只是 owner 边编辑边看版式的快速反馈：8.5×11 比例的纸张
// + serif body + monocaps header，跟最终 PDF 字距大致对齐。
//
// 设计源 docs/design/project/admin.js ResumePage (1682-1750)。

'use client';

import type { DraftModel } from '@/lib/admin/draft-model';

interface Props {
  model: DraftModel;
  zoom: number;       // 0.4 .. 1.2
  page: number;       // 0 .. pages-1
  onZoom: (z: number) => void;
  onPage: (i: number) => void;
}

export function PreviewPane({ model, zoom, page, onZoom, onPage }: Props) {
  const totalPages = model.coverLetter.trim() !== '' ? 2 : 1;
  return (
    <div className="sm-composer-preview">
      <PreviewToolbar
        zoom={zoom} onZoom={onZoom}
        page={page} totalPages={totalPages} onPage={onPage}
      />
      <div className="sm-composer-preview-scroll">
        <PreviewPaper model={model} page={page} zoom={zoom} />
      </div>
    </div>
  );
}

function PreviewToolbar({
  zoom, onZoom, page, totalPages, onPage,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  page: number;
  totalPages: number;
  onPage: (i: number) => void;
}) {
  return (
    <div className="sm-composer-preview-toolbar">
      <ZoomControls zoom={zoom} onZoom={onZoom} />
      <PageNav page={page} totalPages={totalPages} onPage={onPage} />
    </div>
  );
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  return (
    <div className="flex items-center gap-2 mono text-[10px] text-(--color-muted)">
      <button
        type="button" onClick={() => onZoom(Math.max(0.4, zoom - 0.1))}
        className="sm-btn sm-btn-ghost sm-btn-sm"
      >−</button>
      <span className="tabular-nums w-[36px] text-center">{Math.round(zoom * 100)}%</span>
      <button
        type="button" onClick={() => onZoom(Math.min(1.2, zoom + 0.1))}
        className="sm-btn sm-btn-ghost sm-btn-sm"
      >+</button>
    </div>
  );
}

function PageNav({
  page, totalPages, onPage,
}: { page: number; totalPages: number; onPage: (i: number) => void }) {
  return totalPages > 1 ? (
    <div className="flex items-center gap-2 mono text-[10px] text-(--color-muted)">
      <button
        type="button" onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="sm-btn sm-btn-ghost sm-btn-sm"
      >←</button>
      <span className="tabular-nums">{page + 1} / {totalPages}</span>
      <button
        type="button" onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
        disabled={page === totalPages - 1}
        className="sm-btn sm-btn-ghost sm-btn-sm"
      >→</button>
    </div>
  ) : null;
}

function PreviewPaper({
  model, page, zoom,
}: { model: DraftModel; page: number; zoom: number }) {
  return (
    <div
      className={`sm-composer-preview-page sm-zoom [--zoom:${zoom}]`}
    >
      {page === 0 ? <ResumeFace model={model} /> : <CoverFace model={model} />}
    </div>
  );
}

function ResumeFace({ model }: { model: DraftModel }) {
  return (
    <div className="space-y-5">
      <PaperHeader model={model} />
      <Hr />
      <PaperSection title="summary"><p className="reading">{model.summary}</p></PaperSection>
      <PaperSection title="skills">
        <p className="reading text-[14px]">{model.skills.join(' · ')}</p>
      </PaperSection>
      <PaperSection title="experience">
        {model.experience.map((e) => (
          <ExperienceBlock key={e.id} org={e.org} role={e.role} range={e.range} loc={e.loc} bullets={e.bullets} />
        ))}
      </PaperSection>
      <PaperSection title="education">
        {model.education.map((e) => (
          <EducationBlock key={e.id} school={e.school} degree={e.degree} range={e.range} />
        ))}
      </PaperSection>
    </div>
  );
}

function PaperHeader({ model }: { model: DraftModel }) {
  return (
    <header>
      <h1 className="font-serif text-[24px] leading-[1.1] tracking-[-0.012em] text-(--color-ink) font-normal">
        {model.company}
      </h1>
      <p className="font-serif italic text-[16px] text-(--color-muted) mt-1">{model.role}</p>
      <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-3 flex flex-wrap items-baseline gap-2">
        <span>{model.contact.email}</span>
        <span>·</span>
        <span>{model.contact.location}</span>
        <span>·</span>
        <span>{model.contact.site}</span>
      </div>
    </header>
  );
}

function Hr() {
  return <hr className="border-(--color-rule)" />;
}

function PaperSection({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="sm-smallcaps mb-2">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ExperienceBlock({
  org, role, range, loc, bullets,
}: {
  org: string; role: string; range: string; loc: string; bullets: readonly string[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-serif text-[15px] text-(--color-ink) font-medium">
          {org} · {role}
        </span>
        <span className="mono text-[10px] text-(--color-muted) tracking-[0.04em]">
          {range} · {loc}
        </span>
      </div>
      <ul className="reading text-[14px] mt-1 space-y-1 pl-4 border-l border-(--color-rule)">
        {bullets.map((b, i) => <li key={i}>· {b}</li>)}
      </ul>
    </div>
  );
}

function EducationBlock({
  school, degree, range,
}: { school: string; degree: string; range: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <span className="font-serif text-[14.5px] text-(--color-ink)">
        {school} · {degree}
      </span>
      <span className="mono text-[10px] text-(--color-muted) tracking-[0.04em]">{range}</span>
    </div>
  );
}

function CoverFace({ model }: { model: DraftModel }) {
  return (
    <div>
      <PaperHeader model={model} />
      <Hr />
      <div className="mt-5">
        <div className="sm-smallcaps mb-2">cover letter</div>
        <p className="reading whitespace-pre-wrap">{model.coverLetter}</p>
      </div>
    </div>
  );
}
