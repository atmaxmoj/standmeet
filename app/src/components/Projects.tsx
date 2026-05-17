// Projects section —— typography-only：name + tagline + 多行 prose + 可选 URL。

import type { PageProject } from '@/lib/api/public';

export function Projects({ projects }: { projects: PageProject[] }) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 space-y-10">
      <SectionLabel text="projects" />
      {projects.map((p) => <ProjectItem key={p.id} project={p} />)}
    </section>
  );
}

function ProjectItem({ project }: { project: PageProject }) {
  return (
    <article className="space-y-2">
      <ProjectHeader name={project.name} tagline={project.tagline} url={project.url} />
      <ul className="reading text-base space-y-1">
        {project.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </article>
  );
}

function ProjectHeader({
  name, tagline, url,
}: { name: string; tagline: string; url?: string | null }) {
  return (
    <h3 className="reading reading-tight text-xl font-medium">
      {url ? (
        <a className="link" href={`https://${url}`} target="_blank" rel="noreferrer">{name}</a>
      ) : name}
      <span className="mono text-sm text-(--color-muted) ml-3 align-baseline">{tagline}</span>
    </h3>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <header className="flex items-center gap-4">
      <span className="smallcaps">{text}</span>
      <hr className="rule rule-soft flex-1" />
    </header>
  );
}
