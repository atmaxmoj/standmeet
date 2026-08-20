// ConvTranscriptModal —— 弹层显示一个 conversation 完整 transcript。
// 每条 assistant message 下面挂 "cited · <genre> · <title>" 列表：**四种体裁都在**
// （output / wiki / subjectivity / writing），title 按 `message.cited[genre]` 里的 id
// 去 `transcript.refs[genre]` 索引里查。曾经这里只认 wiki 和 output，于是一轮引用了
// 6 条 subjectivity 的答复在 owner 的逐字稿上一行引用都没有（F-A-39）。

'use client';

import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import { DiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { ChatMarkdown } from '@/components/page/markdown';
import {
  deriveGhostView,
  pickTranscriptState,
  type CitedGenre,
  type ConvTranscript,
  type ConvTranscriptMessage,
  type GhostLog,
} from '@/lib/admin/use-conversations';
import { stampMinute } from '@/lib/ui/format-time';

type Props = {
  transcript: ConvTranscript;
  onClose: () => void;
};

export function ConvTranscriptModal({ transcript, onClose }: Props) {
  return (
    <ModalShell
      onClose={onClose}
      kicker="conversation"
      title={`transcript · ${transcript.conversationID.slice(0, 8)}`}
      maxWidth={720}
    >
      <div className="px-7 py-6" data-testid="transcript-body">
        <TranscriptBody transcript={transcript} />
        <GroundingBlock titles={transcript.grounding} />
        <GhostsBlock ghosts={transcript.ghosts} />
      </div>
    </ModalShell>
  );
}

function TranscriptBody({ transcript }: { transcript: ConvTranscript }) {
  const map = {
    loading: <Loading />,
    error: <ErrorBlock message={transcript.error ?? ''} />,
    empty: <EmptyState />,
    list: <MessageList messages={transcript.messages} refs={transcript.refs} />,
  } as const;
  return map[pickTranscriptState(transcript)];
}

function Loading() {
  const t = useTranslations('adminAccess');
  return <p className="reading-tight italic text-(--color-muted)">{t('transcript.loading')}</p>;
}

function ErrorBlock({ message }: { message: string }) {
  return <p className="mono text-[11px] text-(--color-accent)">{message}</p>;
}

function EmptyState() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight italic text-(--color-muted)">
      {t('transcript.empty')}
    </p>
  );
}

