// notify.test.ts —— the bridge's outbound half: `/pair CODE` links the owner's chat (and is never
// treated as a visitor's question), and a card from the instance carries its link as a button.

import { describe, expect, it } from 'vitest';

import { directMessageHandler, type ThreadLike } from '../src/index.js';
import type { Deps } from '../src/conversation.js';
import { NOT_PAIRED, PAIRED, cardFor, chatOf, pairingCode } from '../src/notify.js';

function thread(id: string): ThreadLike & { posted: string[] } {
  const posted: string[] = [];
  return { id, posted, post: (m: { markdown: string }) => { posted.push(m.markdown); return Promise.resolve(); } };
}

const owner = (text: string) => ({
  text, author: { userId: '42', userName: 'o', fullName: 'Owner', isBot: false, isMe: false },
});

const noVisitor = {} as unknown as Deps; // a pairing message must never reach the visitor core

describe('pairing', () => {
  it('reads the code only from a /pair message', () => {
    expect(pairingCode('/pair ab12cd34')).toBe('AB12CD34');
    expect(pairingCode('pair AB12CD34')).toBeNull();
    expect(pairingCode('hello')).toBeNull();
    expect(chatOf('telegram:42')).toEqual({ platform: 'telegram', chatID: '42' });
    // A Discord DM thread is discord:@me:<channel>; the chat is everything after the platform, or
    // the card is posted to "discord:@me" and never arrives.
    expect(chatOf('discord:@me:1234567890')).toEqual({ platform: 'discord', chatID: '@me:1234567890' });
  });

  it('asks the instance with the chat it came from, and says how it went', async () => {
    const asked: string[] = [];
    const t = thread('telegram:42');
    await directMessageHandler(noVisitor, (id, code) => { asked.push(`${id} ${code}`); return Promise.resolve(true); })(
      t, owner('/pair AB12CD34'));
    expect(asked).toEqual(['telegram:42 AB12CD34']);
    expect(t.posted).toEqual([PAIRED]);

    const t2 = thread('telegram:42');
    await directMessageHandler(noVisitor, () => Promise.resolve(false))(t2, owner('/pair ZZZZ9999'));
    expect(t2.posted).toEqual([NOT_PAIRED]);
  });
});

describe('cards', () => {
  it('puts the link on a button, and sends just the text without one', () => {
    const withLink = cardFor({ platform: 'telegram', chat_id: '42', text: 'R1', link: 'https://x.test/live/t', link_label: 'Open' });
    expect(JSON.stringify(withLink)).toContain('https://x.test/live/t');
    expect(JSON.stringify(withLink)).toContain('link-button');
    expect(JSON.stringify(cardFor({ platform: 'telegram', chat_id: '42', text: 'R2' }))).not.toContain('link-button');
  });
});
