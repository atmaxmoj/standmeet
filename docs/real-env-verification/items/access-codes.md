# access-codes — Access codes / invitations: issue, list, QR, revoke, redeem

- **Status:** ⬜ not started (new round)
- **Module:** the owner's access-code management — codes issue, **render in the list**, show QR + members/quota/expiry, revoke, and redeem end-to-end (request → approve → email → redeem). AccessCode === invitation.
- **Surface:** admin/codes + `/gate` (redeem) + admin/requests (approve).
- **Real dep:** prod stack; real mail (see [[mail-connector]]) for the emailed-code path.
- **Inherits (historical finding IDs):** `F-D-1` (dashboard KPI reads "CODES LIVE 3" while `/admin/codes` renders "No codes yet" — count right, list broken).
- **Backing e2e:** `access-codes` · `admin-requests` · `mail-connector`.

## Checks

### 1 — Owner can see their own access codes ⭐  (was F-D-1)
- **Steps:** issue a code (e.g. through admin/codes) → confirm it **RENDERS in the `/admin/codes` list** and the list **matches the codes-live KPI count**. Confirm each code shows its **QR**, members/quota/expiry, and that **revoke** / **copy-share** fire.
- **Expected:** the list shows every live code and agrees with the KPI; the owner can share the QR, see members/quota, and revoke.
- **⚠️ finding:** the dashboard KPI reads "CODES LIVE 3 · 3 active" but `/admin/codes` renders **"No codes yet."** — the codes demonstrably EXIST (FA5-001 was created through this very page and a visitor redeemed it end-to-end). So the COUNT is right and the LIST is broken; the whole code-management surface is dead while the feature underneath works. Same count-vs-list divergence family as F-L-4 (mirror image: list empty, count fine).
- **Backing test:** no spec asserts a seeded code RENDERS on /admin/codes — `access-codes.spec.ts` drives issue/redeem via API, so an empty list never fails. Step-3 attribution: compare the list query/scope against the growth-stats count (owner_id scope? a status/expiry filter? response-shape the frontend zod-strips to []?).
- **Result:** ⬜
### 2 — Access-request → approve → email-with-code → redeem  (was §Q2)
- **Steps:** a no-code visitor submits a request on `/gate` → owner sees it in admin/requests → approves → a real code email lands in a **real inbox** → the visitor opens the emailed `/{handle}?code=` → session opens → chat works. One continuous journey.
- **Expected:** the whole chain works with **real mail**; approve is blocked without a verified mail connector; the emailed code redeems into a working session.
- **⚠️ mock gap:** no single spec walks the whole thing — CI proves the request list, the approve gate, and code redemption **separately**; the real-mail hop is only ever mailpit/mock.
- **Backing test:** `admin-requests.spec.ts:35` · `:70` (approve rejected without verified mail) · `mail-connector.spec.ts:29` · `access-codes.spec.ts` (redemption)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The `/admin/codes` **list shows issued codes and matches the codes-live KPI** (F-D-1); each code's **QR renders**; revoke/copy-share fire; admin/requests list shows pending (count == list).

## Findings
(record here; also log `../findings.md`, ID `F-D-1` historical anchor)

- **F-D-1 ⭐** (owner-reported mid-audit): KPI "3 · 3 active" vs `/admin/codes` "No codes yet"; FA5-001 was created through this page and redeemed end-to-end (session issued, strip showed `code · FA5-001`). Count right, list broken → owner can't share QR / see members / revoke. 🔴 manual-red, needs step-3.
