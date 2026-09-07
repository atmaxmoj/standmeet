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
