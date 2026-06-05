// ReportArtifactCard —— I.3: summarize_conversation tool_result 渲卡。
// AI 出一段 HTML 报告，浏览器 inline 渲在 sandboxed iframe + 顶部
// "open as page" 链接走 /report/[id]。
//
// Sandbox 策略: iframe sandbox="" 禁全 (no scripts / no forms / no same-
// origin) —— AI 输出的 HTML 完全不可信，只允许它 layout + 渲文本 / 图。
// inline iframe srcdoc 直接喂 html string，不走网络。
//
// /report/[id] 独立路由用同 html，但全屏 + print button。本 card 只是
// 文章流里的 sneak peek。

'use client';

import type { ToolCallView } from '@/lib/page/use-chat';
import { pickReport, type ReportPayload } from '@/lib/page/tool-call-shape';
import styles from '@/components/page/ReportArtifactCard.module.css';

export function ReportArtifactCard({ call }: { call: ToolCallView }) {
  const payload = pickReport(call.result);
  return payload === null ? null : <ReportArtifactBody payload={payload} />;
}

function ReportArtifactBody({ payload }: { payload: ReportPayload }) {
  return (
    <section
      className={styles['card']}
      data-testid="tool-card-summarize_conversation"
      data-report-id={payload.reportID}
    >
      <header className={styles['head']}>
        <span className={styles['kicker']}>report · generated</span>
        <a
          href={`/report/${payload.reportID}`}
          className={styles['openLink']}
          data-testid="report-open-link"
          target="_blank" rel="noopener noreferrer"
        >
          open as page ↗
        </a>
      </header>
      <iframe
        className={styles['frame']}
        title={`report ${payload.reportID}`}
        sandbox=""
        srcDoc={payload.html}
        data-testid="report-iframe"
      />
    </section>
  );
}
