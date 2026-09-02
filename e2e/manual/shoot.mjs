// shoot.mjs —— manual-verification **photo driver**: opens a real browser, logs in, clicks,
// types, and screenshots like a human.
//
// Why it exists: step 5 of the real-environment audit (going back to the real environment
// and re-verifying with eyes) has always been driven by the Playwright MCP; that MCP drops
// connection, and when it does, all that's left is a Chrome running on **another machine**
// (`isLocal:false`) that can't reach the local 38227. Swap the driver and you're done —
// the environment is still real prod, real vault, real corpus.
//
// **It is not e2e** — two things must stay distinct:
//   - e2e drives the dev stack and **resets the instance for every spec**. This script drives
//     **prod (38227)**, and **never resets**: the corpus in prod mirrors the real vault, and
//     resetting it would lose it.
//   - e2e assertions are for the machine; this script only produces images for a human. Judge
//     by looking at the image, not by reading DOM text.
//
// **Is writing allowed?** Most plans only log in, navigate, and screenshot. But the owner
// flipping a switch in their own backend is also "clicking like a human" — some checks'
// preconditions can only be created that way (e.g. the backlinks rail needs an edge from one
// published note to another). So writes are allowed, with two boundaries: (1) only through
// the product's own UI, never touching the database or injecting cookies; (2) whatever gets
// written must come from the real vault — never fabricate a note for the test. Publishing a
// note that **already exists** is not injection; creating a new one is.
// A plan that had to create its own preconditions must note in its trajectory which cell was
// altered by me.
//
// Usage (through the Makefile, never bare):
//   make verify-shots PLAN=e2e/manual/plans/<name>.json
//
// plan shape: { "out": "<trajectory dir>", "viewport": [w,h], "shots": [{ "name": "...",
//   "url": "/admin/seo", "wait": 1200, "steps": [{ "click": "text=..." } | { "type": ["sel","txt"] }
//   | { "wait": 800 }] }] }
// `steps` supports only click and type — the two things a human can actually do; `wait` leaves
// room for lazy loading, not an action of its own.

import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:38227';
const EMAIL = process.env.STANDMEET_OWNER_EMAIL ?? '';
const PASSWORD = process.env.STANDMEET_OWNER_PASSWORD ?? '';

const planPath = process.argv[2];
if (!planPath) {
  console.error('usage: node e2e/manual/shoot.mjs <plan.json>');
  process.exit(2);
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const [vw, vh] = plan.viewport ?? [1280, 900];
await mkdir(plan.out, { recursive: true });

// profile —— launch with a browser profile that's **already signed in**
// (`"profile": "~/.playwright-mcp-profile"`).
// Why it's needed: some cells need equipment that's **a third-party-issued secret**
// (the Cal.com one expired 2026-08-11), and rotating it means clicking through the
// vendor's own settings page. The owner's profile is already signed into Google, so
// "sign in with Google" is just a consent click, not a password — that boundary only
// blocks passwords. **Only use it when fetching equipment**: plans that drive the
// product itself should not carry it, so the prod owner session doesn't share disk
// state with a third-party session.
const profileDir = typeof plan.profile === 'string'
  ? plan.profile.replace(/^~/, process.env.HOME ?? '~') : '';
const persistent = profileDir !== '';
// HEADED=1 —— open the window. **Use it for plans that need a human to step in**:
// a password entry in a third-party login box, picking an account in the account
// selector — in headless mode the owner can't even see it, let alone click it, and
// can only wait out the timeout.
const browser = persistent
  ? null
  : await chromium.launch({ headless: process.env.HEADED !== '1' });
const ctx = persistent
  ? await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome', headless: false, viewport: { width: vw, height: vh },
  })
  : await browser.newContext({ viewport: { width: vw, height: vh } });
// **let, not const** —— the `popup` step swaps the driven target for the newly
// opened page (see runSteps).
let page = persistent ? (ctx.pages()[0] ?? await ctx.newPage()) : await ctx.newPage();

