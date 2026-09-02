// VisitorNamePicker —— pops up a modal asking for a name the first time a
// code-mode visitor enters a chat-capable surface. The owner needs to know
// who's who when reading transcripts in /admin/conversations.
//
// The trigger condition / persistence logic all lives in
// lib/visitor/visitor-name.ts; this component is pure rendering.
//
// Design source: docs/design/project/app.js VisitorNamePicker. The
// expected[] prop is a placeholder — the store doesn't currently store the
// code's member list, so candidates aren't rendered yet; enable once the
// server returns them.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import {
  dismissPicker,
  submitPickerName,
  useIssuePendingCode,
  type IssueOutcome,
} from '@/lib/gate/use-issue-pending-code';
import { memberCapacityLine, useCodeIntro } from '@/lib/gate/use-code-intro';
import {
  loadVisitorName,
  loadVisitorEmail,
  useShouldAskVisitorName,
} from '@/lib/visitor/visitor-name';

export function VisitorNamePicker() {
  const should = useShouldAskVisitorName();
  return should ? <Modal /> : null;
}

function Modal() {
  // Initial values load the last-used name + optional email from
  // localStorage (the same person opening it again gets them back
  // automatically).
  const [name, setName] = useState(loadVisitorName);
  const [email, setEmail] = useState(loadVisitorEmail);
  const [full, setFull] = useState(false);
  const code = usePendingCodeStore((s) => s.code);
  const intro = useCodeIntro();
  const { issue, busy } = useIssuePendingCode();
  const onSubmit = () => { void settleOutcome(submitPickerName(name, email, issue), setFull); };
  const onDismiss = () => { void settleOutcome(dismissPicker(issue), setFull); };
  return (
    // Clicking outside the modal (the backdrop, not the card) = dismiss:
    // for a switch-person modal, cancel keeps the original session; for the
    // first-time modal, it's skip.
    <div
      className="sm-fadein sm-visitor-name-overlay"
      data-testid="visitor-name-overlay"
      onClick={(e) => { (e.target === e.currentTarget) && onDismiss(); }}
    >
      <div className="sm-visitor-name-card sm-rise">
        <PickerHeader code={code} greeting={intro?.greeting ?? ''} />
        <PickerBody
          name={name} onName={setName} email={email} onEmail={setEmail}
          going={busy} full={full}
          capacityLine={memberCapacityLine(intro)}
          onSubmit={onSubmit}
          onDismiss={onDismiss}
        />
      </div>
    </div>
  );
}

// settleOutcome —— the wrap-up for submit/dismiss: 'full' → show the
// full-capacity state. 'ok' already consumed the pending code → the picker
// hides itself automatically; 'error' → busy resets so it can be retried.
async function settleOutcome(
  p: Promise<IssueOutcome>, setFull: (v: boolean) => void,
): Promise<void> {
  const outcome = await p;
  (outcome === 'full') && setFull(true);
}

// PickerHeader —— access kicker → the owner-set "what this is" greeting →
// "Who's reading?".
function PickerHeader({ code, greeting }: { code: string | null; greeting: string }) {
  const t = useTranslations('visitor.visitorNamePicker');
  return (
    <div className="sm-visitor-name-head">
      <div className="sm-smallcaps">
        {code ? `access granted · code ${code}` : 'before we begin'}
      </div>
      {greeting !== '' && (
        <p className="sm-visitor-name-greeting" data-testid="visitor-name-greeting">
          {greeting}
        </p>
      )}
      <div className="sm-visitor-name-h1">{t('whosReading')}</div>
    </div>
  );
}

interface BodyProps {
  name: string;
  onName: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  going: boolean;
  full: boolean;
  capacityLine: string;
  onSubmit: () => void;
  onDismiss: () => void;
}

function PickerBody(props: BodyProps) {
  return (
    <div className="sm-visitor-name-body">
      {props.full ? <PickerFull /> : <PickerPrompt {...props} />}
    </div>
  );
}

// PickerFull —— this code's member cap is reached: they can't get in, so
// explain that clearly + point the visitor to whoever shared the code.
function PickerFull() {
  const t = useTranslations('visitor.visitorNamePicker');
  return (
    <p className="sm-reading sm-visitor-name-blurb" data-testid="visitor-name-full">
      {t('full')}
    </p>
  );
}

function PickerPrompt(props: BodyProps) {
  const t = useTranslations('visitor.visitorNamePicker');
  return (
    <>
      <p className="sm-reading sm-visitor-name-blurb">
        {t('prompt')}
      </p>
      <p
        className="sm-reading sm-visitor-name-blurb sm-visitor-name-note"
        data-testid="visitor-name-capacity"
      >
        {props.capacityLine !== ''
          ? props.capacityLine
          : t('capacityDefault')}{' '}
        {t.rich('capacityNote', { strong: (c) => <strong>{c}</strong> })}
      </p>
      <PickerForm {...props} />
      {props.going && <PickerGoing />}
    </>
  );
}

function PickerForm(props: BodyProps) {
  const t = useTranslations('visitor.visitorNamePicker');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
      className="sm-visitor-name-form"
    >
      <span className="sm-visitor-name-prompt">›</span>
      <input
        type="text"
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
        placeholder="your name"
        autoFocus
        className="sm-visitor-name-input"
        data-testid="visitor-name-input"
      />
      <input
        type="email"
        value={props.email}
        onChange={(e) => props.onEmail(e.target.value)}
        placeholder="email (optional, for meeting invites)"
        className="sm-visitor-name-input"
        data-testid="visitor-email-input"
      />
      <button
        type="submit"
        disabled={props.going || !props.name.trim()}
        className="sm-btn sm-btn-ghost"
        data-testid="visitor-name-submit"
      >
        {t('start')}
      </button>
      <button
        type="button"
        onClick={props.onDismiss}
        className="sm-btn sm-btn-danger"
        data-testid="visitor-name-skip"
      >
        {t('skip')}
      </button>
    </form>
  );
}

function PickerGoing() {
  const t = useTranslations('visitor.visitorNamePicker');
  return (
    <div className="sm-visitor-name-going sm-smallcaps">
      {t('starting')}
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
    </div>
  );
}
