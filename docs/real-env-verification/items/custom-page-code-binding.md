# microsite-code-binding — A page is a rendering of a code

- **Module:** A custom page that reads the owner's corpus and carries the owner's agent, authored from the panel, and reachable through an access code that opens it instead of the default visitor chat. The code is unchanged by this — same grant, same quotas, same transcript — only what the reader looks at differs.
- **Surface:** `/admin/microsites` (authoring, BYOK switch, which codes open a page), `/admin/codes` (which page a code opens), and the hosted page at `/p/<slug>`.
- **Real dep:** The prod stack, a real sandbox build, a real model for the page's agent, and real corpus — the owner's own vault mirror. Nothing here is provable against a stub: a page that renders a stubbed answer proves nothing about whether the agent is scoped by the code.
- **Backing e2e:** `microsite-admin-authoring` · `microsite-code-binding` · `microsite-is-the-codes-rendering` · `microsite` · `mcp-page-lifecycle`.

## Checks

### 1 — The panel authors a page end to end ⭐
- **Steps:** From `/admin/microsites`, paste source into the page, build it, watch the build reach a terminal state, promote it. Then open `/p/<slug>` as a visitor.
- **Expected:** Every step is available on the panel — creating, writing source, building, watching, promoting. The build runs a real toolchain. The visitor gets the page.
- **Mock gap:** Authoring used to be MCP-only behind an exception whose stated reason was that the panel had no such surface. CI now covers the routes; what CI cannot cover is whether the panel is *usable* — whether an owner can find where to paste code and can tell a running build from a finished one.
- **Backing test:** `microsite-admin-authoring.spec.ts`

### 2 — A build that fails says so, and changes nothing ⭐
- **Steps:** Publish a working page. Then paste source that cannot compile and build it. Read what the panel says. Open `/p/<slug>` again.
- **Expected:** The build reports failure with a message naming what broke, in terms the owner can act on. The live page is untouched.
- **Note:** This is the check that decides whether the panel is trustworthy. A build that fails quietly and leaves the old page up is, from the owner's chair, indistinguishable from a build that worked.
- **Backing test:** `microsite-admin-authoring.spec.ts`

### 3 — The page reads real corpus, scoped to whoever is looking ⭐
- **Steps:** Publish a page that lists the owner's pinned corpus and opens an entry. Open it **anonymously**. Then open it through a code whose role grants more. Compare what each sees. Then unpublish an entry the page shows and reload.
- **Expected:** Anonymous sees the public slice. The coded reader sees that code's slice — same build, same URL. Unpublishing removes the entry from the page on the next load.
- **Note:** the negative is the half that matters — a page cannot show what the viewer's role cannot read. Prove it with an entry that is private, and assert **on the page**, not on the API; the API being correct while the page caches or over-fetches is exactly the failure this check exists for.
- **Backing test:** anonymous half → `microsite-code-binding.spec.ts`; the private-entry negative → `microsite-is-the-codes-rendering.spec.ts`

### 4 — The page's agent is the code's agent ⭐
- **Steps:** Bind a code to the page. Enter the code at the front door the way a reader would — scan the QR, or open the shared link. Answer the who's-reading prompt. Ask something the corpus can answer. Then open `/admin/conversations`.
- **Expected:** Entering the code lands the reader **on that page**, not on the default chat — the reader never types a `/p/` URL. The identity prompt appears and the name reaches the transcript. The answer is grounded in the corpus and in the owner's voice. **The conversation appears under that code**, with the page's turns in it — an owner must not have to guess which surface a transcript came from.
- **Mock gap:** CI can assert a turn happens; it cannot assert the answer is the owner's voice, or that a real model used the real corpus.
- **Backing test:** `microsite-is-the-codes-rendering.spec.ts`

### 5 — Everything the code carries, carries
- **Steps:** On a code bound to a page, exercise the machinery: open a second reader against `max_members`, spend turns against `max_turns_per_session`, then revoke the code mid-session.
- **Expected:** Each behaves exactly as it does in chat with the same code — the member count fills and then refuses, the turn allowance runs out and the page says so, and a revoked code stops the page's agent.
- **Write it against chat as the oracle**, not against fresh expectations: the assertion is "the page does what the same code does in chat", so a change to code semantics moves both and cannot drift into a page-only branch.
- **Backing test:** `microsite-is-the-codes-rendering.spec.ts`

### 6 — The binding reads the same from both ends
- **Steps:** Bind a code to a page. Read `/admin/codes`. Read `/admin/microsites`. Then rebind the code to a second page and read both again.
- **Expected:** The code screen names the page it opens; the page screen names the codes that open it. Rebinding moves the code — the old page stops claiming it. A binding visible from only one side is one people forget they made.
- **Backing test:** `microsite-code-binding.spec.ts`

### 7 — What the owner withdraws stops being reachable
- **Steps:** With a page live, roll it back. Open `/p/<slug>`. Publish again, then delete it and open again. Check what the response tells the browser about caching.
- **Expected:** Each withdrawal takes effect on the next request. Nothing is snapshotted. The response does not advertise the page as cacheable — the only copy beyond reach must be one the reader's browser kept on its own, never one we told it to keep.
- **Backing test:** `microsite-admin-authoring.spec.ts`

### 8 — An arriving grant wins
- **Steps:** Turn on BYOK for a page. Bind a code that does not allow BYOK. Open the page through that code.
- **Expected:** BYOK is not offered. The page's own setting applies only when nobody presents a grant.
- **Note:** Assert on the page. Asserting the stored setting proves nothing — the defect being guarded against is the setting being *honoured* when it should be inert.
- **Backing test:** `microsite-is-the-codes-rendering.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The authoring surface says where to paste code and what happens next, rather than assuming the owner knows.
A build in flight is distinguishable from a build that finished — and from one that failed.
The BYOK switch says, where it lives, that a code overrides it. An owner who sets it and then binds a code will otherwise reasonably expect it to mean something.
Watch for a page that looks published but is not, and for a withdrawn page that still opens — both read as success from the owner's chair.
