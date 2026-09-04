// default_sources.go — the aggregators a fresh instance starts with, so /admin/sources opens to a
// working set instead of an empty page (owner: "一打开躺着一堆").
//
// Aggregators ONLY — zero per-company config: the public remote-jobs feeds (their own adapters) +
// niche boards through the generic `rss` adapter (one adapter, many boards). Per-company ATS kinds
// (greenhouse / lever / ashby / …) are deliberately NOT seeded — each needs a company the owner
// must pick, so a blind default would fetch some example company's jobs, which is noise.
//
// Every rss feed_url below was verified to return a live RSS feed with items on 2026-09-04. When
// one dies, the source just shows "failed" on /admin/sources (F-E-18) — it doesn't break the panel.

package jobsuc

import jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"

// defaultSource — one seeded aggregator. config is JSON; "" means the kind needs none.
type defaultSource struct {
	kind   string
	label  string
	config string
}

// pub — a no-config public aggregator (its own adapter).
func pub(kind, label string) defaultSource {
	return defaultSource{kind: kind, label: label, config: ""}
}

// rss — a niche board through the generic rss adapter (one adapter, a feed_url each).
func rss(label, feedURL string) defaultSource {
	cfg := `{"feed_url":"` + feedURL + `"}`
	return defaultSource{kind: jobfetch.KindRSS, label: label, config: cfg}
}

var defaultSources = []defaultSource{
	pub(jobfetch.KindRemoteOK, "RemoteOK"),
	pub(jobfetch.KindHNHiring, "Hacker News · Who's Hiring"),
	pub(jobfetch.KindJobicy, "Jobicy"),
	pub(jobfetch.KindRemotive, "Remotive"),
	pub(jobfetch.KindHimalayas, "Himalayas"),
	pub(jobfetch.KindWorkingNomads, "Working Nomads"),
	{
		kind:  jobfetch.KindWWR,
		label: "We Work Remotely",
		config: `{"categories":["remote-programming-jobs","remote-devops-sysadmin-jobs",` +
			`"remote-product-jobs","all-other-remote-jobs"]}`,
	},
	rss("NoDesk", "https://nodesk.co/remote-jobs/index.xml"),
	rss("Laravel Jobs", "https://larajobs.com/feed"),
	rss("Python.org Jobs", "https://www.python.org/jobs/feed/rss/"),
	rss("Golang Projects", "https://www.golangprojects.com/rss.xml"),
	rss("EU Remote Jobs", "https://euremotejobs.com/feed/"),
	rss("DevIT Jobs", "https://devitjobs.com/rss"),
}
