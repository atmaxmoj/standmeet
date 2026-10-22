// /og/writings/<slug>?v=<title hash> —— a writing's share card: its English title. A title the
// default font cannot draw (CJK), a writing that is gone: the site's card instead, never an error —
// og:image must always point at a picture.

import { fetchWriting } from '@/lib/api/public';
import { FOREVER, drawCard, drawSiteCard, siteMark } from '@/lib/og-card';

export const dynamic = 'force-dynamic';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const drawable = (title: string): boolean => title !== '' && !CJK.test(title);

export async function GET(
  _req: Request, { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const title = await fetchWriting(slug, 'en').then((w) => w.title.trim(), () => '');
  return drawable(title) ? drawCard(title, '', await siteMark(), FOREVER) : drawSiteCard();
}
