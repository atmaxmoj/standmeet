// answer_actuarial_live_test.go —— REAL model, retrieval wired. NOT the mock.
//
// answer_coverage reports a pass rate per kind of question. These add what an insurer would ask
// of the same agent, each from a tool actuaries already use:
//
//	the unit       a rate needs a denominator: per answer, and per visitor (coverage prints both)
//	the cost       a miss is counted by what it does to the visitor, not only that it happened
//	the record     every round is a row in a results file, so two runs can be compared
//	survival       in ONE long conversation, at which turn the first miss comes
//	vulnerability  under a defect the product can really have, which kinds of question break
//
// Survival and vulnerability are measurements: they print a table and write rows. Survival also
// asserts, because a visitor who asks twelve answerable questions should get twelve answers.
//
// Needs a real key (eval-harness/.env); skips on the mock.
// Run: make eval-answer-survival · make eval-answer-vulnerability

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// evalRow —— one answer and its verdict. One line of the results file.
type evalRow struct {
	At     string `json:"at"`
	Test   string `json:"test"`
	Config string `json:"config"` // EVAL_CONFIG: what this run is of (baseline, a prompt variant)
	Model  string `json:"model"`
	Event  string `json:"event,omitempty"` // the injected defect, vulnerability runs only
	Case   string `json:"case"`
	Kind   string `json:"kind"`
	Round  int    `json:"round"`
	Turn   int    `json:"turn,omitempty"` // position in the conversation, survival runs only
	Tools  int    `json:"tools"`
	Pass   bool   `json:"pass"`
	Why    string `json:"why,omitempty"`
}

// writeRows —— append the run to the results file (EVAL_RESULTS, default results/answers.jsonl).
// The file is in the repo on purpose: a rate with no earlier rate beside it cannot show drift.
func writeRows(t *testing.T, rows []evalRow) {
	t.Helper()
	out := envOrDefault("EVAL_RESULTS", "results/answers.jsonl")
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		t.Fatalf("results dir: %v", err)
	}
	f, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open results: %v", err)
	}
	defer func() { _ = f.Close() }()
	at, config := time.Now().UTC().Format(time.RFC3339), envOrDefault("EVAL_CONFIG", "baseline")
	for _, r := range rows {
		r.At, r.Config = at, config
		line, _ := json.Marshal(r)
		if _, werr := f.Write(append(line, '\n')); werr != nil {
			t.Fatalf("write results: %v", werr)
		}
	}
}

// consequenceOf —— what a miss of this kind does to the visitor. Three classes, by what the
// visitor is left believing. No weights: what each class costs is the owner's to say.
func consequenceOf(kind string) string {
	switch kind {
	case "silent", "scoped":
		// The visitor is told something about the owner that no note says.
		return "told a falsehood"
	default:
		// The answer existed and the visitor leaves without it.
		return "left without the answer"
	}
}

// survivalTurns —— twelve questions the notes answer, asked one after another in one conversation.
var survivalTurns = []coverageCase{
	{name: "what_was_built", question: "What did you build at Calder Health?", require: regexp.MustCompile(`(?i)reconcil`)},
	{name: "visa_sponsorship", question: "Would we have to sponsor a visa for you to work in Toronto?", require: regexp.MustCompile(`(?i)canadian`)},
	{name: "years_employed", question: "How many years were you employed as a backend engineer before you went independent?", require: regexp.MustCompile(`(?i)\b(five|5)\b`)},
	{name: "jvm_experience", question: "Do you have professional experience on the JVM?", require: regexp.MustCompile(`(?i)kotlin|quarkus`)},
	{name: "message_volume", question: "Roughly what message volume did your billing reconciliation service have to handle?", require: regexp.MustCompile(`(?i)40\s*(m\b|million)`)},
	{name: "products_released", question: "How many products have you released on your own?", require: regexp.MustCompile(`(?i)\b(two|2)\b`)},
	{name: "dispatch_database", question: "Which database did the dispatch service keep its state in?", require: regexp.MustCompile(`(?i)postgres`)},
	{name: "planner_cadence", question: "How often did the dispatch planner run?", require: regexp.MustCompile(`(?i)\b(fifteen|15)\b`)},
	{name: "topic_partitions", question: "How many partitions did the ledger-events topic have?", require: regexp.MustCompile(`(?i)\b(twelve|12)\b`)},
	{name: "tallyho_shipped", question: "When did Tallyho ship?", require: regexp.MustCompile(`2023`)},
	{name: "pinnace_clubs", question: "How many clubs use Pinnace?", require: regexp.MustCompile(`(?i)\b(three|3)\b`)},
	{name: "birthplace", question: "Where were you born?", require: regexp.MustCompile(`(?i)halifax`)},
}

