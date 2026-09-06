// App.tsx — the default StandMeet homepage, authored as a microsite.
//
// This is the seed installed as the reserved `home` page at claim. It IS the homepage now — a
// microsite pinned to `/` — so the owner edits it like any other page.
//
// It reproduces the original long-scroll public page (hero → insights → projects → where I am →
// contact), composing the managed SDK widgets where a widget exists and hand-writing the rest as
// EDIT-ME prose. Styling uses the StandMeet design system shipped into every build
// (builder/template/src/theme.css): tokens (--color-*), the .reading / .link / .mono / .rule
// utilities, Newsreader serif + JetBrains Mono.
//
// Widgets: AgentWidget (ask box → /gate) · CorpusWidget (published entries as inline cards) ·
// GateWidget (access CTA) · PageNavWidget (the owner's other pages).

import React, { useEffect, useState } from 'react';
import {
  AgentWidget, GateWidget, CorpusWidget, PageNavWidget,
} from '@standmeet/sdk';

interface Instance { handle: string; name: string }
interface Project { name: string; tagline: string; lines: string[]; url: string }

// EDIT ME — your opening line. The one thing this page always leads with.
const HERO = 'I think out loud here. Ask me anything, or read what I have been working through.';

// EDIT ME — a few questions worth asking, to prime a visitor.
const EXAMPLES = ['What are you thinking about lately?', 'What are you building?'];

// EDIT ME — what you are building. Typography only; a name, a one-line tagline, a couple of lines,
// and an optional link. Delete the ones you do not need.
const PROJECTS: Project[] = [
  {
    name: 'Your project',
    tagline: 'one line on what it is',
    lines: ['A sentence about where it stands today.', 'A second sentence if it earns its place.'],
    url: 'example.com',
  },
  {
    name: 'Another thing',
    tagline: 'what it does',
    lines: ['What is true about it right now.'],
    url: '',
  },
];

// EDIT ME — where you are and what you are open to. Leave `lookingFor` empty to hide the list.
const WHERE = {
  location: 'Based somewhere — say where you are and your status (PR, visa, remote-only, …).',
  status: 'A short paragraph on what you have been doing and what you are open to next. Be specific: the more honest this is, the better the chat answers for you.',
  lookingFor: [
    'the kind of role you actually want',
    'the stage / size of company that fits',
    'a real constraint that matters to you',
  ],
  closing: 'Otherwise — just here to think out loud.',
};

// EDIT ME — how people reach you.
const CONTACT = {
  email: 'you@example.com',
  chatLine: 'Ask via the chat above. It knows my views on most things and answers in my voice, grounded in the notes here.',
  recruiter: 'If you are a recruiter or hiring manager, send the role + company first so we can both decide if a call makes sense. Generic outreach I rarely answer.',
  casual: 'If you just want to talk ideas — anything on this page — I usually have time.',
};

export default function App() {
  const [inst, setInst] = useState<Instance | null>(null);
  useEffect(() => {
    fetch('/api/v1/instance').then((r) => r.json()).then((d: Instance) => setInst(d)).catch(() => {});
  }, []);

  return (
    <main className="mx-auto max-w-[720px] px-6 min-h-screen">
      {/* HERO — identity line + ask box. */}
      <section className="pt-20 md:pt-28">
        <div className="mono text-[10.5px] tracking-[0.22em] uppercase text-(--color-muted) mb-6">
          <span className="text-(--color-accent)">●</span> {inst ? inst.name : ' '}
        </div>
        <p className="font-serif text-(--color-ink) text-[clamp(28px,3.6vw,42px)] leading-[1.28] font-[380] tracking-[-0.014em] [text-wrap:pretty] max-w-[24ch] mb-12">
          {HERO}
        </p>
        <AgentWidget examples={EXAMPLES} />
      </section>

      {/* INSIGHTS — published corpus entries as inline-expanding cards. */}
      <section className="mt-24">
        <CorpusWidget heading="things I’ve been thinking about" />
      </section>

      {/* PROJECTS — typography only. */}
      <section className="mt-24">
        <SectionHead kicker="what I’m building" />
        <ul className="space-y-9">
          {PROJECTS.map((p) => <ProjectItem key={p.name} project={p} />)}
        </ul>
      </section>

      {/* WHERE I AM — location + status + what you are looking for. */}
      <section className="mt-24">
        <SectionHead kicker="where I am" />
        <div className="reading text-(--color-ink)">
          <p>{WHERE.location}</p>
          <p className="mt-4">{WHERE.status}</p>
          <LookingFor items={WHERE.lookingFor} />
          <p className="font-serif italic text-(--color-muted) mt-6">{WHERE.closing}</p>
        </div>
      </section>

      {/* CONTACT — chat, email, and how to approach. */}
      <section className="mt-24">
        <SectionHead kicker="how to talk to me" />
        <div className="reading text-(--color-ink) space-y-5">
          <p>{CONTACT.chatLine}</p>
          <p>
            Or directly:{' '}
            <a href={`mailto:${CONTACT.email}`} className="link mono text-[15.5px]">{CONTACT.email}</a>
          </p>
          <p className="text-(--color-muted)">{CONTACT.recruiter}</p>
          <p className="text-(--color-muted)">{CONTACT.casual}</p>
        </div>
      </section>

      {/* GATE — the access CTA (enter a code / bring a key / request access). */}
      <section className="mt-24">
        <GateWidget />
      </section>

      {/* PAGE NAV — the owner's other pages (this one, `home`, is excluded). */}
      <section className="mt-24">
        <PageNavWidget exclude="home" />
      </section>

      <footer className="mt-24 pb-20 mono text-[10px] tracking-[0.15em] uppercase text-(--color-faint)">
        {inst ? `${inst.name} · standmeet` : ' '}
      </footer>
    </main>
  );
}

// SectionHead — a small mono kicker with a rule, matching the original page's section headers.
function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-6">
      <span className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-faint)">{kicker}</span>
      <span className="flex-1 h-px bg-(--color-rule)" />
    </div>
  );
}

// ProjectItem — one project: name — tagline, then a few lines behind a left rule, optional link.
function ProjectItem({ project }: { project: Project }) {
  return (
    <li>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <h3 className="font-serif text-(--color-ink) text-[24px] font-medium tracking-[-0.012em] leading-[1.1]">
          {project.name}
        </h3>
        <span className="mono text-(--color-faint)">──</span>
        <span className="font-serif italic text-(--color-muted) text-[17px] leading-[1.3]">{project.tagline}</span>
      </div>
      <div className="text-(--color-ink) space-y-1.5 pl-5 border-l border-(--color-rule) text-[16px] leading-[1.6]">
        {project.lines.map((line, i) => <p key={i}>{line}</p>)}
        {project.url ? <p className="mono text-[12.5px] tracking-[0.04em] pt-1"><a href={`https://${project.url}`} className="link">{project.url} ↗</a></p> : null}
      </div>
    </li>
  );
}

// LookingFor — the "if you're hiring, it should fit all of these" checklist. Hidden when empty.
function LookingFor({ items }: { items: string[] }) {
  return items.length > 0 ? (
    <>
      <p className="mt-5 mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted)">
        if you’re hiring, it should fit all of these
      </p>
      <ul className="space-y-1 mt-2 pl-5 border-l-2 border-(--color-accent) font-serif text-[16.5px]">
        {items.map((f) => <li key={f}>· {f}</li>)}
      </ul>
    </>
  ) : null;
}