// acceptDialogs —— always click "OK" on native confirm()/alert(). **Must be turned
// on explicitly per plan**: clicking OK is a real action, but accepting by default
// would silently click through a destructive confirmation in some other plan, and
// when that happens the screenshot shows nothing wrong. A plan that needs it must
// set `"acceptDialogs": true` itself.
if (plan.acceptDialogs === true) {
  page.on('dialog', (d) => { void d.accept(); });
}

// downloadDir —— save page-triggered downloads to disk. What a human gets by
// clicking "download" is the file itself; **not** copying content off a screenshot.
// Mis-transcribing one character of a base64 private key produces a failure that
// looks like a product bug, not like my own transcription error.
if (typeof plan.downloadDir === 'string') {
  await mkdir(plan.downloadDir, { recursive: true });
  page.on('download', (d) => {
    void d.saveAs(`${plan.downloadDir}/${d.suggestedFilename()}`)
      .then(() => console.log(`download ${d.suggestedFilename()}`));
  });
}

// Forward all browser-side logs unconditionally. Without this, a login that just
// sits there only ever produces a single waitForURL timeout — and that timeout
// says the same thing for "the form didn't submit", "the request went out but
// got a 4xx", and "JS crashed". So it can only be reasoned about, and reasoning
// missed the mark three times running.
// Forward everything, not just error/warning. The product's own receipt
// (`[turnstile] rendered widget id=…`) is a `console.log`, and the version that
// only forwarded errors filtered it out — so whether the CAPTCHA widget rendered
// was invisible on the page and inaudible on the console, leaving only reasoning.
page.on('console', (m) => console.log(`console.${m.type()} ${m.text()}`));
page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
page.on('requestfailed', (r) => console.log(`requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`http ${r.status()} ${r.request().method()} ${r.url()}`);
});

// Sign in through the **real form**: fill email, fill password, press enter —
// never inject a cookie, never plant a token.
if (plan.login !== false) {
  // Stop immediately on empty credentials. `?? ''` would fill them into the form as-is,
  // the product would reply "email + password required", and the driver could only
  // report a waitForURL timeout — "forgot to load credentials" would then look
  // exactly like "the product's login is broken".
  if (EMAIL === '' || PASSWORD === '') {
    console.error('no owner credentials in env — run it through `make verify-shots PLAN=…`, '
      + 'which sources ~/.config/standmeet/verify-creds.env');
    process.exit(2);
  }
  await page.goto(`${BASE}/login`);
  await page.getByTestId('email').fill(EMAIL);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('password').press('Enter');
  // `**/admin**`, not `**/admin/**`: after a successful login, LoginForm pushes
  // `/admin` itself (`LoginForm.tsx:164`) with nothing after it, so a slash-terminated
  // glob won't match and this would time out even though login clearly succeeded —
  // and the result would look like "login failed".
  await page.waitForURL('**/admin**', { timeout: 15_000 }).catch(async (err) => {
    // On timeout, report exactly what's on screen: which URL it's stuck at, what
    // error the form itself reported, and whether the submit button is disabled.
    const err_text = await page.getByTestId('error').textContent().catch(() => null);
    const disabled = await page.getByTestId('submit').isDisabled().catch(() => null);
    console.log(`login stuck at ${page.url()} · form error=${err_text} · submit disabled=${disabled}`);
    throw err;
  });
}

