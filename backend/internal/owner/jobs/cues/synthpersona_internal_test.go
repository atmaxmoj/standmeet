// synthpersona_test.go —— a SYNTHETIC persona's corpus, for every cue-card test and the PII-free
// cue eval. It carries NO owner personal data: "Alex Rivera" and the projects/companies below are
// invented. Owner's standing rule (2026-10-22): "eval 不要写我的个人信息" — the cue tests and eval
// run against this fixture, never the owner's real vault or the live instance.
//
// The notes are shaped to reproduce the real 2026-10-22 mock-interview defects, so a fix can be
// proven RED here before it is written (the cue-defect-loop spec's "先复现再修" rule):
//
//   - FRAME GRAVITY (cue-defect-loop §0, F1/F4): methodologyNote is dense in the generic words a
//     deployment question shares ("stages / gates / reliable / shipped / production"), so BM25 and
//     the few-shot sample both pull a "ML prototype → production API" question toward a testing
//     methodology instead of the engineering answer. engineeringNote is the material the question
//     actually asks for.
//   - GAP + BRIDGE (cue-gap-discipline G1/G2): there is NO note about larkspur's model-serving
//     latencyBudget; detectionNote shares only the generic word "detection" with an unrelated
//     question, the lure for a cross-experience bridge.
//   - LAYER / RÉSUMÉ (cue-resume-binding, cue-layered-grounding H1/H2): cvNote (the generic CV) and
//     a tailored résumé/JD carry background and the salary band that a flat note search misses.
//   - SALIENCE (cue-gap-discipline G3): tidelineNote is low-salience background that should
//     not lead an unrelated question.

package cues

// synthNotes —— the synthetic persona's corpus, in corpus order. Paths mirror the real vault's
// shape (software/project/<slug>, a methodology theme, subjectivity://cv) so scope/ordering logic
// is exercised exactly as in production, with invented content.
func synthNotes() []Note {
	return []Note{
		larkspurNote,
		tidelineNote,
		engineeringNote,
		methodologyNote,
		detectionNote,
		cvNote,
	}
}

// larkspurNote —— a project root (software/project/*): the owner-equivalent's main project, an ML
// inference platform. Project roots seed the "Your projects" overview and the Example section.
var larkspurNote = Note{
	Title: "Larkspur",
	Path:  "software/project/larkspur",
	Tags:  []string{"original", "software", "project"},
	Body: "Larkspur is a self-serve platform that turns a researcher's rough model " +
		"prototype into a production inference API. An owner uploads a notebook model; " +
		"Larkspur wraps it behind a versioned HTTP endpoint with request batching, a " +
		"p99 latency budget, a cost ceiling per tenant, and a staged rollout (shadow, " +
		"canary, full). Built in Go with a Postgres control plane and a Redis request queue.",
}

// tidelineNote —— a second project, low-salience background. It should not lead a question that is
// not about data pipelines (cue-gap-discipline G3 salience).
var tidelineNote = Note{
	Title: "Tideline",
	Path:  "software/project/tideline",
	Tags:  []string{"original", "software", "project"},
	Body: "Tideline is a nightly batch pipeline that ingests clickstream events, " +
		"deduplicates them across sources, and lands a tidy table for analysts. Written " +
		"in Python with Airflow.",
}

// engineeringNote —— the material a "ML prototype → production API" question actually asks for:
// interface contract, latency/cost budget, hardening, gradual rollout. This is what SHOULD lead.
var engineeringNote = Note{
	Title: "Shipping a model prototype as a production API",
	Path:  "software/engineering/model-to-production",
	Tags:  []string{"original", "software"},
	Body: "Taking a researcher's model to production is an engineering-judgment problem, " +
		"not a testing-methodology one. Pin the interface contract first (request/response " +
		"schema, versioning) so callers do not break. Set an explicit p99 latency budget and " +
		"a per-tenant cost ceiling, then choose batching and hardware to meet them. Harden the " +
		"edges: input validation, timeouts, a circuit breaker, graceful degradation when the " +
		"model is slow. Roll out gradually — shadow traffic, then a small canary, then full — " +
		"so a regression is caught on a fraction of real traffic.",
}

// methodologyNote —— the owner-equivalent's AI-pipeline *testing methodology*. It is legitimate
// material for a testing question, but it is dense in the generic words a deployment question
// shares ("stages, gates, reliable, shipped, production"), which is exactly the frame-gravity lure
// of cue-defect-loop §0. It must NOT lead a deployment-engineering question.
var methodologyNote = Note{
	Title: "Stages and gates: testing an AI pipeline",
	Path:  "methodology/testing/stages-and-gates",
	Tags:  []string{"original", "methodology"},
	Body: "A reliable AI pipeline is split into stages; a machine-checked gate between stages " +
		"defines what \"done\" means so a shipped artifact is trustworthy. Gates sit where a " +
		"check is mechanical — tests, lint, a schema. A fresh-context audit reads the shipped " +
		"bytes themselves. A golden set of past passing cases is re-run on every change so a " +
		"regression is caught before it reaches production. Stages, gates, regression, reliable, " +
		"shipped — the discipline that makes AI output production-ready.",
}

// detectionNote —— an unrelated past experience that shares ONLY the generic word "detection" with
// a question about model-serving. It is the lure for a cross-experience bridge (cue-gap-discipline
// G2): a card must not pull this in for a serving question just because the word matches.
var detectionNote = Note{
	Title: "Fraud detection rules at Harborpay",
	Path:  "software/project/harborpay",
	Tags:  []string{"original", "software", "project"},
	Body: "At Harborpay I wrote the fraud detection rule engine: velocity checks, device " +
		"fingerprinting, and a manual-review queue. Pure business logic, no ML serving.",
}

// cvNote —— the generic CV at subjectivity://cv (the one note the hiring role's scope admits).
// Background / why-this-role questions should draw on it first (cue-resume-binding R2), but a flat
// BM25 search over a short CV often will not surface it.
var cvNote = Note{
	Title: "CV",
	Path:  "cv", // stored under subjectivity://; the scope glob is subjectivity://cv
	Genre: "subjectivity",
	Tags:  []string{"original", "subjectivity"},
	Body: "Alex Rivera — platform engineer, 6 years. Built Larkspur (ML inference platform) " +
		"and Tideline (data pipeline). Earlier: fraud detection at Harborpay. Strengths: Go, " +
		"Postgres, production ML systems, latency and cost budgeting. Looking for a senior " +
		"platform role shipping ML to production.",
}

// synthJDBand —— the JD's posted salary band, the fact a salary-expectation question should use
// (cue-layered-grounding H2) instead of answering "Not in your notes".
const synthJDBand = "Compensation: $180,000–$220,000 base, plus equity. Level: Senior (L5)."
