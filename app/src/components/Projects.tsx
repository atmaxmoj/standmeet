// Projects —— typography-only：name + "──" mono + italic tagline 一行，
// 下方 lines list 用左侧 1px rule 引导阅读。url 摆 mono accent。

import type { PageProject } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Projects({ projects }: { projects: readonly PageProject[] }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="what I'm building" count={projects.length} />
      <ul className="space-y-9">
        {projects.map((p) => <ProjectRow key={p.id} project={p} />)}
      </ul>
    </section>
  );
}

function ProjectRow({ project }: { project: PageProject }) {
  return (
    <li>
      <ProjectHead name={project.name} tagline={project.tagline} />
      <ProjectBody lines={project.lines} url={project.url} />
    </li>
  );
}

function ProjectHead({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap mb-3">
      <h3 className="font-serif text-(--color-ink) text-[24px] font-medium tracking-[-0.012em] leading-[1.1]">
        {name}
      </h3>
      <span className="mono text-(--color-faint)">{'──'}</span>
      <span className="font-serif italic text-(--color-muted) text-[17px] leading-[1.3]">
        {tagline}
      </span>
    </div>
  );
}

function ProjectBody({ lines, url }: { lines: readonly string[]; url?: string | null }) {
  return (
    <div className="reading text-(--color-ink) space-y-1.5 pl-5 border-l border-(--color-rule) text-[16px]">
      {lines.map((line) => <p key={line}>{line}</p>)}
      {url && <ProjectURL url={url} />}
    </div>
  );
}

function ProjectURL({ url }: { url: string }) {
  return (
    <p className="mono text-[12.5px] tracking-[0.04em] pt-1">
      <a
        href={`https://${url}`}
        target="_blank"
        rel="noreferrer"
        className="text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent) transition-colors"
      >
        {url} ↗
      </a>
    </p>
  );
}