for (const shot of plan.shots) {
  // Omitting url = **stay on the current page**. Some checks are specifically about
  // "what happens without a page change" (two turns in a row in the same conversation,
  // whether a dismissed modal comes back) — and if every shot did a goto first, that
  // could never happen.
  // Absolute URLs pass through unchanged. Several checks' Expected is written on
  // **a third party's own UI** ("open this account's calendar web page, see whether
  // the event is there") — the product claiming a booking is only a claim; the
  // calendar is the fact. Appending it after BASE would produce a 404 that looks
  // like "the event doesn't exist".
  shot.url && await page.goto(
    shot.url.startsWith('http') ? shot.url : `${BASE}${shot.url}`,
  );
  // settle —— wait for a selector to appear, and **report how long it took from
  // goto to appearance**.
  // Some checks ask "does a heavy real note render fast?", and "looks fine" is not
  // a measurement: a judgment needs a number, and the number needs a clear start
  // and end instant. `{"settle": ["sel", 20000]}`.
  if (shot.settle) {
    const t0 = Date.now();
    await page.locator(shot.settle[0]).first()
      .waitFor({ timeout: shot.settle[1] ?? 20_000 })
      .catch(() => console.log(`settle TIMEOUT ${shot.name} : ${shot.settle[0]}`));
    console.log(`settle ${shot.name} : ${Date.now() - t0}ms (${shot.settle[0]})`);
  }
  await runSteps(shot.steps ?? []);
  await page.waitForTimeout(shot.wait ?? 1200);
  const file = `${plan.out}/${shot.name}.png`;
  // fullPage —— content that doesn't fit on one screen (the reader's backlinks
  // rail sits after the body) needs a full-page shot. Previously "clicking body"
  // was used to fake a scroll, producing two identical screenshots — that's not
  // evidence.
  await page.screenshot({ path: file, fullPage: shot.fullPage === true });
  console.log(`shot ${file}`);
}

