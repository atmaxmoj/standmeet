// PageSection —— the design-mockup version of /admin/page.
// Wraps each section with Block: domain / byoai / hero / insights / projects / where / contact.
// hero_prose is the e2e path — keep the testid. Other fields also change via usePageEditor.patch and participate in dirty tracking.

'use client';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { FormSkeleton } from '@/components/skeletons/FormSkeleton';
import { Block } from '@/components/admin/sections/page/Block';
import { EditField } from '@/components/admin/sections/page/EditField';
import { StringListEditor } from '@/components/admin/sections/page/StringListEditor';
import { PinManager } from '@/components/admin/sections/page/PinManager';
import { SaveBar } from '@/components/admin/sections/page/SaveBar';
import { BYOAIEditor } from '@/components/admin/sections/page/BYOAIEditor';
import { DomainEditor } from '@/components/admin/sections/page/DomainEditor';
import { HandleEditor } from '@/components/admin/sections/page/HandleEditor';
import { PublicURLEditor } from '@/components/admin/sections/page/PublicURLEditor';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { pickHandle } from '@/lib/admin/use-handle';
import { usePageEditor, type MutablePage, type PageEditorHook, type PageEditorState } from '@/lib/admin/use-page-editor';
import { usePinnable } from '@/lib/admin/use-pinnable';
import type { PinnableEntry } from '@/lib/api/admin';

export function PageSection() {
  const editor = usePageEditor();
  return (
    <>
      <SectionHeader kicker="settings · public face" slug="page" />
      <PageBody editor={editor} />
    </>
  );
}

function PageBody({ editor }: { editor: PageEditorHook }) {
  return editor.state.kind === 'loading' ? <Loading />
    : editor.state.kind === 'error' ? <ErrorMsg message={editor.state.message} />
    : <Ready editor={editor} state={editor.state} />;
}

function Loading() { return <FormSkeleton rows={6} />; }
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
  const t = useTranslations('adminPages.page');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('intro')}
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
  const pinnable = usePinnable();
  return (
    <>
      <SiteBlock />
      <BYOAIBlock />
      <HeroBlock editor={editor} content={content} />
      <InsightsBlock editor={editor} content={content} pinnable={pinnable} />
      <ProjectsBlock editor={editor} content={content} pinnable={pinnable} />
      <WhereBlock editor={editor} content={content} />
      <ContactBlock editor={editor} content={content} />
    </>
  );
}

function SiteBlock() {
  const view = useSiteBlockView();
  return (
    <Block title="site" blurb="Where this instance lives on the web. The public URL is what QR codes + canonical tags use; the allow-list lets Caddy issue a cert for it.">
      <PublicURLEditor current={view.publicURL} onChanged={view.setPublicURL} />
      <HandleEditor current={view.handle} onChanged={view.setHandle} />
      <DomainEditor handle={view.handle} />
    </Block>
  );
}

interface SiteBlockView {
  handle: string;
  publicURL: string;
  setHandle: (h: string) => void;
  setPublicURL: (u: string) => void;
}

function useSiteBlockView(): SiteBlockView {
  const session = useAdminSession();
  const [handleOverride, setHandleOverride] = useState<string | null>(null);
  const [publicURLOverride, setPublicURLOverride] = useState<string | null>(null);
  const seed = readyOwnerSeed(session);
  return {
    handle: pickHandle(handleOverride, seed.handle),
    publicURL: publicURLOverride ?? seed.publicURL,
    setHandle: setHandleOverride,
    setPublicURL: setPublicURLOverride,
  };
}

function readyOwnerSeed(
  s: ReturnType<typeof useAdminSession>,
): { handle: string; publicURL: string } {
  return s.kind === 'ready'
    ? { handle: s.session.handle, publicURL: s.session.public_url }
    : { handle: '', publicURL: '' };
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

function InsightsBlock({
  editor, content, pinnable,
}: { editor: PageEditorHook; content: ContentShape; pinnable: readonly PinnableEntry[] }) {
  return (
    <Block title="things I've been thinking about" blurb="Pin published corpus entries here — the page shows each entry's title + excerpt and links into the reader. Content lives once, in the corpus. Empty = the section is hidden.">
      <PinManager
        section="insights"
        pins={content.insights}
        pinnable={pinnable}
        onChange={(insights) => editor.patch({ insights })}
      />
    </Block>
  );
}

function ProjectsBlock({
  editor, content, pinnable,
}: { editor: PageEditorHook; content: ContentShape; pinnable: readonly PinnableEntry[] }) {
  return (
    <Block title="what I'm building" blurb="Pin the corpus entries that describe what you're building. Same window-onto-the-corpus model as insights — pin published entries, reorder, and the page links into each reader.">
      <PinManager
        section="projects"
        pins={content.projects}
        pinnable={pinnable}
        onChange={(projects) => editor.patch({ projects })}
      />
    </Block>
  );
}

function WhereBlock({ editor, content }: { editor: PageEditorHook; content: ContentShape }) {
  return (
    <Block title="where I am" blurb="Location, employment posture, and the filter for what you're open to.">
      <EditField label="location line" value={content.where.location_line}
        testid="where-location"
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
        testid="contact-email"
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
