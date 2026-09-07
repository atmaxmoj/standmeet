# visitor-traffic — the owner can see who came, from where, and what they read

- **Module:** The instance records its own visitor traffic and shows it to the owner: how many people, how many sittings, what was opened, which crawlers came and which one. Nothing is sent anywhere else, no cookie is set, and no address is stored. An event is filed against a corpus entry's immutable identity, so renaming or moving that entry does not split its history.
- **Surface:** `/admin/monitor` — the window picker, the five counts and the event feed. The visitor surfaces being recorded: the index, the reader, the writings, a microsite, the chat and the crawler routes.
- **Real dep:** The prod stack, a corpus that mirrors the real vault, and traffic that was not made by the owner's own browser — a second machine or a browser profile that holds no owner session.
- **Exclusive:** none
- **Note:** What the beacon refuses to accept from a stranger is hardening with nothing to look at; `monitor-beacon` covers it and it is not a check here.
- **Backing e2e:** `monitor-records-a-reader-view` · `monitor-panel` · `monitor-beacon` · `monitor-window` · `monitor-deep-tree` · `monitor-outreach` · `monitor-reader-interactions` · `monitor-chat-source-click` · `monitor-microsite-tracker` · `monitor-crawler-seo` · `monitor-index-visit`.

## Checks

### 1 — A real read lands on the panel, naming the entry ⭐
- **Steps:** From a browser holding no owner session, open a published corpus entry. Open the panel.
- **Expected:** A row appears naming that entry by its title, on the reader surface, with the visitor's browser and platform. The path shown is the one a visitor typed, not the API route behind it.
- **Backing test:** `monitor-records-a-reader-view.spec.ts` · `monitor-panel.spec.ts`

### 2 — The owner reading their own site changes nothing ⭐
- **Steps:** While signed in, read several of your own entries. Compare the counts before and after.
- **Expected:** Unchanged. An owner proof-reading does not invent an audience for themselves.
- **Mock gap:** The exclusion depends on which cookie reaches which path in the real deployment; a fixture that asks the app whether it is the owner would answer yes for the wrong reason.
- **Backing test:** `monitor-panel.spec.ts`

### 3 — Renaming or moving an entry keeps its history together
- **Steps:** Read a deeply nested entry. Move it to the root, so its whole address changes. Read it again at the new address. Filter the feed by that entry.
- **Expected:** Both reads are under one entry, with both addresses in its history. It does not appear as two entries, one of which stopped being read.
- **Backing test:** `monitor-deep-tree.spec.ts`

### 4 — The three windows count different spans, and both panels agree
- **Steps:** Switch between the three windows. For each, compare the five counts against the feed beside them.
- **Expected:** The counts change with the window, and the feed changes with them. Nothing older than the longest window is shown, because nothing older is kept.
- **Backing test:** `monitor-window.spec.ts`

### 5 — A crawler is counted apart and named
- **Steps:** Fetch a public entry with a crawler's user agent, and let a link to the instance be unfurled in a group chat.
- **Expected:** Both appear in the feed, each naming which crawler. Neither is added to the four human counts.
- **Backing test:** `monitor-crawler-seo.spec.ts` · `monitor-panel.spec.ts`

### 6 — What only the browser can see is reported, and only from a real control
- **Steps:** Read a long entry to the end, follow a link inside it, switch its language, and open a citation under a chat answer.
- **Expected:** Each shows on the panel as its own event, naming what was opened. Each threshold of reading depth appears once for that page however much the reader scrolls up and down.
- **Mock gap:** These come from the browser. A release build strips the attributes the page is instrumented on, so a build that passes in development can be silent in production — read the panel after driving a released build, not a development one.
- **Backing test:** `monitor-reader-interactions.spec.ts` · `monitor-chat-source-click.spec.ts`

### 7 — An embedded widget and an IM bot are told apart from the owner's own page
- **Steps:** Drive a chat turn from a widget on another origin, and one through the IM bridge. Read the feed.
- **Expected:** Three surfaces are distinguishable, and the embed row names the site the widget runs on. A person messaging through the bridge is counted as a person.
- **Backing test:** `monitor-outreach.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The five counts are five different claims — viewers, sittings, pages opened, everything recorded, crawlers. Read them together and say whether any pair could be the same number for a reason other than the traffic.

The counts and the feed under them are two views of one span: after changing the window, say whether the rows are from the span the numbers claim.

Every control on the panel must change what is shown: a window that reloads the same rows, and a feed row that names an entry you cannot then open, are both dead affordances on a screen whose whole job is to be read.