async function runSteps(steps) {
  for (const step of steps) {
    // repeat —— run the same sequence of actions n times: `{"repeat": [32, [ …steps… ]]}`.
    // Some checks only hold at a specific **count** (the login-attempt cap is 30/5min),
    // and copy-pasting the same JSON 32 times risks one mistyped copy looking like a
    // product bug. A human also repeats the same action.
    step.repeat && await (async () => {
      for (let i = 0; i < step.repeat[0]; i++) {
        await runSteps(step.repeat[1]);
      }
    })();
    // popup —— swap the driven target for **the most recently opened page**.
    //
    // Some actions do `window.open(..., '_blank')`: the calendar's AUTHORIZE button
    // is one, and the consent page opens in a new tab. If the driver only watches
    // the original page, a click looks like "nothing happened" — while a human
    // would follow the newly opened page.
    // Usage: `{"popup": true}` (right after the click step), optionally `{"popup": 3000}`
    // to wait for it to open first.
    step.popup && await (async () => {
      const waitMs = typeof step.popup === 'number' ? step.popup : 1500;
      await page.waitForTimeout(waitMs);
      const pages = ctx.pages();
      page = pages[pages.length - 1] ?? page;
      await page.bringToFront();
    })();
    // click —— a selector, or `["selector", n]` to click the nth one (0-based).
    // A list page has the same action button on every row (the `edit` button
    // across 575 corpus entries), and a human clicks **by looking at position**:
    // filter the list down first, see which row it is, then click that row.
    // Without an index it can only ever click the first row.
    step.click && await (async () => {
      const [sel, n] = Array.isArray(step.click) ? step.click : [step.click, 0];
      await page.locator(sel).nth(n).click();
    })();
    // clickFrame —— click something **inside a sandbox card**:
    // `{"clickFrame": ["iframe selector", "in-card selector"]}`.
    // The capability-provided ui:// cards (booking receipt, slot picker) all
    // render inside a sandbox iframe that the main document's selectors can't
    // reach — and the buttons a visitor would actually click (Cancel meeting,
    // a time-slot chip) all live in there. Without this step, every check that
    // interacts with a card can only "see it, not click it".
    step.clickFrame && await page.frameLocator(step.clickFrame[0])
      .locator(step.clickFrame[1]).first().click();
    step.type && await page.locator(step.type[0]).first().fill(step.type[1]);
    // typeFile —— paste from a file. Hand-transcribing a long note's body into
    // the plan's JSON means escaping newlines, quotes, brackets, and one mistyped
    // character makes it look like the product corrupted the content, not like
    // my own transcription error (same reasoning as downloadDir). A human
    // copy-pastes from a file, which is a real action.
    step.typeFile && await page.locator(step.typeFile[0]).first()
      .fill(await readFile(step.typeFile[1], 'utf8'));
    // typeOwner —— fill the owner's own email/password into an input (values
    // come from verify-creds.env). The plan is JSON committed to the repo, so
    // the password can't be written into it; and some checks specifically need
    // to see what the product says when the **correct** password is combined
    // with a failed CAPTCHA — driving it with a wrong password conflates two
    // possible causes behind the same message, and that cell would prove
    // nothing. A `login: false` plan that walks the login form itself uses this.
    step.typeOwner && await page.locator(step.typeOwner[0]).first()
      .fill(step.typeOwner[1] === 'password' ? PASSWORD : EMAIL);
    // typeSecret —— fill the value of a variable from `verify-creds.env` into an
    // input: `{"typeSecret": ["sel", "DEEPSEEK_KEY"]}`. The plan is committed;
    // the secret is not — the plan only names it. These credentials exist purely
    // for verification, and the product's own form is exactly where they belong —
    // the BYOAI cell specifically needs "a visitor fills in their own key", and
    // without a key that check can't be driven at all. Stop immediately when the
    // variable doesn't exist: filling in an empty string would make the product
    // say "key cannot be empty", which looks exactly like "the product is broken".
    step.typeSecret && await (async () => {
      const v = process.env[step.typeSecret[1]] ?? '';
      if (v === '') {
        console.error(`typeSecret: ${step.typeSecret[1]} is not in the environment — run it `
          + 'through `make verify-shots`, which sources ~/.config/standmeet/verify-creds.env');
        process.exit(2);
      }
      await page.locator(step.typeSecret[0]).first().fill(v);
    })();
    // pickDir —— select a **directory** into an `<input type="file" webkitdirectory">`
    // (the control the vault import uses). A human clicking "import from Obsidian"
    // also picks a directory in the system dialog.
    step.pickDir && await page.locator(step.pickDir[0]).setInputFiles(step.pickDir[1]);
    // select —— pick an option from a dropdown. A human clicks it open and picks
    // one; the `type` step (fill) has no effect on a `<select>`.
    step.select && await page.locator(step.select[0]).first().selectOption(step.select[1]);
    // press —— some things can only be submitted with a keypress (the visitor
    // chat box has no send button; Enter is the send action).
    step.press && await page.locator(step.press[0]).first().press(step.press[1]);
    // hover —— park the mouse over something. A chart's reading only appears
    // under the pointer, and a screenshot can't capture "the mouse just passed
    // through" — to catch the tooltip, the pointer has to actually be placed
    // there and **stay there**.
    // Usage: {"hover": "[data-testid=\"sparkline-box\"]"} or {"hover": ["sel", 0.9]}
    // (0.9 = horizontal position fraction)
    step.hover && await (async () => {
      const sel = Array.isArray(step.hover) ? step.hover[0] : step.hover;
      const frac = Array.isArray(step.hover) ? step.hover[1] : 0.5;
      const box = await page.locator(sel).first().boundingBox();
      box && await page.mouse.move(box.x + box.width * frac, box.y + box.height / 2);
      await page.waitForTimeout(300);
    })();
    // scroll —— move the mouse over a container and scroll it. Admin's scrolling
    // happens in **inner containers** (the sidebar has its own overflow-y-auto,
    // the body another), so "scroll the page" doesn't move them, and fullPage
    // can't capture them either — whether "what's further down is reachable"
    // can only be judged by actually scrolling once. Usage: {"scroll": ["nav", 600]}
    step.scroll && await (async () => {
      await page.locator(step.scroll[0]).first().hover();
      await page.mouse.wheel(0, step.scroll[1]);
      await page.waitForTimeout(400);
    })();
    // For a lazily-loaded tree: the previous click needs to wait for the next
    // level to be fetched before the next selector exists.
    step.wait && await page.waitForTimeout(step.wait);
  }
}

await (persistent ? ctx.close() : browser.close());