// TestAnswerSurvivalLive —— one conversation, twelve turns, EVAL_ROUNDS conversations. Each
// conversation starts the list at a different question, so a hard question does not always sit
// at the same turn. Prints, per turn, how many conversations were still without a miss.
func TestAnswerSurvivalLive(t *testing.T) {
	cred, p := noorOnAJobCode(t)
	sessions, n := evalRounds(), len(survivalTurns)
	firstMiss := make([]int, sessions) // 0 = no miss in this conversation
	var rows []evalRow
	for s := 0; s < sessions; s++ {
		var history []convTurn
		for turn := 1; turn <= n; turn++ {
			c := survivalTurns[(s+turn-1)%n]
			driver := &EvalDriver{cred: cred, roleBody: p.roleBody, corpus: p.corpus}
			answer, tools := askDriver(t, driver, history, c.question)
			pass := c.require.MatchString(answer)
			rows = append(rows, evalRow{
				Test: "answer-survival", Model: cred.Model, Case: c.name, Kind: "answerable",
				Round: s + 1, Turn: turn, Tools: tools, Pass: pass,
			})
			if !pass && firstMiss[s] == 0 {
				firstMiss[s] = turn
				t.Logf("conversation %d, turn %d (%s): MISS\nA: %s", s+1, turn, c.name, answer)
			}
			history = append(history,
				convTurn{Role: "interviewer", Text: c.question}, convTurn{Role: "candidate", Text: answer})
		}
	}
	writeRows(t, rows)
	t.Logf("model=%s, %d conversations of %d turns:\n%s", cred.Model, sessions, n, survivalTable(firstMiss, n))
	for s, turn := range firstMiss {
		if turn != 0 {
			t.Errorf("conversation %d: the first miss came at turn %d of %d", s+1, turn, n)
		}
	}
}

// survivalTable —— the Kaplan–Meier curve of "no miss yet". Every conversation runs all its
// turns, so none is censored and the estimate is the plain share still clean.
func survivalTable(firstMiss []int, turns int) string {
	out, surviving := "  turn  at risk  first misses  still clean\n", 1.0
	atRisk := len(firstMiss)
	for turn := 1; turn <= turns; turn++ {
		events := 0
		for _, m := range firstMiss {
			if m == turn {
				events++
			}
		}
		if atRisk > 0 {
			surviving *= 1 - float64(events)/float64(atRisk)
		}
		out += fmt.Sprintf("  %4d  %7d  %12d  %10.0f%%\n", turn, atRisk, events, surviving*100)
		atRisk -= events
	}
	return out
}

// defect —— one thing that can really go wrong under the agent, applied to a fresh driver.
type defect struct {
	name  string
	apply func(d *EvalDriver)
}

var defects = []defect{
	// The search backend is down for the whole turn.
	{name: "search outage", apply: func(d *EvalDriver) { d.FailSearchFirst = 1 << 30 }},
	// A sync dropped one note: the overview, which holds the dates, the citizenship and the links.
	{name: "overview note lost", apply: func(d *EvalDriver) {
		kept := d.corpus[:0:0]
		for _, e := range d.corpus {
			if !strings.Contains(strings.ToLower(e.Title), "overview") {
				kept = append(kept, e)
			}
		}
		d.corpus = kept
	}},
}

// TestAnswerVulnerabilityLive —— the eight coverage questions under each defect. The share of
// rounds that miss, per kind, is that kind's vulnerability to that defect: the number a
// catastrophe model multiplies by how many visitors are exposed when the defect ships.
func TestAnswerVulnerabilityLive(t *testing.T) {
	cred, p := noorOnAJobCode(t)
	cd := resolveCredDefaults()
	rounds := evalRounds()
	var rows []evalRow
	table := ""
	for _, ev := range defects {
		miss := map[string][2]int{} // kind → {misses, rounds}
		for _, c := range coverageCases {
			for i := 1; i <= rounds; i++ {
				driver := &EvalDriver{cred: cred, roleBody: p.roleBody, corpus: p.corpus}
				ev.apply(driver)
				answer, tools := askDriver(t, driver, nil, c.question)
				why := coverageVerdict(t, cd, c, answer)
				rows = append(rows, evalRow{
					Test: "answer-vulnerability", Model: cred.Model, Event: ev.name, Case: c.name,
					Kind: c.kind, Round: i, Tools: tools, Pass: why == "", Why: why,
				})
				got := miss[c.kind]
				if why != "" {
					got[0]++
					t.Logf("[%s] %s round %d: %s\nA: %s", ev.name, c.name, i, why, answer)
				}
				got[1]++
				miss[c.kind] = got
			}
		}
		table += "  " + ev.name + "\n" + vulnerabilityLines(miss)
	}
	writeRows(t, rows)
	t.Logf("model=%s, share of rounds that miss under each defect:\n%s", cred.Model, table)
}

func vulnerabilityLines(miss map[string][2]int) string {
	kinds := make([]string, 0, len(miss))
	for k := range miss {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	out := ""
	for _, k := range kinds {
		m, n := miss[k][0], miss[k][1]
		lo, hi := wilson(m, n)
		out += fmt.Sprintf("    %-11s %d/%d miss  95%% interval %.0f%%–%.0f%%\n", k, m, n, lo*100, hi*100)
	}
	return out
}

// noorOnAJobCode —— the persona the coverage evals share, under the product's job-application
// prompt. Skips without a real key.
func noorOnAJobCode(t *testing.T) (agentcore.Cred, *persona) {
	t.Helper()
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("this live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	p, perr := loadPersona("fixtures/personas/noor-haddad")
	if perr != nil {
		t.Fatalf("load persona: %v", perr)
	}
	p.roleBody += "\n\n" + agentcore.HiringPrompt()
	return cd.cred(), p
}
