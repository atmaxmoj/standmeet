# StandMeet — Test Backlog

> The complete spec backlog, derived from the `[✓ built-in]` / `[ ]` / `[~]` tags
> in features-and-journeys.md. Each item is one e2e test case (not a file — one
> .spec.ts file can hold several cases).
>
> Organized by state machine / user flow. Each flow lists the happy path + error
> flows + edge cases + state transitions. `[done]` means an existing spec covers
> it; an empty box is one to add.
>
> Current state: 63 spec files / 92 test cases. The list below is the full-coverage target.

---

## 1. Visitor Session state machine

### 1.1 Code-tier session

**Happy path:**
- [done] Scan QR into `/?code=ABC` → absorb → URL cleared → SessionStrip appears (qr-code-absorb)
- [done] Enter code by hand on the gate → submit → ChatRoom (gate-access)
- [ ] Paste code → auto-submit → ChatRoom (no need to press enter)
- [ ] Scan QR → VisitorNamePicker pops up → enter name → ChatRoom welcome includes the name
- [ ] Scan QR → VisitorNamePicker → skip → ChatRoom welcome without a name ("anonymous")

**Error flows:**
- [done] Invalid code → error message (qr-code-absorb invalid case)
- [ ] Expired code → "code expired" message + points to /gate#request
- [ ] Revoked code → "code revoked" message
- [ ] Submit an empty code → button disabled / nothing fires
- [ ] Network down → session creation fails → friendly error message (not a raw stack trace)

**State transitions:**
- [ ] session active → reload page → session restored from localStorage → still in ChatRoom
- [ ] session active → click "exit session" → back to long-scroll
- [done] session active → SessionStrip shows code label + gauge (session-strip)

### 1.2 BYOAI session

**Happy path:**
- [done] gate BYOAI panel → fill provider + key → submit → ChatRoom BYOAI mode (byoai-chat)

**Error flows:**
- [ ] BYOAI submit with empty key → button disabled
- [ ] BYOAI key in a wrong format → client-side message
- [ ] BYOAI key becomes invalid mid-chat (4xx from provider) → error turn + prompt to re-enter
- [ ] BYOAI visitor asks about a private topic → "need a code" response (not an error)

**State transitions:**
- [done] BYOAI → SessionStrip violet "visitor-paid · unlimited" (session-strip)
- [ ] BYOAI → reload → session restored → still in ChatRoom BYOAI mode
- [ ] BYOAI → exit → back to long-scroll

### 1.3 Cross-tab sync

- [ ] Tab A logs in with a code → Tab B storage event → SessionStrip appears in sync
- [ ] Tab A exits the session → Tab B SessionStrip disappears
- [ ] Tab A quota exhausted → Tab B composer locks

### 1.4 Quota state machine

- [done] turns < max → composer usable (turn-quota)
- [done] turns = max → composer locked + "session full" (code-quotas)
- [ ] turns reach 80% → SessionStrip turns warn (accent red) + "request more ↗" appears
- [ ] quota exhausted → new messages are not sent + friendly message (not a silent no-op)
- [ ] max_turns = 0 (unlimited) → never locks
- [done] per-member quota accumulates (member-quotas, quota-accumulation)
- [ ] owner changes a quota value → takes effect on the next session
- [ ] code revoke → existing session locks immediately? Or a grace period?

---

## 2. ChatRoom state machine

### 2.1 ChatRoom layout switching

- [ ] public visitor (no session) → sees long-scroll (Hero + Insights + Projects + Where + Contact)
- [ ] coded visitor → sees ChatRoom (slim header + welcome + composer) — does not see long-scroll
- [ ] BYOAI visitor → sees ChatRoom (BYOAI mode welcome)
- [ ] ChatRoom → click "full page →" → switch to long-scroll? Or a new tab?
- [ ] long-scroll visitor asks a question → ConversationDeck appears + scroll to answer

### 2.2 ChatComposer

- [ ] starter chips render (coded: 3 starters / BYOAI: 2 starters)
- [ ] click a starter chip → sends automatically → chips disappear (showStarters = conv.length > 0)
- [ ] type by hand → ask ↵ → turn renders → "retrieving ···" → answer renders
- [ ] pending state → input disabled + submit greyed out
- [ ] exhausted → "session full" replaces "ask ↵"
- [ ] rapid repeated submits → pending lock prevents duplicate sends

