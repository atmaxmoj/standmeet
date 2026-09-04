// captcha.ts —— captcha-related cases only make sense when the **instance
// actually has captcha turned on**.
//
// Why this gate is needed: these specs' own comments say "only run via `make
// test-captcha`", yet **nothing stops them from running in the default `make
// test`** —— so the default suite has a constant 5 reds. That voids the
// "whole-suite green" criterion: a report that's always red just teaches its
// reader to ignore red ([[green-means-the-real-suite-ran]]). Relying on a
// filename convention or on someone remembering to switch targets is a check
// that needs a human to maintain ([[structure-means-no-responsibility-class]]).
//
// So ask the instance itself: an empty `captcha_site_key` on `GET /api/v1/instance`
// = this instance has captcha off. If empty, skip and print the reason —— a
// skip must say what it skipped, otherwise it looks the same as "tested" in the report.

import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function captchaIsOn(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (!res.ok()) return false;
  const body = await res.json() as { captcha_site_key?: string };
  return (body.captcha_site_key ?? '') !== '';
}

/** Call in beforeAll: if this instance has captcha off, skip the whole group,
 *  and spell out how to actually run it. */
export async function skipUnlessCaptchaOn(request: APIRequestContext): Promise<void> {
  const on = await captchaIsOn(request);
  test.skip(!on, 'captcha 没开（instance 不发 site key）—— 这组要走 `make test-captcha`');
}
