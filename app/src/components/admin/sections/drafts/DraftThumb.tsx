// DraftThumb —— scaled-down ResumePage instance inside a DraftCard.
//
// Uses the same canonical <ResumePage> the composer preview + gotenberg
// /print route render. Two consequences:
//   1. Visual fidelity is automatic — what owner sees scaled here is
//      exactly what recruiter gets at scale=1.
//   2. Until /api/admin/drafts/<id> exposes resume_content + job_snapshot,
//      we use mockDraft() with the row's company / role / id grafted in
//      so the header strip + filename match what the card is labeled as
//      (so the thumb feels per-draft, not a static stand-in).
//
// Sizing: scale 0.30 turns a 612×792 page into ~184×238 px, which fits
// the existing 200px DraftCard right column without overflow.

'use client';

import { ResumePage } from '@/components/admin/resume-page/ResumePage';
import {
  draftToJobContext,
  draftToResumeContent,
  mockDraft,
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
        scale={THUMB_SCALE}
      />
    </div>
  );
}

function previewModel(row: AdminDraftRow): DraftModel {
  const base = mockDraft(row.id);
  return { ...base, company: row.company, role: row.role };
}
