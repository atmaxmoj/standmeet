// day2.go —— per-kind day2 derivation helpers.
//
// "Day 2" of a fixture = drop first `dropFromFront` entries + append two
// synthetic ones with stable ids `mockday2-1` / `mockday2-2`. Tests assert
// on these synthetic ids to verify dedup.

package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

// hnSyntheticThreadID / hnSyntheticKidIDA / hnSyntheticKidIDB are the
// stable ids tests assert on for HN day2. Item endpoints serve canned
// bodies for these ids via hnItemDay2.
const (
	hnSyntheticThreadID int64 = 99001
	hnSyntheticKidIDA   int64 = 99101
	hnSyntheticKidIDB   int64 = 99102
)

// Greenhouse uses int64 ids upstream; synthetic ids must be numeric so
// json.Unmarshal into greenhouseJob.ID (int64) succeeds. The mock returns
// them in the response; the fetcher converts to string via strconv at
// toDomain time — so tests assert on the string forms below.
const (
	syntheticGreenhouseIDA int64 = 999000001
	syntheticGreenhouseIDB int64 = 999000002
	// syntheticGreenhouseIDUntitled —— a row with an EMPTY title. Real boards
	// serve malformed rows; a stand-in that only ever returns well-formed jobs
	// is politer than reality, and every defect behind that politeness stays
	// invisible. `recruiterBriefing` returns "" when the snapshot title is
	// empty, so the auto-issued code ships with no prompt at all — this row is
	// what lets a guard see that.
	syntheticGreenhouseIDUntitled int64 = 999000003
)

// greenhouseDay2 — drop first 2 jobs in {"jobs":[...]}, append 2 synthetic.
func greenhouseDay2(raw []byte) []byte {
	var env greenhouseEnv
	if err := json.Unmarshal(raw, &env); err != nil {
		return raw
	}
	env.Jobs = dropAppendJSON(env.Jobs, []json.RawMessage{
		greenhouseSyntheticJob(syntheticGreenhouseIDA),
		greenhouseSyntheticJob(syntheticGreenhouseIDB),
		greenhouseUntitledJob(syntheticGreenhouseIDUntitled),
	})
	return mustMarshal(env)
}

// greenhouseUntitledJob — same shape, empty title. See the constant's comment.
func greenhouseUntitledJob(id int64) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"id": %d,
		"title": "",
		"company_name": "MockCo",
		"location": {"name": "Remote"},
		"first_published": "2026-05-21T00:00:00Z",
		"updated_at": "2026-05-21T00:00:00Z",
		"absolute_url": "https://example.com/jobs/%d",
		"content": "a row a real board served with no title",
		"departments": [{"name": "Engineering"}],
		"offices": [{"name": "Remote"}]
	}`, id, id))
}

func greenhouseSyntheticJob(id int64) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"id": %d,
		"title": "Synthetic Day2 %d",
		"company_name": "MockCo",
		"location": {"name": "Remote"},
		"first_published": "2026-05-21T00:00:00Z",
		"updated_at": "2026-05-21T00:00:00Z",
		"absolute_url": "https://example.com/jobs/%d",
		"content": "synthetic day2 body",
		"departments": [{"name": "Engineering"}],
		"offices": [{"name": "Remote"}]
	}`, id, id, id))
}

// leverDay2 — Lever raw array. Drop first 2, append 2 synthetic.
func leverDay2(raw []byte) []byte {
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return raw
	}
	arr = dropAppendJSON(arr, []json.RawMessage{
		leverSyntheticJob(syntheticDay2A),
		leverSyntheticJob(syntheticDay2B),
	})
	return mustMarshal(arr)
}

