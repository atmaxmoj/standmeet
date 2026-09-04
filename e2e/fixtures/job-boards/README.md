# Job board fixture snapshots

Snapshots captured from the real APIs on **2026-05-20**, covering several companies per source kind.

Each fixture file = `{source_kind}/{slug}.day{n}.{ext}`:
- `slug` = the key that identifies this board within the source (Greenhouse's company name, Ashby's board slug, WWR's category, etc.)
- `day{n}` = two snapshots of the same board at different points in time, for the dedup test (fetch_new should return only the ids in day2 that didn't appear in day1)
- `ext` = `json` / `rss`

## Inventory

| Source | Files | Notes |
|---|---|---|
| **greenhouse/** | 25 | airbnb, stripe, vercel, figma, anthropic, dropbox, instacart, pinterest, reddit, gusto, duolingo, elastic, gitlab, cloudflare, datadog, mongodb, mercury, chime, brex, lyft, robinhood, asana, affirm, fivetran, samsara (?) |
| **lever/** | 4 | leverdemo, highspot, jobvite, palantir |
| **ashby/** | 4 | Ashby, Linear, Notion, posthog, supabase |
| **remoteok/** | 1 | api (aggregate feed) |
| **wwr/** | 10 | all 10 category RSS feeds |
| **hn/** | 10 | whoishiring (user) + item-47975571 (May 2026 thread) + 8 real postings |
| **smartrecruiters/** | 1 | visa (v1.1 source) |
| **workable/** | 6 | typeform, mux, marshmallow, intercom, mistralai, rechargehq (v1.1 source) |

Each fixture is trimmed to ≤ 8 jobs / 8 items, **keeping the original API response shape unchanged**. The full, untrimmed captures live in `.raw/` (gitignore'd).

## Day2 fixtures

The dedup test needs `*.day2.{json,rss}` —— the same board with **a few entries added + a few removed** to simulate a day-later change in state. Generate with:

```bash
make gen-day2-fixtures
```

Logic (per kind):
- Greenhouse / Ashby: `.day1.json`'s `jobs[0:8]` → `.day2.json` takes `jobs[2:10]` (the first 2 "disappear", 2 more are "added")
- Lever: `.day1.json` is an array, sliced directly [2:10]
- RemoteOK: keep array[0] legal notice + [3:11]
- WWR: keep everything after item-3 + add 2 fictional items (GUID changed, pubDate changed)
- HN: `whoishiring.day2.json.submitted[0]` points at a "new month" fake item ID; fake item-{id}.day2.json contains 5 new comment IDs

day2 is **synthetic**, derived from day1, without hitting the real API again. This avoids the real API drifting over time and messing up the expected day1 → day2 diff.

## Recapture / refresh

Run once a quarter (or whenever a field schema is suspected of drifting):

```bash
make capture-job-fixtures   # recapture raw → .raw/
make trim-job-fixtures      # trim raw to 8 entries → current path
```

`make capture-job-fixtures` is a wrapper around `e2e/fixtures/job-boards/capture.sh`, with the per-kind lists written in the script.

The User-Agent is always `StandMeet-fixture-capture/0.1 (+https://github.com/atmaxmoj/standmeet)` —— for polite identification to the real APIs.

## Which boards can't be captured (explicit boundary)

- **SmartRecruiters** returns empty for most public companies (the API accepts the slug but totalFound=0); only visa has public listings. SR is in v1.1, and the cohort is enough for now.
- **Workable** uses the `widget/accounts/{sub}` endpoint, which returns **account metadata** (name + description), **not jobs**. Getting a real jobs list needs a different endpoint —— to be confirmed when implementing the Workable adapter.
- **Wellfound / LinkedIn / Indeed** —— not captured; the server shouldn't run these (see docs/design/job-loop.md's explicit "don't do").

## Day1 → Day2 state expectations (for spec assertions)

| Board | day1 ids | day2 ids | diff (day2 - day1) |
|---|---|---|---|
| greenhouse/airbnb | [a,b,c,d,e,f,g,h] | [c,d,e,f,g,h,i,j] | {i, j} |
| ashby/Notion | [a,b,c,d,e,f,g,h] | [c,d,e,f,g,h,i,j] | {i, j} |
| ... | ... | ... | ... |

(When the gen-day2 script runs, it writes each board's specific "first 2 removed + last 2 added" IDs to a manifest, and e2e imports that manifest directly as assertion data rather than hardcoding it in the spec.)
