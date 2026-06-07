// ReportArtifactPage —— /report/[id] 独立路由的渲染层。client component
// 因为要 fetch 后写 iframe + iframe 触发 print。

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  fetchReport, downloadReportPDF, type ReportLoadState,
} from '@/lib/page/report-fetch';
import styles from '@/components/page/ReportArtifactPage.module.css';

interface Props {
  reportID: string;
}

export function ReportArtifactPage({ reportID }: Props) {
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
      <header className={styles['bar']}>
        <span className={styles['title']}>report · {reportID.slice(0, 8)}</span>
        <DownloadBtn reportID={reportID} ready={state.kind === 'ready'} />
        <PrintBtn iframeRef={iframeRef} ready={state.kind === 'ready'} />
      </header>
      <ReportBody state={state} iframeRef={iframeRef} />
    </div>
  );
}

function PrintBtn({ iframeRef, ready }: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>; ready: boolean;
}) {
  return (
    <button
      type="button" className={styles['printBtn']}
      disabled={!ready} onClick={() => triggerPrint(iframeRef)}
      data-testid="report-print"
    >
      print ↗
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
      sandbox="allow-same-origin" srcDoc={html}
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
