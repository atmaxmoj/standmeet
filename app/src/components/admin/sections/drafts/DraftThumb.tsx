// DraftThumb —— scaled-down ResumePage instance inside a DraftCard.
//
// Uses the same canonical <ResumePage> the composer preview + gotenberg
// /print route render. Two consequences:
//   1. Visual fidelity is automatic — what owner sees scaled here is
//      exactly what recruiter gets at scale=1.
//   2. It draws THIS draft's resume_content, the same bytes the composer opens.
//
// It used to draw mockDraft() with the row's company / role grafted on — a design-era fixture
// that claimed a Stanford PhD and a Google Brain post under the owner's real name, identically
// on every card (F-E-20). On a job-application surface that is the worst direction to be wrong
// in: a glance at the card is how the owner decides the draft is ready to send.
//
// Sizing: scale 0.30 turns a 612×792 page into ~184×238 px, which fits
// the existing 200px DraftCard right column without overflow.

'use client';

import { ResumePage } from '@/components/admin/resume-page/ResumePage';
import { toDraftModel } from '@/lib/admin/draft-detail';
import {
  draftToJobContext,
  draftToResumeContent,
  type DraftModel,
} from '@/lib/admin/draft-model';
import type { AdminDraftRow } from '@/lib/admin/use-admin-drafts';

import styles from '@/components/admin/sections/drafts/DraftThumb.module.css';

const THUMB_SCALE = 0.30;
const PREVIEW_QR_URL = 'preview://standmeet/draft';

export function DraftThumb({ row }: { row: AdminDraftRow }) {
  const model = previewModel(row);
  return (
    <div className={styles.thumb} data-testid="draft-thumb">
      <ResumePage
        content={draftToResumeContent(model)}
        job={draftToJobContext(model)}
        qrURL={PREVIEW_QR_URL}
        pageIndex={0}
        // The thumbnail renders only the first page — it is the whole card, so the count is 1.
        pageCount={1}
        scale={THUMB_SCALE}
      />
    </div>
  );
}

// previewModel — routes through the **same** mapping as the composer (`toDraftModel`).
// A copied mapping would let the card and the opened draft drift apart over time —
// which is exactly the shape of the original bug.
function previewModel(row: AdminDraftRow): DraftModel {
  return toDraftModel({
    id: row.id, company: row.company, role: row.role,
    resume_content: row.resume_content,
  });
}
