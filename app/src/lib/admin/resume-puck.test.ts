// resume-puck.test.ts —— Q0 stage 1: the Puck ↔ ResumeContent projection. The core "no silent
// divergence" guard: what the owner arranges in Puck maps back to the canonical résumé exactly.

import { describe, it, expect } from 'vitest';

import { toPuckData, fromPuckData, SECTION, type PuckData } from '@/lib/admin/resume-puck';
import type { ResumeContent } from '@/lib/admin/resume-content';

// A fully-populated, normalized résumé (every field explicit; periods use null for "present") so the
// round-trip can be asserted exactly.
function fullContent(): ResumeContent {
  return {
    identity: {
      name: 'Sijie', email: 's@x.io', phone: '+1 555', locationLine: 'Remote', site: 'sijie.xyz',
    },
    summary: 'A backend engineer.',
    coverLetter: 'Dear team,',
    works: [
      {
        title: 'Senior Eng', company: 'Northwind', location: 'Remote',
        period: { start: '2020-01', end: '2023-06' }, bullets: ['shipped it', 'owned it'],
      },
      {
        title: 'Eng', company: 'Acme', location: 'NYC',
        period: { start: '2018-01', end: null }, bullets: ['built things'],
      },
    ],
    educations: [
      { school: 'State U', degree: 'BSc', period: { start: '2014', end: '2018' } },
    ],
    skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
    social: [{ kind: 'github', label: 'github', handle: '@sijie' }],
    custom: [{ label: 'Certifications', value: 'AWS SAA', kind: '' }],
    accent: '#2E5AAC',
    fontScale: 1.1,
    leftWidth: 0.9,
    leftOrder: ['skills', 'education', 'custom'],
  };
}

describe('resume-puck round-trip (U1)', () => {
  it('fromPuckData(toPuckData(rc)) preserves every section + setting exactly', () => {
    const rc = fullContent();
    expect(fromPuckData(toPuckData(rc))).toEqual(rc);
  });

  it('an ongoing role (period.end null) survives the round-trip as null, not ""', () => {
    const rc = fromPuckData(toPuckData(fullContent()));
    expect(rc.works[1]?.period.end).toBeNull();
    expect(rc.works[0]?.period.end).toBe('2023-06');
  });
});

describe('toPuckData component list (U2)', () => {
  it('emits the sections as components in canonical order', () => {
    const types = toPuckData(fullContent()).content.map((c) => c.type);
    expect(types).toEqual([
      SECTION.header, SECTION.summary,
      SECTION.experience, SECTION.experience, // two works
      SECTION.education, SECTION.skillset, SECTION.social, SECTION.custom,
    ]);
  });
});

// U5 — every emitted component MUST carry a unique, non-empty string props.id. Puck's ComponentData
// types props as WithId<Props> (id required) and keys its internal component store by props.id; when
// toPuckData omitted it, every item shared id===undefined, so the ids collided — the canvas rendered
// duplicates of one section (the owner saw "all SkillSet") and selecting/editing a component threw a
// client-side exception (the white-screen composer). Derived-from-resume_content is the broken path
// (a draft whose puck_data is null): Puck adds ids itself on drag, so saved docs were fine.
describe('toPuckData gives every component a unique Puck id (U5)', () => {
  it('each content item has a unique, non-empty props.id', () => {
    const content = toPuckData(fullContent()).content;
    const ids = content.map((c) => c.props['id']);
    for (const id of ids) {
      expect(typeof id, 'every Puck component needs a string props.id').toBe('string');
      expect(id, 'the id must be non-empty').not.toBe('');
    }
    expect(new Set(ids).size, 'ids must be unique across the document (else Puck collapses them)')
      .toBe(content.length);
  });

  // The realistic shape that broke on sijie (draft 0533bda3): identity + summary + two educations +
  // one skill set, no works. The derived doc must still be a set of DISTINCT, id-bearing components.
  it('a no-works résumé still yields distinct, id-bearing sections (not all-one-type)', () => {
    const rc: ResumeContent = {
      identity: { name: 'E', email: 'e@e.io', phone: '', locationLine: 'Remote', site: '' },
      summary: '就过来看过来', coverLetter: '',
      works: [],
      educations: [
        { school: 'cwdvae', degree: '', period: { start: '', end: null } },
        { school: 'ca dca d', degree: 'v sad', period: { start: '', end: null } },
      ],
      skills: [{ category: '', items: ['x'] }],
      social: [], custom: [], accent: '', fontScale: 1, leftWidth: 0.9,
      leftOrder: ['skills', 'education', 'custom'],
    };
    const content = toPuckData(rc).content;
    expect(content.map((c) => c.type)).toEqual([
      SECTION.header, SECTION.summary, SECTION.education, SECTION.education, SECTION.skillset,
    ]);
    expect(new Set(content.map((c) => c.props['id'])).size, 'all five ids are distinct').toBe(5);
  });
});

// U6 — many components of ONE type still get distinct ids (the id is `${type}-${globalIndex}`, so
// ten works never collide with each other). A per-type counter would have repeated Experience-0.
describe('toPuckData ids are unique even with many of one type (U6)', () => {
  it('ten works produce ten distinct ids', () => {
    const rc = fullContent();
    rc.works = Array.from({ length: 10 }, (_, i) => ({
      title: `role ${i}`, company: `co ${i}`, location: '', period: { start: '2020', end: null }, bullets: [],
    }));
    const content = toPuckData(rc).content;
    const workIds = content.filter((c) => c.type === SECTION.experience).map((c) => c.props['id']);
    expect(workIds).toHaveLength(10);
    expect(new Set(workIds).size, 'each of the ten works has its own id').toBe(10);
  });
});

