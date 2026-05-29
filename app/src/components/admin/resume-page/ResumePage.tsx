// ResumePage —— canonical 8.5×11 resume layout used both as the admin
// composer live preview AND as the gotenberg /print target. Source of
// truth for "what the recruiter sees" — Chromium renders this page,
// gotenberg prints it.
//
// Design source: docs/design/project/admin.js ResumePage (1738-2044) +
// chat1.md iteration 2026-05-28 (字号缩到真印刷比例 / 连续竖滚预览).
//
// Page geometry locked at 612×792pt = 612×792px (PDF point ≈ px at 96dpi
// when CSS sizes use px and the print viewport is set to US Letter). To
// scale for in-browser preview (e.g. composer 0.62 fit-to-screen),
// pass `scale` — the component wraps itself in a transform: scale wrapper
// so it occupies the smaller box without losing pixel ratios inside.

import {
  formatPeriod, longDate, stripScheme, today,
} from '@/components/admin/resume-page/format';
import { QRCode } from '@/components/admin/resume-page/QRCode';
import type { ResumeContent } from '@/lib/admin/resume-content';

import styles from '@/components/admin/resume-page/ResumePage.module.css';

export interface JobContext {
  /** Role title the resume is applied for (header strip line 2). */
  role: string;
  /** Recipient company name. */
  company: string;
}

export interface ResumePageProps {
  content: ResumeContent;
  job: JobContext;
  /** Per-application QR target. Empty string skips the QR card + footer. */
  qrURL: string;
  /** 0 = main resume, 1 = cover letter. */
  pageIndex: 0 | 1;
  /** Display scale (default 1 = print-true). */
  scale?: number;
}

export function ResumePage(props: ResumePageProps) {
  return (
    <ScaledWrap scale={props.scale ?? 1}>
      <PageInner {...props} />
    </ScaledWrap>
  );
}

function ScaledWrap({ scale, children }: { scale: number; children: React.ReactNode }) {
  // Composer zoom slider drives a per-render transform value — exactly
  // the "truly runtime-dynamic" case the inline-style rule documents as
  // the disable-with-a-why exception.
  return scale === 1 ? (
    <div className={styles.pageWrap} data-testid="resume-page">{children}</div>
  ) : (
    // eslint-disable-next-line no-restricted-syntax -- composer zoom slider is dynamic per render
    <div className={styles.pageWrapScaled} data-testid="resume-page" style={{ transform: `scale(${scale})` }}>
      {children}
    </div>
  );
}

function PageInner({ content, job, qrURL, pageIndex }: ResumePageProps) {
  return (
    <div className={styles.page}>
      {pageIndex === 0
        ? <ResumeFront content={content} job={job} qrURL={qrURL} />
        : <CoverBack content={content} job={job} qrURL={qrURL} />}
    </div>
  );
}

function ResumeFront(props: { content: ResumeContent; job: JobContext; qrURL: string }) {
  const { content, job, qrURL } = props;
  return (
    <>
      <HeaderStrip identity={content.identity} job={job} qrURL={qrURL}
        socials={content.social ?? []} />
      <SectionHead>summary</SectionHead>
      <p className={styles.summary}>{content.summary}</p>
      <div className={styles.body}>
        <LeftRail content={content} company={job.company} />
        <MainColumn works={content.works} />
      </div>
      <FrontFooter qrURL={qrURL} />
    </>
  );
}

function HeaderStrip(props: {
  identity: ResumeContent['identity'];
  job: JobContext;
  qrURL: string;
  socials: NonNullable<ResumeContent['social']>;
}) {
  return (
    <div className={styles.headerStrip}>
      <div className={styles.headerText}>
        <NameBlock name={props.identity.name} />
        <RoleLine job={props.job} />
        <MetaLine identity={props.identity} />
        <SocialLine socials={props.socials} />
      </div>
      <QRCard url={props.qrURL} />
    </div>
  );
}

function NameBlock({ name }: { name: string }) {
  return (
    <h1 className={styles.name}>
      {name.toLowerCase()}
      <span className={styles.accentDot}>.</span>
    </h1>
  );
}

function RoleLine({ job }: { job: JobContext }) {
  return (
    <div className={styles.roleLine}>
      {job.role}
      <span className={styles.dotSep}>·</span>
      for <span className={styles.roleCompany}>{job.company}</span>
    </div>
  );
}

function MetaLine({ identity }: { identity: ResumeContent['identity'] }) {
  return (
    <div className={styles.metaLine}>
      {identity.email}
      <span className={styles.dotSep}>·</span>
      {identity.locationLine}
      {identity.site ? (
        <>
          <span className={styles.dotSep}>·</span>
          <span className={styles.metaInk}>{identity.site}</span>
        </>
      ) : null}
    </div>
  );
}

function SocialLine({ socials }: { socials: NonNullable<ResumeContent['social']> }) {
  const visible = socials.filter((s) => s.handle);
  return visible.length === 0 ? null : (
    <div className={styles.socialLine}>
      {visible.map((s) => (
        <span key={s.kind + s.handle} className={styles.socialEntry}>
          <span className={styles.socialLabel}>{s.label || s.kind}</span>
          <span className={styles.metaInk}>{stripScheme(s.handle)}</span>
        </span>
      ))}
    </div>
  );
}

