// layout-model.test.ts —— the pure layout logic behind Spec 2's on-canvas drag: left-rail section
// order (reorder + reconcile) and the column-resize math. Asserts the transforms directly; the
// rendered-artifact side is covered by the Go render tests (left_order / left_width).

import { describe, it, expect } from 'vitest';

import {
  LEFT_SECTIONS, DEFAULT_LEFT_WIDTH, normalizeLeftOrder, reorderLeftSection, setLeftWidth,
  type DraftModel,
} from '@/lib/admin/draft-model';
import { nextLeftWidth } from '@/lib/admin/divider-drag';

function base(): DraftModel {
  return {
    id: 'd1', company: '', role: '', name: '', summary: '',
    contact: { email: '', phone: '', location: '', site: '' },
    skills: [], experience: [], education: [], social: [], custom: [],
    coverLetter: '', template: '', accent: '', fontScale: 1,
    leftOrder: [...LEFT_SECTIONS], leftWidth: DEFAULT_LEFT_WIDTH,
  };
}

describe('normalizeLeftOrder', () => {
  it('an empty stored order becomes the full default order', () => {
    expect(normalizeLeftOrder([])).toEqual(['skills', 'education', 'custom']);
  });
  it('a partial order keeps its keys and appends the missing ones', () => {
    expect(normalizeLeftOrder(['custom'])).toEqual(['custom', 'skills', 'education']);
  });
  it('junk keys are dropped; the result is always a permutation of the three sections', () => {
    expect(normalizeLeftOrder(['nope', 'education'])).toEqual(['education', 'skills', 'custom']);
  });
});

describe('reorderLeftSection', () => {
  it('moves a section to a new slot', () => {
    expect(reorderLeftSection(base(), 0, 2).leftOrder).toEqual(['education', 'custom', 'skills']);
  });
  it('an out-of-range or same index leaves the order unchanged', () => {
    expect(reorderLeftSection(base(), 0, 0).leftOrder).toEqual(['skills', 'education', 'custom']);
    expect(reorderLeftSection(base(), 0, 9).leftOrder).toEqual(['skills', 'education', 'custom']);
  });
});

describe('setLeftWidth', () => {
  it('keeps an in-range width', () => {
    expect(setLeftWidth(base(), 1.4).leftWidth).toBe(1.4);
  });
  it('clamps below and above so a column can never collapse or swallow the other', () => {
    expect(setLeftWidth(base(), 0.05).leftWidth).toBe(0.4);
    expect(setLeftWidth(base(), 9).leftWidth).toBe(2.4);
  });
});

describe('nextLeftWidth', () => {
  it('dragging right widens the left column (delta scaled by page width)', () => {
    expect(nextLeftWidth(0.9, 500, 500)).toBeCloseTo(4.9); // a full page-width sweep = +4 fr
  });
  it('dragging left narrows it', () => {
    expect(nextLeftWidth(2.0, -250, 500)).toBeCloseTo(0.0);
  });
  it('a zero page width is a no-op (nothing measured yet)', () => {
    expect(nextLeftWidth(1.2, 300, 0)).toBe(1.2);
  });
});
