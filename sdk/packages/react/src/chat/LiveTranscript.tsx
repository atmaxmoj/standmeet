// LiveTranscript —— the owner watches one conversation as it happens, opened from the link on a
// notification card (use-live-transcript.ts). Read-only: the same transcript views the visitor
// sees, without a composer. A link that is not valid shows that, and nothing of the conversation.

'use client';

import { useChatT } from '../i18n.js';
import { ChatProgress, ChatTranscript } from './ChatTranscript.js';
import { useLiveTranscript } from './use-live-transcript.js';

const noAsk = (): void => undefined;

export function LiveTranscript({ token }: { token: string }) {
  const t = useChatT('live');
  const { state, dialogs } = useLiveTranscript(token);
  if (state === 'invalid') {
    return <p className="smc-live-invalid" data-testid="live-invalid">{t('invalid')}</p>;
  }
  return (
    <section className="smc-live" data-testid="live-transcript">
      <header className="smc-live-heading">{t('heading')}</header>
      <ChatTranscript dialogs={dialogs} onAsk={noAsk} />
      <ChatProgress dialogs={dialogs} />
      {state === 'open' && dialogs.at(-1)?.pending !== true
        ? <p className="smc-live-waiting">{t('waiting')}</p>
        : null}
    </section>
  );
}
