import { describe, expect, it } from 'vitest';

import { channelOptions, ruleBody, ruleSummary, type NotifyType, type Rule } from './use-notify';

const types: NotifyType[] = [
  { type: 'conversation.started', description: '', filterable: ['code_id'] },
  { type: 'booking.created', description: '', filterable: [] },
];

describe('ruleBody', () => {
  it('sends the code filter only for a type that declares it', () => {
    const draft = { eventType: 'conversation.started', filterValue: 'c1', firstOnly: true, channel: 'im:l1', template: ' R1 ' };
    expect(ruleBody(draft, types)).toEqual({
      event_type: 'conversation.started', filter_key: 'code_id', filter_value: 'c1', first_only: true,
      channel: 'im', channel_ref: 'l1', template: 'R1',
    });
    expect(ruleBody({ ...draft, eventType: 'booking.created' }, types))
      .toMatchObject({ filter_key: '', filter_value: '' });
  });
});

describe('channelOptions', () => {
  it('lists email, linked chats only, and endpoints', () => {
    const links = [
      { id: 'a', platform: 'telegram', pairing_code: 'X', linked: true },
      { id: 'b', platform: 'telegram', pairing_code: 'Y', linked: false },
    ];
    expect(channelOptions(links, [{ id: 'w', url: 'https://x.test/h' }], 'Email')).toEqual([
      { value: 'email', label: 'Email' },
      { value: 'im:a', label: 'Telegram' },
      { value: 'webhook:w', label: 'https://x.test/h' },
    ]);
  });
});

describe('ruleSummary', () => {
  it('names the code by its string and the chat by its platform', () => {
    const r: Rule = {
      id: 'r', event_type: 'conversation.started', filter_key: 'code_id', filter_value: 'c1',
      first_only: true, channel: 'im', channel_ref: 'a', template: '', enabled: true,
    };
    expect(ruleSummary(r, [{ id: 'c1', code: 'RECRUIT-1' }], [{ id: 'a', platform: 'telegram', pairing_code: '', linked: true }], []))
      .toEqual({ watches: 'conversation.started', keeps: 'RECRUIT-1', to: 'Telegram' });
  });
});
