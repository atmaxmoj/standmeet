// Agent —— the chat, dropped into any page: a microsite, the embed, the app itself. It is the same
// conversation, transcript and composer the app's own chat renders (useChatController +
// ChatTranscript + Composer); a page only picks where it sits (docs/design/sdk-chat-inheritance.md):
//   · inline —— in the page flow, where the author put it;
//   · rail   —— a column beside the page on a wide screen, the floating dock on a narrow one;
//   · dock   —— the floating pill that opens a panel.
//
// Who is asking decides what it can do, read after mount (the page is prerendered without browser
// storage, and a first render that read it would break hydration):
//   · a code's session in this browser → the code's agent: its persona, corpus, quota, dock buttons;
//   · no code, the owner's public tier usable → answers on the owner's tier;
//   · no code, the tier spent or the page offers it → the visitor brings their own key;
//   · none of these → the ask box hands the question to /gate.
// A coded visitor is never offered their own key: the code's owner pays for their turns.

'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  byoaiOffered, forgetBYOAI, keyStorageAvailable, pageAllowsBYOAI, pageDocContext,
  publicChatEnabled, publicChatSpent, readBYOAIVaultMeta, storeBYOAI, type BYOAICredFull,
} from '@standmeet/sdk-core';
import type { DocContext } from '@standmeet/agent-core';

import { useChatT, useT, WidgetLang } from '../i18n.js';
import { gateHref } from '../widgets/client.js';
import { ByokPanel } from '../widgets/ByokPanel.js';
import { ChatTranscript, ChatProgress, KEY_LOST_CODES } from './ChatTranscript.js';
import { Composer } from './Composer.js';
import { DockPanel } from './FloatingChatDock.js';
import { useChatController } from './chat-controller.js';
import { useDockButtonsStore } from './dock-buttons-store.js';
import { bindVisitorSessionSync } from './session-store.js';
import { loadStoredSession } from './stored-session.js';
import type { SessionMode } from './use-chat.js';

export type AgentLayout = 'inline' | 'rail' | 'dock';

export interface AgentProps {
  readonly layout?: AgentLayout;
  // The author's own copy, shown as given in every mode.
  readonly placeholder?: string;
  readonly examples?: readonly string[];
  // The page's language for the chat's own copy. Absent → the page's stored `sm-lang`, else English.
  readonly lang?: string;
  // publicTier —— a codeless visitor answers on the owner's public tier. On the instance's own pages
  // the server says so in the page meta; the embed on another site has no such meta, so its host
  // states it (<standmeet-chat mode="public">).
  readonly publicTier?: boolean;
}

// Who is asking (see the header). 'gate' until resolved after mount.
type Asker = 'gate' | 'coded' | 'coded-byoai' | 'public' | 'key-needed';

function resolveAsker(publicTier: boolean): Asker {
  const stored = loadStoredSession();
  if (stored !== null) return stored.byoai ? 'coded-byoai' : 'coded';
  if (publicTier || publicChatEnabled()) return 'public';
  const keyWelcome = publicChatSpent() || pageAllowsBYOAI();
  return keyWelcome && keyStorageAvailable() ? 'key-needed' : 'gate';
}

// PageThread —— the page this agent sits on: the conversation about it is its own thread (a
// microsite's slug, from the meta the server injects), kept in this browser per page.
interface PageThread { asker: Asker; docContext?: DocContext; persistKey: string }

function resolveThread(publicTier: boolean): PageThread {
  const dc = pageDocContext();
  const docContext = dc?.path !== undefined && dc.genre !== undefined
    ? { title: dc.title, path: dc.path, genre: dc.genre }
    : undefined;
  return { asker: resolveAsker(publicTier), docContext, persistKey: `agent:${window.location.pathname}` };
}

export function Agent(props: AgentProps) {
  // Resolved together after mount, so the conversation starts on its own thread from its first
  // render — never on the main one first.
  const [thread, setThread] = useState<PageThread | null>(null);
  const publicTier = props.publicTier === true;
  useEffect(() => {
    setThread(resolveThread(publicTier));
    return bindVisitorSessionSync();
  }, [publicTier]);
  return (
    <WidgetLang.Provider value={props.lang}>
      {thread === null || thread.asker === 'gate'
        ? <GateHandoff placeholder={props.placeholder} examples={props.examples} />
        : <Conversation thread={thread} {...props} />}
    </WidgetLang.Provider>
  );
}