// U7 — fromPuckData reads by type + named fields and never by id, so a document whose items carry
// Puck's OWN generated ids (what a saved puck_data looks like after a drag) maps back exactly. This
// pins that the id we now stamp is inert on the way back — the round-trip can't come to depend on it.
describe('fromPuckData ignores component ids (U7)', () => {
  it('a doc with Puck-style ids on every item round-trips the same as without', () => {
    const bare = toPuckData(fullContent());
    const withIds: PuckData = {
      ...bare,
      content: bare.content.map((c, i) => ({ ...c, props: { ...c.props, id: `puck-generated-${i}` } })),
    };
    expect(fromPuckData(withIds)).toEqual(fromPuckData(bare));
  });
});

// U8 — an essentially empty résumé (no works/educations, empty skill items) must still project to a
// valid, unique-id document and round-trip — a draft the agent just created, opened before any edit,
// must not hand Puck a malformed shape.
describe('an empty résumé still projects cleanly (U8)', () => {
  const empty: ResumeContent = {
    identity: { name: '', email: '', phone: '', locationLine: '', site: '' },
    summary: '', coverLetter: '',
    works: [], educations: [], skills: [{ category: '', items: [] }],
    social: [], custom: [], accent: '', fontScale: 1, leftWidth: 0.9,
    leftOrder: ['skills', 'education', 'custom'],
  };
  it('projects to header + summary + one skillset, all with unique ids', () => {
    const content = toPuckData(empty).content;
    expect(content.map((c) => c.type)).toEqual([SECTION.header, SECTION.summary, SECTION.skillset]);
    expect(new Set(content.map((c) => c.props['id'])).size).toBe(content.length);
  });
  it('round-trips back to the same empty résumé', () => {
    expect(fromPuckData(toPuckData(empty))).toEqual(empty);
  });
});

describe('fromPuckData grouping (U3)', () => {
  it('groups by type in content order; keeps repeatable order; ignores unknown types', () => {
    const pd: PuckData = {
      root: { props: { accent: '', fontScale: 1, leftWidth: 0.9, leftOrder: ['skills'], coverLetter: '' } },
      content: [
        { type: 'Nonsense', props: { x: 1 } }, // unknown → ignored
        { type: SECTION.experience, props: { title: 'B', company: 'B', location: '', start: '', end: '', bullets: [] } },
        { type: SECTION.header, props: { name: 'N', email: '', locationLine: '' } },
        { type: SECTION.experience, props: { title: 'A', company: 'A', location: '', start: '', end: '', bullets: [] } },
      ],
      zones: {},
    };
    const rc = fromPuckData(pd);
    expect(rc.identity.name).toBe('N');
    expect(rc.works.map((w) => w.title)).toEqual(['B', 'A']); // content order kept
    expect(rc.educations).toEqual([]); // none present
  });
});

// U4 — MOVING sections must change the canonical output, per repeatable type AND for the left-rail
// order. These are the "reorder actually reorders" guards: they feed a NON-DEFAULT arrangement and
// assert the output follows it, so a future change that stopped honouring arrangement goes RED here
// (an identity round-trip would stay green because it never moves anything).
describe('reorder is honoured — moving sections reaches resume_content (U4)', () => {
  const item = (type: string, props: Record<string, unknown>) => ({ type, props });

  it('reordering repeatable entries (works, educations) flips their canonical order', () => {
    // Default seed order is [Alpha, Beta] / [Old U, New U]; here they are dragged into the reverse.
    const pd: PuckData = {
      root: { props: { accent: '', fontScale: 1, leftWidth: 0.9, leftOrder: ['skills', 'education', 'custom'], coverLetter: '' } },
      content: [
        item(SECTION.experience, { title: 'Beta', company: 'Beta', location: '', start: '', end: '', bullets: [] }),
        item(SECTION.experience, { title: 'Alpha', company: 'Alpha', location: '', start: '', end: '', bullets: [] }),
        item(SECTION.education, { school: 'New U', degree: '', start: '', end: '' }),
        item(SECTION.education, { school: 'Old U', degree: '', start: '', end: '' }),
      ],
      zones: {},
    };
    const rc = fromPuckData(pd);
    expect(rc.works.map((w) => w.company), 'works follow the dragged order').toEqual(['Beta', 'Alpha']);
    expect(rc.educations.map((e) => e.school), 'educations follow the dragged order').toEqual(['New U', 'Old U']);
  });

  it('a non-default left-rail order is carried through verbatim (leftOrder)', () => {
    const reordered = ['custom', 'skills', 'education']; // moved from the ['skills','education','custom'] default
    const pd: PuckData = {
      root: { props: { accent: '', fontScale: 1, leftWidth: 0.9, leftOrder: reordered, coverLetter: '' } },
      content: [item(SECTION.header, { name: 'N', email: '', locationLine: '' })],
      zones: {},
    };
    expect(fromPuckData(pd).leftOrder, 'the left-rail arrangement reaches resume_content').toEqual(reordered);
  });
});
