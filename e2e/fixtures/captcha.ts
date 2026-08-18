// captcha.ts —— 人机校验相关的用例，只有在**实例真的开着 captcha** 时才有意义。
//
// 为什么需要这个闸：这些 spec 自己的注释写着「只能走 `make test-captcha` 驱」，而**没有任何
// 机制拦着它们在默认 `make test` 里跑** —— 于是默认套件里恒定 5 条红。这样一来「全套绿」这条
// 判据就废了：一份永远红的报告，读它的人只会学会忽略红色（[[green-means-the-real-suite-ran]]）。
// 靠文件名约定或靠人记得换 target，都是需要人维护的检查（[[structure-means-no-responsibility-class]]）。
//
// 所以问实例本身：`GET /api/v1/instance` 的 `captcha_site_key` 空 = 这台没开 captcha。
// 空就跳过，并把原因印出来 —— 跳过必须说明它跳过了什么，否则跟「测过了」在报告上长得一样。

import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function captchaIsOn(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  if (!res.ok()) return false;
  const body = await res.json() as { captcha_site_key?: string };
  return (body.captcha_site_key ?? '') !== '';
}

/** 在 beforeAll 里调：这台没开 captcha 就整组跳过，并说清怎么真跑它。 */
export async function skipUnlessCaptchaOn(request: APIRequestContext): Promise<void> {
  const on = await captchaIsOn(request);
  test.skip(!on, 'captcha 没开（instance 不发 site key）—— 这组要走 `make test-captcha`');
}