// GateHandoff —— codeless and no tier to answer on: the ask box carries the question to /gate.
function GateHandoff({ placeholder, examples }: { placeholder?: string; examples?: readonly string[] }) {
  const t = useT();
  const [q, setQ] = useState('');
  const ask = (question: string) => { window.location.href = gateHref(question); };
  return (
    <section data-testid="agent-widget" data-mode="gate" className="smc-agent is-inline">
      <form className="smc-handoff" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t('askPlaceholder')}
          aria-label={t('askLabel')}
          data-testid="agent-widget-input"
          className="smc-handoff-input"
        />
        <button type="submit" data-testid="agent-widget-ask" className="smc-handoff-ask">{t('ask')}</button>
      </form>
      <Examples examples={examples} onAsk={ask} />
    </section>
  );
}

function Examples({ examples, onAsk }: { examples?: readonly string[]; onAsk: (q: string) => void }) {
  return examples === undefined || examples.length === 0 ? null : (
    <ul className="smc-examples">
      {examples.map((ex) => (
        <li key={ex}>
          <button type="button" onClick={() => onAsk(ex)} className="smc-starter">&ldquo;{ex}&rdquo;</button>
        </li>
      ))}
    </ul>
  );
}

// Conversation —— everyone who can ask. The tier the turns run on: the code's (coded), or for a
// codeless visitor the owner's public tier until they bring their own key.
function Conversation({ thread, layout = 'inline', placeholder, examples }: AgentProps & { thread: PageThread }) {
  const { asker, docContext, persistKey } = thread;
  const coded = asker === 'coded' || asker === 'coded-byoai';
  const [ownKey, setOwnKey] = useState(false);
  useEffect(() => {
    // A key saved in this browser is used up front only when the owner's tier can't serve.
    setOwnKey(!coded && asker === 'key-needed' && readBYOAIVaultMeta() !== null);
  }, [asker, coded]);
  const mode: SessionMode = asker === 'coded' ? 'code' : asker === 'coded-byoai' || ownKey ? 'byoai' : 'public';
  const ci = useChatController(mode, docContext, persistKey);
  const keys = useOwnKeyOffer({ ci, coded, ownKey, setOwnKey, keyNeeded: asker === 'key-needed' });
  const dockCount = useDockButtonsStore((s) => s.buttons.length);
  const surface = {
    'data-testid': 'agent-widget',
    'data-mode': keys.waitingForKey ? 'byok' : 'inline',
    'data-dock-count': dockCount,
  };
  const body = (
    <>
      <OwnKeyControls keys={keys} />
      {ci.chat.dialogs.length > 0 && <ClearButton onClear={ci.chat.reset} />}
      <ChatTranscript
        dialogs={ci.chat.dialogs} onAsk={ci.onAsk}
        conversationID={ci.chat.conversationID} noteEvent={ci.chat.noteEvent}
      />
      <ChatProgress dialogs={ci.chat.dialogs} />
    </>
  );
  const composer = keys.waitingForKey ? null : (
    <Composer
      variant={layout === 'inline' ? 'inline' : 'dock'}
      input={ci.input} setInput={ci.setInput} onSubmit={ci.onAsk}
      pending={ci.chat.pending} exhausted={ci.exhausted}
      ghost={ci.ghost} onAcceptGhost={ci.onAcceptGhost}
      handle="" placeholder={placeholder}
      showStarters={ci.chat.dialogs.length === 0} starters={examples ?? []}
    />
  );
  const wide = useWideScreen();
  if (layout === 'dock' || (layout === 'rail' && !wide)) {
    return (
      <section {...surface} className="smc-agent is-docked">
        <DockPanel ci={ci} handle="" starters={examples ?? []} placeholder={placeholder}
          head={<OwnKeyControls keys={keys} />} />
      </section>
    );
  }
  if (layout === 'rail') return <Rail surface={surface} body={body} composer={composer} />;
  return <section {...surface} className="smc-agent is-inline">{body}{composer}</section>;
}