function MessageList({
  messages, refs,
}: {
  messages: readonly ConvTranscriptMessage[];
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  return (
    <ul className="space-y-6">
      {messages.map((m) => <MessageItem key={m.id} message={m} refs={refs} />)}
    </ul>
  );
}

function MessageItem({
  message, refs,
}: {
  message: ConvTranscriptMessage;
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  return message.role === 'event' ? (
    <li><EventLine body={message.body} at={message.created_at} /></li>
  ) : (
    <li>
      <MessageLabel role={message.role} at={message.created_at} />
      <MessageBody role={message.role} body={message.body} />
      <CitedTail cited={message.cited} refs={refs} />
    </li>
  );
}

// EVENT_PREFIX —— 事件正文自带的前缀（模型靠它认出这是一件发生过的事，不是谁说的话）。
// owner 这一面已经有标签在说同一件事，正文里不必再印一遍。
const EVENT_PREFIX = '[card action] ';

// EVENT_LABEL —— 跟旁边的 `visitor` / `ai` 一样是**等宽小标签**，不是句子：这一族标签
// 在设计语言里是终端式的元数据，三个一起看才读得出「谁/什么」，所以它们同属一类、
// 同样不翻译。
const EVENT_LABEL = 'card action';

// EventLine —— 这段对话里**发生过的一件事**：访客在沙盒卡上点了取消 / 发了确认信（F-B-9）。
// 它没有说话人，所以不摆成一轮问答 —— 一条竖线 + 等宽小字，跟旁边的 visitor / ai 明确不同。
// 上一版把它当 assistant 渲染，于是逐字稿写着「AI」说了这句 —— 一句 AI 从没说过的话。
function EventLine({ body, at }: { body: string; at: string }) {
  return (
    <div data-testid="conv-event-line" className="border-l-2 border-(--color-faint) pl-3 py-1">
      <div className="mono text-[10px] tracking-[0.18em] uppercase flex items-baseline gap-3">
        <span className="text-(--color-muted)">{EVENT_LABEL}</span>
        <span className="text-(--color-faint) normal-case tracking-[0.06em]">
          · {stampMinute(at)}
        </span>
      </div>
      <p className="mono text-[11px] leading-[1.6] text-(--color-muted) mt-1 break-words">
        {body.startsWith(EVENT_PREFIX) ? body.slice(EVENT_PREFIX.length) : body}
      </p>
    </div>
  );
}

// MessageBody —— 访客的问句是一句话,原样排版;AI 的回答是 markdown,**走访客那边同一个
// 渲染器**。上一版两边都塞进 <p>{body}</p>,于是 owner 读到的是 `## 标题` `**加粗**` 的源码,
// 而同一段正文在访客聊天和 report 页都渲染得好好的(F-C-8)。这里复用 ChatMarkdown 而不是
// 再写一个,正是因为"一份正文四个渲染器"就是那个 bug 本身。
function MessageBody({ role, body }: { role: 'visitor' | 'assistant'; body: string }) {
  return role === 'visitor' ? (
    <p className="reading sm-measure text-(--color-ink) mt-2 font-[380] text-[20px] italic">{body}</p>
  ) : (
    <div className="reading sm-measure text-(--color-ink) mt-2 font-[380] text-[16.5px] not-italic">
      {/* 这是 owner 回看逐字稿的地方 —— 图编译不过的报错要**在这里**显出来。
          访客那一侧同一个渲染器把它藏掉了（正文自己站得住），但问题不能就此消失：
          owner 是唯一能去改 prompt / 改 skill 的人。 */}
      <DiagramDiagnostics><ChatMarkdown source={body} /></DiagramDiagnostics>
    </div>
  );
}

function MessageLabel({ role, at }: { role: 'visitor' | 'assistant'; at: string }) {
  const text = role === 'visitor' ? 'visitor' : 'ai';
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase flex items-baseline gap-3">
      <span className={role === 'visitor' ? 'text-(--color-ink)' : 'text-(--color-accent)'}>
        {text}
      </span>
      <span className="text-(--color-faint) normal-case tracking-[0.06em]">
        · {stampMinute(at)}
      </span>
    </div>
  );
}

// CITED_ORDER —— 显示顺序：output 排前面（"polished, quote verbatim"，跟 visitor chat
// 优先级一致），然后 wiki，然后 owner 自己的两类。**四种全在**：以前这里只有 wiki 和
// output，于是一轮引用了 6 条 subjectivity 的答复在逐字稿上一行引用都没有（F-A-39）。
const CITED_ORDER: readonly CitedGenre[] = ['output', 'wiki', 'subjectivity', 'writing'];

// CitedTail —— 一条答复引用了哪些条目，四种体裁走**同一条**渲染路（多抄一份就是下一个
// 会漏掉的体裁）。某个 id 在 refs 索引里找不到 title（数据脏 / 已删除）就跳过那条 ——
// 显示 "<missing>" 比让 UI 整块崩好，但实际上很难触发。
function CitedTail({
  cited, refs,
}: {
  cited: Record<CitedGenre, readonly string[]>;
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  const t = useTranslations('adminAccess');
  const items = CITED_ORDER.flatMap((kind) =>
    cited[kind].map((id) => ({ kind, id, title: refs[kind][id] })),
  ).filter((c) => c.title);
  return items.length === 0 ? null : (
    <ul
      className="mt-2 space-y-0.5 mono text-[10px] tracking-[0.12em] uppercase"
      data-testid="transcript-cited"
    >
      {items.map((c) => (
        <li key={`${c.kind}:${c.id}`} className="flex items-baseline gap-2">
          <span className={c.kind === 'output' ? 'text-(--color-accent)' : 'text-(--color-faint)'}>
            {t('transcript.cited', { kind: c.kind })}
          </span>
          <span className="reading-tight italic text-(--color-muted) normal-case tracking-[0.04em]">
            {c.title}
          </span>
        </li>
      ))}
    </ul>
  );
}


// GroundingBlock —— 塑造了这段对话、但没进访客脚注的 subjectivity 笔记(F-A-27)。
//
// 为什么要有这一块:subjectivity 的设计就是「塑造声音、不当引用」,那是故意的 —— 可另一头
// 又假设「读了哪些」由引用脚注承载。两条合起来,owner 写了一堆 standpoint 笔记来定语气,却
// 在任何界面上都看不到它们参与过。这一块就是那个缺掉的观察点。
//
// 只渲**标题**:owner 要判的是哪几条在起作用,私有正文不必复制到这儿来(后端也没给)。
// 跟 CITED 分开一块,而不是混进同一张清单 —— 它们不是引用,混在一起会让人以为访客也看得到。
function GroundingBlock({ titles }: { titles: readonly string[] }) {
  const t = useTranslations('adminAccess');
  return titles.length === 0 ? null : (
    <section
      className="mt-8 pt-6 border-t border-(--color-rule)"
      data-testid="transcript-grounding"
    >
      <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('transcript.groundingTitle')}
      </h3>
      <ul className="space-y-0.5 mono text-[10px] tracking-[0.12em] uppercase">
        {titles.map((title) => (
          <li key={title} className="flex items-baseline gap-2">
            <span className="text-(--color-faint)">{t('transcript.grounded')}</span>
            <span className="reading-tight italic text-(--color-muted) normal-case tracking-[0.04em]">
              {title}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// GhostsBlock —— H.13.e: owner 后台观测 ghost text 日志。code 对话
// 才会有；其他 mode 空数组 → block 整段不渲。每行：text · source ·
// shown_at · accepted? (accepted 时显勾 + 时间，否则灰 dash)。
function GhostsBlock({ ghosts }: { ghosts: readonly GhostLog[] }) {
  const t = useTranslations('adminAccess');
  return ghosts.length === 0 ? null : (
    <section className="mt-8 pt-6 border-t border-(--color-rule)" data-testid="transcript-ghosts">
      <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('transcript.ghostsTitle')}
      </h3>
      <ul className="space-y-2">
        {ghosts.map((s) => (
          <GhostRow key={s.id} log={s} />
        ))}
      </ul>
    </section>
  );
}

function GhostRow({ log }: { log: GhostLog }) {
  const v = deriveGhostView(log);
  return (
    <li
      className="flex items-baseline gap-3 text-[13px]"
      data-testid="transcript-ghost-row"
      data-source={log.source}
      data-accepted={v.acceptedAttr}
    >
      <span className={`mono text-[9.5px] tracking-[0.12em] uppercase shrink-0 ${v.sourceCls}`}>
        {log.source}
      </span>
      <span className="reading-tight italic text-(--color-ink) flex-1">
        &ldquo;{log.ghost_text}&rdquo;
      </span>
      <span className="mono text-[10px] text-(--color-faint) shrink-0">
        {v.acceptedMark}
      </span>
    </li>
  );
}
