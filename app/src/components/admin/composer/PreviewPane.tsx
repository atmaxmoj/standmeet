// PreviewPane —— ResumeComposer 右侧 PDF-shape 预览。
//
// Renders the canonical <ResumePage> component (same one gotenberg
// prints at applications.commit), scaled to fit the composer pane.
// Continuous vertical scroll: page 1 on top, page 2 below — matches the
// post-2026-05-28 design intent (像翻 PDF 那样往下滚，而不是翻页 arrow).
//
// Source of truth: docs/design/project/admin.js ResumeComposer
// PreviewPane section (1695-1713).

'use client';

import { ResumePage } from '@/components/admin/resume-page/ResumePage';
import {
  draftToJobContext,
  draftToResumeContent,
  type DraftModel,
} from '@/lib/admin/draft-model';

import styles from '@/components/admin/composer/PreviewPane.module.css';

interface Props {
  model: DraftModel;
  zoom: number;       // 0.4 .. 1.2
  /** Legacy page nav prop; ignored now (continuous scroll). Kept so the
   * ResumeComposer signature doesn't churn. */
  page: number;
  onZoom: (z: number) => void;
  /** Legacy page setter; ignored. */
  onPage: (i: number) => void;
}

const PREVIEW_QR_URL = 'preview://standmeet/draft';

export function PreviewPane({ model, zoom, onZoom }: Props) {
  const view = derivePreview(model);
  return (
    <div className={styles.preview}>
      <PreviewToolbar
        zoom={zoom} onZoom={onZoom}
        pageCount={view.pageCount} fileName={view.fileName}
      />
      <PreviewStack view={view} zoom={zoom} />
    </div>
  );
}

interface PreviewView {
  content: ReturnType<typeof draftToResumeContent>;
  job: ReturnType<typeof draftToJobContext>;
  pageCount: number;
  fileName: string;
  hasCover: boolean;
}

function derivePreview(model: DraftModel): PreviewView {
  const content = draftToResumeContent(model);
  const hasCover = (content.coverLetter ?? '').trim() !== '';
  return {
    content,
    job: draftToJobContext(model),
    hasCover,
    pageCount: hasCover ? 2 : 1,
    fileName: fileNameFor(model),
  };
}

function PreviewStack({ view, zoom }: { view: PreviewView; zoom: number }) {
  return (
    <div className={styles.scroll}>
      <ResumePage content={view.content} job={view.job} qrURL={PREVIEW_QR_URL} pageIndex={0} scale={zoom} />
      {view.hasCover ? (
        <ResumePage content={view.content} job={view.job} qrURL={PREVIEW_QR_URL} pageIndex={1} scale={zoom} />
      ) : null}
    </div>
  );
}

function PreviewToolbar({
  zoom, onZoom, pageCount, fileName,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  pageCount: number;
  fileName: string;
}) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.fileName}>preview · {fileName}</span>
      <div className={styles.right}>
        <span className={styles.pageCount}>{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
        <span className={styles.dot}>·</span>
        <ZoomControls zoom={zoom} onZoom={onZoom} />
      </div>
    </div>
  );
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  return (
    <span className={styles.zoom}>
      <button
        type="button" onClick={() => onZoom(Math.max(0.4, zoom - 0.1))}
        className={styles.zoomBtn}
        aria-label="zoom out"
      >−</button>
      <span className={styles.zoomPct}>{Math.round(zoom * 100)}%</span>
      <button
        type="button" onClick={() => onZoom(Math.min(1.2, zoom + 0.1))}
        className={styles.zoomBtn}
        aria-label="zoom in"
      >+</button>
    </span>
  );
}

function fileNameFor(model: DraftModel): string {
  const co = (model.company || 'draft').toLowerCase().replace(/\s+/g, '-');
  return `resume_${co}.pdf`;
}