### 2.3 ChatWelcome

- [ ] coded mode → shows code label + scope description + "ask anything"
- [ ] BYOAI mode → shows provider name + "public slice only"
- [ ] coded + has visitor name → "Hi, {firstName}"
- [ ] coded + no visitor name → "Hi"

### 2.4 Turn rendering

- [ ] normal answer → serif body paragraphs + "ai" speaker label
- [ ] answer with citations → "drawn from" block appears
- [ ] answer with ToolCallBlock (calendar) → slot grid renders
- [ ] answer with ToolCallBlock (file) → download pill renders
- [ ] pending → "retrieving ···" animation
- [ ] error → error message renders (not blank)
- [ ] reset → all turns cleared + welcome reappears

---

## 3. Gate state machine

### 3.1 Code panel

- [done] correct code → redirect to / (gate-access)
- [ ] paste code → uppercase normalization + filter out non-[A-Z0-9-]
- [ ] wrong code → shake animation → cleared → refocus
- [ ] "checking…" state → button label changes after submit
- [ ] submit code + name together → session carries the visitor name

### 3.2 BYOAI panel

- [done] all 4 fields filled → submit → redirect (byoai-chat)
- [ ] required field missing → submit disabled
- [ ] switch provider → endpoint/model placeholder changes

### 3.3 Request access form

- [done] fill email/name/org/message → submit → "sent" state (gate-access)
- [ ] empty email → submit not allowed
- [ ] repeated submit → disabled to prevent duplicates
- [ ] after submit → collapsible "sent, we'll get back to you"

---

## 4. Blog state machine

### 4.1 Blog index

- [done] posts exist → cover card grid renders (blog-posts)
- [done] infinite scroll → loads more (blog-posts)
- [ ] tag filter → click a tag → only that tag's posts are shown
- [ ] tag filter → click the same tag again → filter cleared (all)
- [ ] 0 posts → empty state
- [ ] AskCorpusCTA → click "open the chat →" → jumps to /
- [ ] RecommendedRail → "if you only read two" → shows the top 2 posts + clickable

### 4.2 Blog article

- [done] public post → cover + header + body + backlinks (blog-posts, blog-crosslinks)
- [done] AskAboutThis → starter prompt → /?q=... (ask-about-this)
- [ ] private post + no code → LockedView (teaser + request CTA)
- [ ] private post + code (scope matches) → renders normally
- [ ] crosslink [[slug]] → renders as a link + click navigates
- [ ] broken crosslink [[nonexistent-slug]] → renders as plain text (no error)
- [ ] XSS body → not executed (already exists, but verify depth)

### 4.3 FloatingChatDock

- [ ] blog index → bottom-right pill visible (when there is a session)
- [ ] no session → pill not rendered
- [ ] click pill → panel expands → input visible
- [ ] type → ask → answer renders → transcript scrolls inside the panel
- [ ] close panel → pill returns
- [ ] persists across pages (blog → wiki → pill still there)

---

## 5. Wiki / Output Landing state machine

### 5.1 Wiki landing

- [done] public wiki → breadcrumb + body + TrustBox (wiki-landing)
- [ ] cover hero renders (title + date)
- [ ] private wiki + no code → LockedView ("requires access code" + gate link)
- [ ] private wiki + code (scope matches) → renders normally
- [ ] AskAboutThis (kind=wiki) → /?q=... jumps to chat
- [ ] nonexistent slug → 404

### 5.2 Output landing

- [done] public output → breadcrumb + TrustBox (output-landing)
- [ ] cover hero + PDF preview card render
- [ ] gated output + no code → LockedView
- [ ] gated output + code → renders normally
- [ ] AskAboutThis (kind=output) → /?q=...
- [ ] nonexistent slug → 404

---

## 6. Admin Dashboard state machine

- [ ] owner logs in → dashboard is the default landing
- [ ] 4 KPI cards show real data (entries / unprocessed / codes / requests)
- [ ] sparkline SVG renders a 14-day curve
- [ ] "needs your hand" → requests > 0 → "review →" link clickable
- [ ] "needs your hand" → raw unprocessed > 0 → "open →" link clickable
- [ ] "needs your hand" → drafts reviewing > 0 → "review →" link clickable
- [ ] all 0 → "nothing pending" empty state
- [ ] recent visitors → shows the latest 5 conversations
- [ ] jobs heat → sent count comes from /api/admin/applications/
- [ ] jump links → click navigates to the matching admin section

