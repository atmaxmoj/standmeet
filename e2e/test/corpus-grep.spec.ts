// corpus-grep.spec.ts —— the second search path: exact text, exhaustively.
//
// `corpus_search` is Meili: ranked, typo-tolerant, and blind to anything its tokenizer does not cut
// out as a term. `corpus_grep` answers a different question — WHERE does this exact text occur —
// and answers it completely. The first test is the contrast, and it is the reason the tool exists.
//
// If test 1 ever goes red because Meili got better at one of these strings, that is information,
// not a broken test: pick another string the tokenizer still cannot reach and write down which one
// stopped working. What must never happen is deleting the contrast because it became inconvenient —
// the day both tools answer the same, one of them is dead weight.

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import {
  grep, grepError, grepHits, grepTitles, searchTitles, setupRetrievalOwner,
  type RetrievalOwner,
} from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  O = await setupRetrievalOwner(playwright, 'grepowner');
  await seedWiki(O.request, O.apiToken, O.sid, {
    title: 'Subsystem', path: 'projects/subsystem',
    // "ubsyste" is inside a word; "SM-4471/b" is punctuation-glued. Neither survives
    // tokenization as a term, so keyword search cannot reach them.
    body: 'The retrieval subsystem is described here.\nTicket SM-4471/b tracks it.',
  });
  await seedWiki(O.request, O.apiToken, O.sid, {
    title: 'Elsewhere', path: 'projects/elsewhere',
    body: 'Another note that also says subsystem, twice: subsystem.',
  });
  await seedWiki(O.request, O.apiToken, O.sid, {
    title: 'Hidden', path: 'family/hidden',
    // Same words, out of the narrow code's scope. A new tool is a new door.
    body: 'This private note also mentions the subsystem and SM-4471/b.',
  });
});

test.afterAll(async () => { await O.request.dispose(); });

async function fullSession() {
  return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'F' });
}

async function narrowSession() {
  return issueSession(O.request, { handle: O.handle, code: O.narrowCode, visitor_name: 'N' });
}

test.describe('corpus_grep · exact text, every occurrence', () => {
  test('finds a mid-word fragment that keyword search cannot reach', async () => {
    const s = await fullSession();
    // The contrast, asserted in both directions — "grep found it" alone would also pass if search
    // found it too, and then the tool would be redundant rather than necessary.
    expect(
      await searchTitles(O.request, s, 'ubsyste'),
      'a fragment inside a word is not a term',
    ).toHaveLength(0);
    expect(
      await grepTitles(O.request, s, 'ubsyste'),
      'but it is in the text, so grep returns it',
    ).toContain('Subsystem');
  });

  test('finds a punctuation-glued token, and returns the line it is on', async () => {
    const s = await fullSession();
    const { body } = await grep(O.request, s, 'SM-4471/b', { fixed: true });
    const hit = grepHits(body).find((h) => h.title === 'Subsystem');
    expect(hit, 'the note is found').toBeDefined();
    expect(hit?.lines[0]?.text, 'and the answer is the line itself').toContain('SM-4471/b');
    expect(hit?.lines[0]?.line, 'with its line number — it is on the second line').toBe(2);
  });

  test('every occurrence, not the best one — both notes come back, counted', async () => {
    const s = await fullSession();
    const { body } = await grep(O.request, s, 'subsystem');
    const titles = grepHits(body).map((h) => h.title);
    expect(titles, 'exhaustive across notes').toEqual(
      expect.arrayContaining(['Subsystem', 'Elsewhere']),
    );
    const elsewhere = grepHits(body).find((h) => h.title === 'Elsewhere');
    // Twice on ONE line. A count that said 1 would be counting lines while calling itself matches.
    expect(elsewhere?.matches, 'occurrences, not lines').toBe(2);
  });

  test('the scope holds — a note outside the code is not in the result', async () => {
    const s = await narrowSession();
    const titles = await grepTitles(O.request, s, 'subsystem');
    expect(titles, 'inside the narrow glob').toContain('Subsystem');
    expect(titles, 'a second door into the corpus is still a door').not.toContain('Hidden');
  });
});

test.describe('corpus_grep · patterns', () => {
  test('regex metacharacters mean what they say', async () => {
    const s = await fullSession();
    // `.` as a regex matches any character, so this reaches "SM-4471/b".
    expect(await grepTitles(O.request, s, 'SM-44..'), 'regex by default').toContain('Subsystem');
    // The same pattern taken literally matches nothing — there is no "SM-44.." in the corpus.
    expect(
      await grepTitles(O.request, s, 'SM-44..', { fixed: true }),
      'fixed:true quotes the metacharacters',
    ).toHaveLength(0);
  });

  test('a broken pattern is a sentence, not a stack trace', async () => {
    const s = await fullSession();
    const { body } = await grep(O.request, s, 'unclosed(');
    // A broken pattern is an ANSWER, not a transport failure — same shape corpus_read uses for
    // "not found". The agent reads it and fixes the pattern; a 500 would tell it nothing.
    expect(grepHits(body), 'no hits are invented').toHaveLength(0);
    expect(grepError(body), 'and it says what is wrong with the pattern')
      .toMatch(/invalid search pattern/i);
    expect(grepError(body), 'no internals').not.toMatch(/panic|goroutine|0x[0-9a-f]{6}/);
  });
});
