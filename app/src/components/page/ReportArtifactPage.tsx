// ReportArtifactPage —— /report/[id] 独立路由的渲染层。client component
// 因为要 fetch 后写 iframe + iframe 触发 print。

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
      {/* 两颗动作归一组挂在右端。原来三个孩子直接吃 `space-between`，于是
          `DOWNLOAD PDF` 落在这条栏的**正中间**、`PRINT` 在右端 —— 同一类东西（对这份
          报告的动作）被排版拆成两处，读的人得逐个认。跟 UX-52 是同一族：一条栏上
          几类东西之间要有分组，而不是等距摊开。 */}
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