---

## 7. Admin Sidebar state machine

- [done] 6 groups render + active highlight (admin-auth-guards)
- [ ] badge: raw unprocessed > 0 → badge number appears
- [ ] badge: requests new > 0 → badge number appears
- [ ] badge: data changes → 60s polling refreshes the badge
- [ ] click a nav link → section switches + active moves

---

## 8. Admin Corpus CRUD state machine

### 8.1 Raw

- [done] list + filter (corpus-crud-ui)
- [ ] DumpBox → pick a source chip → type → dump → new row appears in the list
- [ ] switch filter (unprocessed / flagged-private / promoted / all) → list filtered
- [ ] promote → wiki modal → fill title + tags → confirm → raw becomes "promoted"
- [ ] archive → raw disappears (or is marked archived)
- [ ] edit body → save → body updated
- [ ] media metadata renders (entries with media show kind · label)

### 8.2 Wiki

- [done] list + create + edit + delete (corpus-crud-ui)
- [ ] tag filter → click a tag → wiki list filtered
- [ ] excerpt paragraph → shows the first 200 characters of body
- [ ] visibility dot → public grey / private accent
- [ ] promote to output → new entry appears in the output list
- [ ] SEO editing → slug / description / indexed toggle

### 8.3 Output

- [done] list + create + edit + delete (output-promotion)
- [ ] cover strip hue gradient renders
- [ ] tier pill (public / unlisted / private) renders correctly
- [ ] views / downloads stats shown
- [ ] dual create buttons (pdf / web essay)

---

## 9. Admin Conversations state machine

- [done] table renders + transcript modal (conversations-per-code)
- [ ] sentiment column → shows the correct label from turn count (short / curious / warm / engaged)
- [ ] BYOAI conversation → sentiment = "shopping"
- [ ] private_hits > 2 → sentiment = "probing"
- [ ] click a row → transcript expands inline
- [ ] ?code=LABEL → filter shows only that code's conversations
- [ ] clear filter → shows all

---

## 10. Admin Codes state machine

- [done] create + list + quota (access-codes, code-quotas)
- [ ] 3-col card layout → members column + scope chips + inline QR visible at the same time
- [ ] click QR → QR modal / download PNG
- [ ] Quota bar → visual progress bar shows used/max correctly
- [ ] revoke → card greys out + "expired" status
- [ ] edit code → change label / scope / quota → save → card updated
- [ ] "view conversations →" → jumps to conversations?code=XXX

---

## 11. Admin Requests state machine

- [ ] open request → "approve · issue code →" button visible
- [ ] approve → AccessCode issued automatically + request becomes approved
- [ ] decline → request becomes declined + reason shown
- [ ] defer → request becomes pending
- [ ] block sender → UI feedback (backend not wired yet; verify the UI first)
- [ ] blockquote message renders correctly (italic serif + left border)
- [ ] filter chips → switch between open / replied / closed / all

---

## 12. Admin Drafts + Applications state machine

### 12.1 Drafts

- [ ] draft card → 2-col layout (content + PDF preview thumbnail)
- [ ] status pill color (reviewing = amber / draft = neutral / sent = accent)
- [ ] diff-vs-master quote block (accent left border background)
- [ ] reviewing → three buttons: "open composer →" + "edit" + "regenerate"
- [ ] draft → two buttons: "finish drafting →" + "discard"
- [ ] sent → two buttons: "view application" + "view pdf"
- [ ] open composer → ResumeComposer full-screen overlay opens
- [ ] empty state → "No drafts pending."

### 12.2 Applications

- [ ] application card → 3-col footer (contact / notes / "open ›")
- [ ] click card → ApplicationDetailModal opens
- [ ] modal → timeline renders (sent → opened → reviewing)
- [ ] modal → status segmented switch (silent / reviewing / replied / rejected / offer)
- [ ] modal → notes textarea editable
- [ ] empty state → "No applications sent yet."

---

## 13. Admin Connectors state machine

