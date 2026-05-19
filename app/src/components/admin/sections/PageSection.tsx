// PageSection —— /admin/page 的设计稿版本。
// 用 Block 包装每个区段：domain / byoai / hero / insights / projects / where / contact。
// hero_prose 是 e2e 路径 —— 保留 testid。其他字段也通过 usePageEditor.patch 改并参与 dirty。

'use client';

import { useCallback } from 'react';

import { SectionHeader } from '../SectionHeader';
import { Block } from './page/Block';
import { EditField } from './page/EditField';
import { StringListEditor } from './page/StringListEditor';
import { ListEditor } from './page/ListEditor';
import { SaveBar } from './page/SaveBar';
import { BYOAIEditor } from './page/BYOAIEditor';
import { DomainEditor } from './page/DomainEditor';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { usePageEditor, type MutablePage, type PageEditorHook, type PageEditorState } from '@/lib/admin/use-page-editor';
import { insightRender, projectRender } from '@/lib/admin/page-renderers';

export function PageSection() {
  const editor = usePageEditor();
  return (
    <>
      <SectionHeader kicker="surface · public content" title="page" />
      <PageBody editor={editor} />
    </>
  );
}

function PageBody({ editor }: { editor: PageEditorHook }) {
  return editor.state.kind === 'loading' ? <Loading />
    : editor.state.kind === 'error' ? <ErrorMsg message={editor.state.message} />
    : <Ready editor={editor} state={editor.state} />;
}

function Loading() { return <p className="mono text-(--color-muted)">loading…</p>; }
function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function Ready({
  editor, state,
}: {
  editor: PageEditorHook;
  state: Exclude<PageEditorState, { kind: 'loading' | 'error' }>;
}) {
  const onSave = useCallback(() => void editor.save(), [editor]);
  const view = readyView(state);
  return (
    <div>
      <Intro />
      <PageBlocks editor={editor} content={view.content} />
      <SaveBar
        dirty={view.dirty}
        savedAt={view.savedAt}
        saving={view.saving}
        onSave={onSave}
        onRevert={editor.revert}
      />
    </div>
  );
}

interface ReadyView {
  content: ContentShape | undefined;
  dirty: boolean;
  savedAt: number | null;
  saving: boolean;
}

function readyView(state: Exclude<PageEditorState, { kind: 'loading' | 'error' }>): ReadyView {
  return state.kind === 'loaded'
    ? { content: state.content, dirty: state.dirty, savedAt: state.savedAt, saving: false }
    : { content: undefined, dirty: false, savedAt: null, saving: true };
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Author the blocks visitors land on. Hero is the prose paragraph + chat input. Below: insights
      (bold theses), projects, where you are, and how to reach you. Changes persist via PUT /admin/page.
    </p>
  );
}

function PageBlocks({
  editor, content,
}: { editor: PageEditorHook; content: ContentShape | undefined }) {
  return content ? <Blocks editor={editor} content={content} /> : null;
}

type ContentShape = MutablePage;

function Blocks({
  editor, content,
}: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <>
      <SiteBlock />
      <BYOAIBlock />
      <HeroBlock editor={editor} content={content} />
      <InsightsBlock editor={editor} content={content} />
      <ProjectsBlock editor={editor} content={content} />
      <WhereBlock editor={editor} content={content} />
      <ContactBlock editor={editor} content={content} />
    </>
  );
}

function SiteBlock() {
  const session = useAdminSession();
  const handle = session.kind === 'ready' ? session.session.handle : 'me';
  return (
    <Block title="site" blurb="Where this lives on the web. Use a custom domain or the default standmeet.com path.">
      <DomainEditor handle={handle} />
    </Block>
  );
}

function BYOAIBlock() {
  return (
    <Block title="byoai mode" blurb="Visitors without a code can chat using their own API key against your public corpus.">
      <BYOAIEditor />
    </Block>
  );
}

function HeroBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="hero" blurb="What lands first: a serif prose paragraph that reveals your worldview, then the chat input.">
      <EditField
        label="prose · 1–3 sentences · reveal your worldview"
        monoHint="avoid: job title, skill list, 'passionate about'"
        value={content.hero_prose}
        onChange={editor.setHeroProse}
        multiline={5}
        testid="hero-prose"
      />
      <StringListEditor
        label="example prompts · shown below the chat input"
        renderHint="aim for 3–4"
        items={content.hero_examples}
        onChange={(hero_examples) => editor.patch({ hero_examples })}
        placeholder="What do you think about AI replacing engineers?"
      />
    </Block>
  );
}

function InsightsBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="things I've been thinking about" blurb="One-line thesis + context + an expandable body. Visitors browse by idea, not by date.">
      <ListEditor
        label="insights"
        items={content.insights}
        onChange={(insights) => editor.patch({ insights })}
        render={insightRender}
      />
    </Block>
  );
}

function ProjectsBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="what I'm building" blurb="Honest projects, typography only. Name + tagline + status lines + optional url.">
      <ListEditor
        label="projects"
        items={content.projects}
        onChange={(projects) => editor.patch({ projects })}
        render={projectRender}
      />
    </Block>
  );
}

function WhereBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="where I am" blurb="Location, employment posture, and the filter for what you're open to.">
      <EditField label="location line" value={content.where.location_line}
        onChange={(v) => editor.patch({ where: { ...content.where, location_line: v } })} />
      <EditField label="status prose" multiline={3} value={content.where.status_prose}
        onChange={(v) => editor.patch({ where: { ...content.where, status_prose: v } })} />
      <StringListEditor label="looking for · be specific"
        items={content.where.looking_for}
        onChange={(looking_for) => editor.patch({ where: { ...content.where, looking_for } })}
      />
      <EditField label="closing · the 'not desperate' line" value={content.where.closing}
        onChange={(v) => editor.patch({ where: { ...content.where, closing: v } })} />
    </Block>
  );
}

function ContactBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="how to talk to me" blurb="The screening rules, said honestly.">
      <EditField label="email" value={content.contact.email}
        onChange={(v) => editor.patch({ contact: { ...content.contact, email: v } })} />
      <EditField label="chat line" multiline={2} value={content.contact.chat_line}
        onChange={(v) => editor.patch({ contact: { ...content.contact, chat_line: v } })} />
      <EditField label="recruiter rules" multiline={3} value={content.contact.recruiter_prose}
        onChange={(v) => editor.patch({ contact: { ...content.contact, recruiter_prose: v } })} />
      <EditField label="casual conversation rules" multiline={3} value={content.contact.casual_prose}
        onChange={(v) => editor.patch({ contact: { ...content.contact, casual_prose: v } })} />
    </Block>
  );
}