func leverSyntheticJob(id string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"id": "%s",
		"text": "Synthetic Day2 %s",
		"categories": {"location": "Remote", "team": "Eng", "department": "Engineering"},
		"createdAt": 1779667200000,
		"hostedUrl": "https://jobs.lever.co/mock/%s",
		"applyUrl": "https://jobs.lever.co/mock/%s/apply",
		"description": "synthetic day2 body",
		"tags": []
	}`, id, id, id, id))
}

// ashbyDay2 — Ashby {"jobs":[...]} same shape as Greenhouse.
func ashbyDay2(raw []byte) []byte {
	var env ashbyEnv
	if err := json.Unmarshal(raw, &env); err != nil {
		return raw
	}
	env.Jobs = dropAppendJSON(env.Jobs, []json.RawMessage{
		ashbySyntheticJob(syntheticDay2A),
		ashbySyntheticJob(syntheticDay2B),
	})
	return mustMarshal(env)
}

func ashbySyntheticJob(id string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"id": "%s",
		"title": "Synthetic Day2 %s",
		"department": "Engineering",
		"team": "Platform",
		"location": "Remote",
		"isRemote": true,
		"employmentType": "FullTime",
		"publishedAt": "2026-05-21T00:00:00.000+00:00",
		"jobUrl": "https://jobs.ashbyhq.com/mock/%s",
		"applyUrl": "https://jobs.ashbyhq.com/mock/%s/application",
		"descriptionPlain": "synthetic day2 body"
	}`, id, id, id, id))
}

// remoteOKDay2 — RemoteOK array (index 0 is legal notice). Drop first 2
// *jobs* (index 1..), append 2 synthetic. Notice stays at index 0.
func remoteOKDay2(raw []byte) []byte {
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return raw
	}
	if len(arr) <= 1 {
		return raw
	}
	notice := arr[0]
	jobs := dropAppendJSON(arr[1:], []json.RawMessage{
		remoteOKSyntheticJob(syntheticDay2A),
		remoteOKSyntheticJob(syntheticDay2B),
	})
	combined := append([]json.RawMessage{notice}, jobs...)
	return mustMarshal(combined)
}