- [done] ConnectorAddModal + config form (connector-add-modal)
- [ ] dashed "＋ browse the catalog" card → click → modal opens
- [ ] switch category tab → catalog grid filtered
- [ ] installed connector → "● installed" pill
- [ ] config form → secret field → reveal/hide toggle
- [ ] config form → oauth field → "Authorize…" button
- [ ] connect → tile state becomes "● connected"

---

## 14. Admin Skills state machine

- [done] create + list + delete (skills, skill-scripts)
- [ ] heat-bar graph → renders 2-col grid + gradient bar
- [ ] role label → shown correctly from the heat value (core / strong / maintained / developing / dormant)
- [ ] "rebuild from corpus" button → UI feedback

---

## 15. Admin Preview state machine

- [ ] code picker → click a code → right-hand preview frame changes
- [ ] BYOAI card → click → "byoai mode · public scope" shown
- [ ] coded preview → banner shows code label + "scoped to N topics"
- [ ] coded preview → suggested questions shown (from code.suggested_questions)

---

## 16. Admin SEO / Obsidian / System

### 16.1 SEO
- [ ] defaults form → every field visible
- [ ] "regenerate sitemap" button → UI feedback
- [ ] indexing stats → pages / outputs / posts shown
- [ ] OG preview card renders

### 16.2 Obsidian
- [ ] vault stats 4-cell (mode / notes / size / last sync) renders
- [ ] "import vault zip" button visible
- [ ] "export corpus zip" button visible

### 16.3 System
- [ ] terminal block → version / uptime render
- [ ] background jobs table → row count ≥ 3
- [ ] health checks → status dots (ok = accent / warn = amber)

---

## 17. Setup Wizard state machine

- [done] 4 step happy path (claim-instance, setup-wizard-4step)
- [done] password mismatch → error (setup-wizard-4step)
- [done] wrong captcha → error (setup-wizard-4step)
- [ ] step 1 → illegal characters in handle → next disabled
- [ ] step 1 → publicUrl not http → next disabled
- [ ] step 3 → pick a provider → key field placeholder changes
- [ ] step 3 → ollama selected → key field hidden (needsKey=false)
- [ ] back button → returns to the previous step → data kept
- [ ] step 1 left empty → next disabled (realtime)

---

## 18. Login state machine

- [done] correct credentials → /admin (owner-login)
- [done] wrong password → error message (owner-login)
- [ ] empty email → submit disabled
- [ ] empty password → submit disabled
- [ ] repeated failures → throttle message
- [done] forgot password → reset flow (password-reset)

---

## 19. Cross-feature integration

### 19.1 Job loop end to end

- [ ] register source → fetch_new → listings indexed → shortlist → resume.draft → open composer → edit → send → applications.commit → auto code issued → QR on PDF → recruiter scans → ChatRoom → owner sees the transcript in conversations

### 19.2 Corpus pipeline

- [ ] raw_dump (MCP) → appears in the raw list → promote to wiki → appears in the wiki list → wiki SEO landing reachable → promote to output → appears in the output list → output SEO landing reachable

### 19.3 Code → chat → transcript

- [ ] owner creates a code → visitor enters ChatRoom with the code → chats a few turns → owner sees transcript + sentiment + cited bodies in /admin/conversations

### 19.4 Blog → chat flow

- [ ] owner publishes a blog post → visitor sees it on /blog → opens the article → AskAboutThis → /?q=... → ChatRoom asks automatically → answer cites the corpus

---

## Statistics

| Category | done | to add |
|---|---|---|
| Visitor session | 6 | 18 |
| ChatRoom | 0 | 18 |
| Gate | 3 | 9 |
| Blog | 4 | 10 |
| Wiki/Output landing | 2 | 10 |
| Admin dashboard | 0 | 10 |
| Admin sidebar | 1 | 4 |
| Admin corpus CRUD | 3 | 12 |
| Admin conversations | 1 | 6 |
| Admin codes | 2 | 6 |
| Admin requests | 0 | 7 |
| Admin drafts/applications | 0 | 12 |
| Admin connectors | 1 | 6 |
| Admin skills | 1 | 3 |
| Admin preview | 0 | 4 |
| Admin SEO/obsidian/system | 0 | 9 |
| Setup wizard | 3 | 5 |
| Login | 2 | 3 |
| Cross-feature | 0 | 4 |
| **Total** | **29** | **~156** |

The existing 92 test cases cover about 29 state paths. Full coverage needs ~156 new cases.
