// ReportArtifactPage —— the render layer for the standalone /report/[id]
// route. Client component because it fetches then writes an iframe, and the
// iframe triggers print.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  fetchReport, downloadReportPDF, type ReportLoadState,
} from '@/lib/page/report-fetch';
import { reportDocument } from '@/lib/page/report-document';
import styles from '@/components/page/ReportArtifactPage.module.css';

interface Props {
  reportID: string;
}

export function ReportArtifactPage({ reportID }: Props) {
  const t = useTranslations('page');
  const [state, setState] = useState<ReportLoadState>({ kind: 'loading' });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchReport(reportID).then((res) => {
      cancelled || setState(res);
    });
    return () => { cancelled = true; };
  }, [reportID]);

  return (
    <div className={styles['shell']} data-testid="report-page">
      {/* The two actions are grouped together at the right end. The three
          children used to sit directly on `space-between`, so `DOWNLOAD PDF`
          landed at the **dead center** of this bar and `PRINT` sat at the
          right end — the same class of thing (actions on this report) got
          split across two spots, forcing the reader to parse each one
          separately. Same family as UX-52: items on one bar need grouping
          by kind, not even spacing. */}
      <header className={styles['bar']}>
        <span className={styles['title']}>{t('report.title', { id: reportID.slice(0, 8) })}</span>
        <div className={styles['actions']}>
          <DownloadBtn reportID={reportID} ready={state.kind === 'ready'} />
          <PrintBtn iframeRef={iframeRef} ready={state.kind === 'ready'} />
        </div>
      </header>
      <ReportBody state={state} iframeRef={iframeRef} />
    </div>
  );
}

function PrintBtn({ iframeRef, ready }: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>; ready: boolean;
}) {
  const t = useTranslations('page');
  return (
    <button
      type="button" className={styles['printBtn']}
      disabled={!ready} onClick={() => triggerPrint(iframeRef)}
      data-testid="report-print"
    >
      {t('report.print')}
    </button>
  );
}

function DownloadBtn({ reportID, ready }: { reportID: string; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const onClick = () => {
    setBusy(true);
    void downloadReportPDF(reportID).finally(() => setBusy(false));
  };
  return (
    <button
      type="button" className={styles['printBtn']}
      disabled={!ready || busy} onClick={onClick}
      data-testid="report-download-pdf"
    >
      {busy ? 'downloading…' : 'download PDF ↓'}
    </button>
  );
}

function ReportBody({ state, iframeRef }: {
  state: ReportLoadState; iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const map = {
    loading: <Status text="loading report…" />,
    error: <Status text={state.kind === 'error' ? `error: ${state.message}` : ''} />,
    ready: <ReportFrame
      html={state.kind === 'ready' ? state.html : ''} iframeRef={iframeRef}
    />,
  } as const;
  return map[state.kind];
}

function ReportFrame({ html, iframeRef }: {
  html: string; iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  return (
    <iframe
      ref={iframeRef} className={styles['frame']} title="chat report body"
      sandbox="allow-same-origin" srcDoc={reportDocument(html)}
      data-testid="report-iframe"
    />
  );
}

function Status({ text }: { text: string }) {
  return <p className={styles['status']} data-testid="report-status">{text}</p>;
}

function triggerPrint(ref: React.RefObject<HTMLIFrameElement | null>): void {
  const w = ref.current?.contentWindow;
  w && w.print();
}