function QRCard({ url }: { url: string }) {
  return url ? (
    <div className={styles.qrCard}>
      <QRCode value={url} size={68} />
    </div>
  ) : null;
}

function SectionHead({ children }: { children: string }) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionRuleLeft} />
      <span className={styles.label}>{children}</span>
      <span className={styles.sectionRuleRight} />
    </div>
  );
}

function LeftRail(props: { content: ResumeContent; company: string }) {
  return (
    <div className={styles.leftRail}>
      <SkillsRail items={flattenSkills(props.content.skills)} />
      <EducationRail educations={props.content.educations ?? []} />
      <AlsoRail company={props.company} />
      <CustomRail customs={props.content.custom ?? []} />
    </div>
  );
}

function flattenSkills(sets: ResumeContent['skills'] | undefined): readonly string[] {
  return (sets ?? []).flatMap((set) => set.items);
}

function SkillsRail({ items }: { items: readonly string[] }) {
  return (
    <>
      <div className={styles.label}>skills</div>
      <ul className={styles.skillList}>
        {items.map((s) => (
          <li key={s} className={styles.skillItem}>
            <span className={styles.skillBullet}>·</span>{s}
          </li>
        ))}
      </ul>
    </>
  );
}

function EducationRail({ educations }: { educations: readonly ResumeContent['educations'][number][] }) {
  return (
    <>
      <div className={styles.labelMt}>education</div>
      <div className={styles.eduList}>
        {educations.map((e) => (
          <div key={e.school + e.degree}>
            <div className={styles.eduSchool}>{e.school}</div>
            <div className={styles.eduDegree}>{e.degree}</div>
            <div className={styles.eduRange}>{formatPeriod(e.period)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function AlsoRail({ company }: { company: string }) {
  return (
    <>
      <div className={styles.labelMt}>also</div>
      <div className={styles.alsoText}>
        The QR is a live chat with my AI · grounded in my corpus · scoped for {company || 'this conversation'}.
      </div>
    </>
  );
}

function CustomRail({ customs }: { customs: NonNullable<ResumeContent['custom']> }) {
  const visible = customs.filter((c) => c.label && c.value);
  return visible.length === 0 ? null : (
    <div className={styles.customList}>
      {visible.map((c) => (
        <div key={c.label}>
          <div className={styles.label}>{c.label}</div>
          <div className={styles.customValue}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function MainColumn(props: { works: ResumeContent['works'] }) {
  return (
    <div className={styles.mainColumn}>
      <div className={styles.label}>experience</div>
      <div className={styles.workList}>
        {props.works.slice(0, 2).map((w) => (
          <WorkEntry key={w.company + w.title} work={w} />
        ))}
      </div>
    </div>
  );
}

function WorkEntry({ work }: { work: ResumeContent['works'][number] }) {
  return (
    <div>
      <div className={styles.workHeader}>
        <div>
          <span className={styles.workOrg}>{work.company}</span>
          <span className={styles.workRole}> · {work.title}</span>
        </div>
        <div className={styles.workMeta}>
          {formatPeriod(work.period)}
          <span className={styles.workMetaSep}>·</span>
          {work.location}
        </div>
      </div>
      <ul className={styles.bullets}>
        {work.bullets.filter(Boolean).map((b) => (
          <li key={b} className={styles.bullet}>
            <span className={styles.bulletDash}>—</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FrontFooter({ qrURL }: { qrURL: string }) {
  return (
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        <div className={styles.footerLine1}>scan or visit · {stripScheme(qrURL)}</div>
        <div className={styles.footerLine2}>this resume is a snapshot · sent {today()}</div>
      </div>
      <div className={styles.footerPageNum}>page 1 / 2</div>
    </div>
  );
}

function CoverBack(props: { content: ResumeContent; job: JobContext; qrURL: string }) {
  const { content, job, qrURL } = props;
  const firstName = content.identity.name.split(' ')[0] ?? content.identity.name;
  return (
    <>
      <div className={styles.coverHeader}>
        <div>
          <div className={styles.label}>letter</div>
          <h1 className={styles.coverTitle}>
            To {job.company}<span className={styles.accentDot}>.</span>
          </h1>
          <div className={styles.coverRe}>
            re · <span className={styles.metaInk}>{job.role}</span>
          </div>
        </div>
        <div className={styles.coverDateBlock}>
          <div className={styles.meta}>{longDate()}</div>
          {content.identity.locationLine ? (
            <div className={styles.metaMt}>{content.identity.locationLine}</div>
          ) : null}
        </div>
      </div>
      <hr className={styles.hairline} />
      <div className={styles.coverBody}>{content.coverLetter}</div>
      <div className={styles.coverSig}>
        <div className={styles.coverSigName}>— {firstName}</div>
        <div className={styles.coverSigMeta}>continue the conversation · {stripScheme(qrURL)}</div>
      </div>
      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          {content.identity.name.toLowerCase()} · {content.identity.email}
        </div>
        <div className={styles.footerPageNum}>page 2 / 2</div>
      </div>
    </>
  );
}