// Rail —— fixed beside the page. Rendered into <body> so no transformed ancestor of the author's
// page can pin it inside itself; the page's own column makes room (sm-has-agent-rail).
function Rail({ surface, body, composer }: {
  surface: Record<string, string | number>; body: React.ReactNode; composer: React.ReactNode;
}) {
  useEffect(() => {
    document.body.classList.add('sm-has-agent-rail');
    return () => { document.body.classList.remove('sm-has-agent-rail'); };
  }, []);
  return createPortal(
    <aside {...surface} className="sm-agent-rail">
      <RailHead />
      <div className="sm-agent-rail-transcript">{body}</div>
      <div className="sm-agent-rail-composer">{composer}</div>
    </aside>,
    document.body,
  );
}

// RailHead —— says what the column is, the same words the dock's panel uses.
function RailHead() {
  const t = useChatT('dock');
  return <div className="sm-agent-rail-head"><span className="smc-dock-title">{t('askTheAI')}</span></div>;
}

// RAIL_MIN_WIDTH —— below this the rail would squeeze the page's column; the dock takes over. The
// same number as chat.css's rail media rule.
const RAIL_MIN_WIDTH = '(min-width: 1024px)';

function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(RAIL_MIN_WIDTH);
    setWide(mq.matches);
    const on = (e: MediaQueryListEvent) => { setWide(e.matches); };
    mq.addEventListener('change', on);
    return () => { mq.removeEventListener('change', on); };
  }, []);
  return wide;
}

type Controller = ReturnType<typeof useChatController>;

interface OwnKeyOffer {
  waitingForKey: boolean;
  showPanel: boolean;
  showOffer: boolean;
  saved: boolean;
  active: boolean;
  provider: string;
  offer: () => void;
  use: (cred: BYOAICredFull) => Promise<void>;
  forget: () => void;
}

// useOwnKeyOffer —— the visitor's-own-key path for a codeless visitor: offered when the owner's
// tier can't serve this turn (rate limited) or the page offers it; asked for again when the saved
// key can't be read. Never for a coded visitor.
function useOwnKeyOffer({ ci, coded, ownKey, setOwnKey, keyNeeded }: {
  ci: Controller; coded: boolean; ownKey: boolean; setOwnKey: (b: boolean) => void; keyNeeded: boolean;
}): OwnKeyOffer {
  const [asked, setAsked] = useState(false);
  const [offerable, setOfferable] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setOfferable(byoaiOffered());
    setSaved(readBYOAIVaultMeta() !== null);
  }, [ownKey]);
  const lastCode = ci.chat.dialogs.at(-1)?.answer.errorCode ?? '';
  const keyLost = KEY_LOST_CODES.has(lastCode);
  const available = !coded;
  const showPanel = available && !ownKey && (keyNeeded || asked || keyLost);
  return {
    waitingForKey: available && keyNeeded && !ownKey,
    showPanel,
    showOffer: available && !ownKey && !showPanel && (lastCode === 'rate_limited' || offerable),
    saved,
    active: available && ownKey,
    provider: ownKey ? (readBYOAIVaultMeta()?.provider ?? '') : '',
    offer: () => { if (saved) setOwnKey(true); else setAsked(true); },
    use: async (cred) => {
      await storeBYOAI(cred);
      setAsked(false);
      setOwnKey(true);
    },
    forget: () => {
      forgetBYOAI();
      setOwnKey(false);
    },
  };
}

function OwnKeyControls({ keys }: { keys: OwnKeyOffer }) {
  const t = useT();
  return (
    <>
      {keys.showOffer && (
        <button type="button" data-testid="agent-widget-byok-offer" onClick={keys.offer} className="smc-key-offer">
          {t(keys.saved ? 'useSavedKey' : 'useOwnKey')}
        </button>
      )}
      {keys.showPanel && <ByokPanel onUse={keys.use} />}
      {keys.active && (
        <p data-testid="agent-widget-byok-active" className="smc-key-active">
          <span>{t('onYourKey', { provider: keys.provider })}</span>
          <button type="button" data-testid="agent-widget-byok-forget" onClick={keys.forget} className="smc-key-forget">
            {t('forgetKey')}
          </button>
        </p>
      )}
    </>
  );
}

// ClearButton —— a new conversation. A glyph, not a word: the words are its aria-label and title.
function ClearButton({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <div className="smc-clear-row">
      <button
        type="button" data-testid="chat-clear" onClick={onClear}
        aria-label={t('newConversation')} title={t('newConversation')} className="smc-clear"
      >
        ↺
      </button>
    </div>
  );
}
