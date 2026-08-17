// byoai-insecure-origin.spec.ts —— F-D-14。**这个实例只要不是在自己本机打开，BYOAI 就是死的。**
//
// 访客的 key 是用 `crypto.subtle` 封进浏览器 vault 的（`byoai-vault.ts:54`），而 `crypto.subtle`
// **只在 secure context 存在**。`localhost` / `127.0.0.1` 是唯一不上 TLS 也算 secure 的来源 ——
// 于是开发、e2e、整轮手工审计**全跑在唯一一条看不见这个缺陷的路上**，而真访客和真 owner
// 必定从别的机器、用域名或 IP 打开这个实例。
//
// prod 上驱出来的样子：填满 provider/endpoint/model/key，按 START PUBLIC CHAT →
// `POST /api/v1/sessions` 返 200（后端一切正常）→ 屏幕上一句
// **"Couldn't check that just now. Try again."**。再试一万次都一样，那句话是假的。
//
// **判据不能在 localhost 上写**（那里 `isSecureContext` 恒为 true，红不起来）。所以这条 spec
// 用 Chrome 的 `--host-resolver-rules` 把一个域名指回本机：origin 变成 `http://visitor.test:…`
// —— **真正的非安全来源**，而后端还是同一个。这正是一个真访客拿到的东西。
//
// 断的是两件事，都是机制不是措辞：
//   1. 那颗按钮**进不去**（disabled）—— 不能让人填完一路再撞墙；
//   2. 面板上说得出**为什么**，并且指向 https —— 「再试一次」在这里是谎话。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoOnHost } from '@/fixtures/navigate';

const OWNER = {
  email: 'insecure@example.com',
  password: 'insecure-origin-pass-1',
  handle: 'insecureowner',
  fullName: 'Insecure Origin Owner',
};

// INSECURE_HOST —— 解析回本机、但**不是** localhost 的域名。Chrome 只把 localhost /
// 127.0.0.1 / ::1 当 secure，所以这个 origin 上 `crypto.subtle` 是 undefined —— 跟一个
// 真访客用 http 打开 owner 域名时拿到的完全一样。
const INSECURE_HOST = 'visitor.test';

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
});

test.describe('F-D-14 · BYOAI on a non-secure origin says the true thing', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the panel refuses up front and points at https, instead of inviting a retry',
    async ({ page }) => {
      // 同一个后端、同一个页面，只换来源：localhost → visitor.test。
      await gotoOnHost(page, INSECURE_HOST, '/gate');

      await page.getByTestId('byoai-provider').selectOption('deepseek');
      await page.getByTestId('byoai-endpoint').fill('https://api.deepseek.com');
      await page.getByTestId('byoai-model').fill('deepseek-chat');
      await page.getByTestId('byoai-key').fill('sk-0123456789abcdef0123456789abcdef');

      // ① 填齐了也不该放行 —— 这条路走不通，按钮就不该看起来能走。
      await expect(page.getByTestId('byoai-submit'),
        'on a non-secure origin the key cannot be stored, so the button must not invite the click')
        .toBeDisabled();

      // ② 说得出为什么，并且指向出路（https）。断 https 这个词，不断整句措辞。
      await expect(page.getByTestId('byoai-insecure-origin'),
        'the panel explains that this page has to be served over https')
        .toContainText(/https/i);
    });
});