func remoteOKSyntheticJob(id string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"id": "%s",
		"slug": "synthetic-day2-%s",
		"position": "Synthetic Day2 %s",
		"company": "MockCo",
		"location": "Remote",
		"epoch": 1779667200,
		"date": "2026-05-21T00:00:00+00:00",
		"tags": ["go", "remote"],
		"apply_url": "https://remoteOK.com/remote-jobs/%s",
		"url": "https://remoteOK.com/remote-jobs/%s",
		"description": "synthetic day2 body"
	}`, id, id, id, id, id))
}

// hnUserDay2 — whoishiring.submitted: drop first N, prepend synthetic
// thread id (matches the synthetic item below).
func hnUserDay2(raw []byte) []byte {
	var env hnUserPayload
	if err := json.Unmarshal(raw, &env); err != nil {
		return raw
	}
	if len(env.Submitted) > dropFromFront {
		env.Submitted = env.Submitted[dropFromFront:]
	}
	env.Submitted = append([]int64{hnSyntheticThreadID}, env.Submitted...)
	return mustMarshal(env)
}

// hnUserPayload covers the fields we preserve in passthrough day2.
type hnUserPayload struct {
	About     string  `json:"about,omitempty"`
	ID        string  `json:"id,omitempty"`
	Submitted []int64 `json:"submitted"`
	Created   int64   `json:"created,omitempty"`
	Karma     int64   `json:"karma,omitempty"`
}

// hnItemDay2 — for real "Ask HN: Who is hiring" thread items, drop first 2
// kids and append the two synthetic comment ids. For everything else
// (comments + the synthetic thread itself) pass through unchanged.
//
// Note we intentionally don't serve canned bodies for the synthetic
// comment ids — the HN adapter has `if err != nil { continue }` after
// fetchItem, so a 404 on hnSyntheticKidID* just makes the fetcher skip
// those entries. Tests assert against day1 ids being gone, not against
// the synthetic ids being present.
func hnItemDay2(raw []byte) []byte {
	var item hnItemPayload
	if err := json.Unmarshal(raw, &item); err != nil {
		return raw
	}
	if strings.HasPrefix(item.Title, "Ask HN") && len(item.Kids) > dropFromFront {
		item.Kids = append(item.Kids[dropFromFront:], hnSyntheticKidIDA, hnSyntheticKidIDB)
	}
	return mustMarshal(item)
}

// hnItemPayload covers the minimal fields HN items use; everything else
// is dropped on round-trip (Title / Kids / By / Time are what the fetcher
// reads).
type hnItemPayload struct {
	Title   string  `json:"title,omitempty"`
	By      string  `json:"by,omitempty"`
	Text    string  `json:"text,omitempty"`
	Kids    []int64 `json:"kids,omitempty"`
	ID      int64   `json:"id"`
	Time    int64   `json:"time,omitempty"`
	Parent  int64   `json:"parent,omitempty"`
	Deleted bool    `json:"deleted,omitempty"`
	Dead    bool    `json:"dead,omitempty"`
}

// dropAppendJSON returns src[dropFromFront:] with the synthetic entries
// appended.
func dropAppendJSON(src, synthetic []json.RawMessage) []json.RawMessage {
	if len(src) > dropFromFront {
		src = src[dropFromFront:]
	}
	return append(src, synthetic...)
}

// wwrDay2 — RSS day2. Drop first 2 <item>...</item> blocks + append 2
// synthetic ones with predictable <guid>. Simple string surgery to avoid
// pulling a full RSS round-tripper.
func wwrDay2(raw []byte) []byte {
	text := string(raw)
	parts := strings.SplitAfter(text, "</item>")
	if len(parts) <= dropFromFront+1 {
		return raw
	}
	firstItemStart := strings.Index(parts[0], "<item>")
	if firstItemStart < 0 {
		return raw
	}
	preamble := parts[0][:firstItemStart]
	parts[0] = parts[0][firstItemStart:]
	kept := parts[dropFromFront : len(parts)-1]
	trailer := parts[len(parts)-1]
	var b strings.Builder
	writeStr(&b, preamble)
	for _, item := range kept {
		writeStr(&b, item)
	}
	writeStr(&b, wwrSyntheticItem(syntheticDay2A))
	writeStr(&b, wwrSyntheticItem(syntheticDay2B))
	writeStr(&b, trailer)
	return []byte(b.String())
}

// writeStr — strings.Builder.WriteString never returns a non-nil error per
// stdlib doc; this wrapper centralises the discard so revive's
// unhandled-error rule sees one site instead of N.
func writeStr(b *strings.Builder, s string) {
	if _, err := b.WriteString(s); err != nil {
		// unreachable per stdlib contract; defensive only
		panic(err)
	}
}

func wwrSyntheticItem(id string) string {
	return fmt.Sprintf(`<item>
<title>MockCo: Synthetic Day2 %s</title>
<region>Anywhere in the World</region>
<category>Back-End Programming</category>
<type>Full-Time</type>
<description>synthetic day2 body</description>
<pubDate>Wed, 21 May 2026 00:00:00 +0000</pubDate>
<guid>https://weworkremotely.com/remote-jobs/mock-%s</guid>
<link>https://weworkremotely.com/remote-jobs/mock-%s</link>
</item>
`, id, id, id)
}

// marshalable is the union of payload shapes day2 helpers re-emit. Keeping
// it as a small interface (vs `any`) satisfies "no any in business code"
// — each shape is explicitly listed.
type marshalable interface {
	hnUserPayload | hnItemPayload | []json.RawMessage | greenhouseEnv | ashbyEnv
}

// greenhouseEnv / ashbyEnv —— named so mustMarshalE's type constraint can
// list them. The struct literals in greenhouseDay2 / ashbyDay2 use these
// types.
type greenhouseEnv struct {
	Jobs []json.RawMessage `json:"jobs"`
}

type ashbyEnv struct {
	Jobs []json.RawMessage `json:"jobs"`
}

// mustMarshal: generic marshal helper across the day2 payload shapes.
// Marshal failure can't happen in practice (every input is just-unmarshalled
// JSON), so on the off chance of a bug we log + return "{}" so the HTTP
// server stays responsive and the test fails cleanly with empty body.
func mustMarshal[T marshalable](v T) []byte {
	out, err := json.Marshal(v)
	if err != nil {
		slog.Default().Error("day2 marshal", "err", err)
		return []byte("{}")
	}
	return out
}
