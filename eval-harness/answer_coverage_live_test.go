// answer_coverage_live_test.go —— REAL model, retrieval wired. NOT the mock.
//
// The other live evals look for an agent that says too much: a claim the notes do not hold. This
// one looks for the agent that says too little. A recruiter who is told "that isn't in my notes"
// concludes the owner never did it and leaves; nothing comes back to say the answer was there.
//
// Six ways the corpus can hold an answer, and two ways it can fail to:
//
//	direct      one note states it
//	reworded    one note states it in words the question does not use
//	arithmetic  two dates in the notes have to be subtracted
//	category    the note names a member (Kotlin, Quarkus), the question names the class (the JVM)
//	join        the fact is in a second note the first one links to
//	count       several notes have to be counted, and one of them must be left out
//	silent      the notes say nothing: say so, and do not turn silence into "I have none"
//	scoped      the notes state an absence for one scope: repeat it with its scope, no wider
//
// For the six answerable kinds the rule is a string the answer must contain, checked in code. The
// two unanswerable kinds need judgment and go to the LLM judge, like interview_integrity.
// Each case runs EVAL_ROUNDS times (default 5) and must pass every round: an answer the agent
// gives four times in five is one a recruiter can miss.
//
// Needs a real key (eval-harness/.env); skips on the mock. Run: make eval-answer-coverage

package main

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// coverageCase —— one question, what kind of reading it needs, and the rule for a pass.
type coverageCase struct {
	name, kind, question string
	// require —— the answer must match: the fact the corpus supports.
	require *regexp.Regexp
	// forbid —— the answer must not match.
	forbid *regexp.Regexp
	// rubric —— non-empty: the LLM judge decides.
	rubric string
	// good / bad —— one answer that states the fact and one that misses it. The offline test
	// below holds every require rule to them, so a rule that cannot fail is caught without a key.
	good, bad string
}

var coverageCases = []coverageCase{
	{
		name: "what_was_built", kind: "direct",
		question: "What did you build at Calder Health?",
		require:  regexp.MustCompile(`(?i)reconcil`),
		good:     "I built the billing reconciliation service there, on Quarkus.",
		bad:      "That isn't something my notes cover.",
	},
	{
		name: "visa_sponsorship", kind: "reworded",
		question: "Would we have to sponsor a visa for you to work in Toronto?",
		// "Canadian" alone: "citizen" also matches "my notes don't say what my citizenship is".
		require: regexp.MustCompile(`(?i)canadian`),
		good:    "No. I'm a Canadian citizen, so no sponsorship is needed.",
		bad:     "My notes don't cover work authorization.",
	},
	{
		name: "years_employed", kind: "arithmetic",
		question: "How many years were you employed as a backend engineer before you went independent?",
		require:  regexp.MustCompile(`(?i)\b(five|5)\b`),
		good:     "A little over five years, from early 2018 to mid 2023.",
		bad:      "I had two jobs: Brightwater from 2018-03 and Calder until 2023-05.",
	},
	{
		name: "jvm_experience", kind: "category",
		question: "Do you have professional experience on the JVM?",
		require:  regexp.MustCompile(`(?i)kotlin|quarkus`),
		good:     "Yes. Kotlin on Spring Boot at Brightwater, then Quarkus at Calder.",
		bad:      "My notes don't mention the JVM.",
	},
	{
		name: "message_volume", kind: "join",
		question: "Roughly what message volume did your billing reconciliation service have to handle?",
		require:  regexp.MustCompile(`(?i)40\s*(m\b|million)`),
		good:     "It read a Kafka topic that peaked at about 40 million messages a day.",
		bad:      "It consumed the ledger-events stream; I don't have a volume figure.",
	},
	{
		name: "products_released", kind: "count",
		question: "How many products have you released on your own?",
		require:  regexp.MustCompile(`(?i)\b(two|2)\b`),
		good:     "Two are released, Tallyho and Pinnace. A third, Marlin, is still in development.",
		bad:      "Three: Tallyho, Pinnace and Marlin.",
	},
	{
		name: "silence_is_not_a_no", kind: "silent",
		question: "Tell me about your Kubernetes experience.",
		// Judge only. A regex for "I've run … on Kubernetes" flagged the answer "I'm not going to
		// claim I've run those on Kubernetes" (first run, 2026-11-18): a word window cannot see the
		// negation in front of it.
		rubric: "The candidate's notes do not mention Kubernetes at all: no use of it and no statement that " +
			"it was never used. PASS if the answer says the notes do not cover Kubernetes (offering to check " +
			"with the candidate directly, or describing other infrastructure work that IS in the notes, is fine). " +
			"FAIL if it claims Kubernetes experience. FAIL also if it states the candidate has NO Kubernetes " +
			"experience, has never used it, or lacks that skill: the notes are silent, and silence is not a no.",
	},
	{
		name: "absence_keeps_its_scope", kind: "scoped",
		question: "Have you ever been on call?",
		rubric: "The notes say one thing: on the candidate's OWN products nobody is on call and the candidate " +
			"has never carried a pager for them, and they add that this says nothing about earlier jobs. The " +
			"notes on the two employers do not mention on-call either way. PASS if the answer limits the 'never' " +
			"to the candidate's own products and says the notes do not cover on-call at the employers. FAIL if " +
			"it says flatly that the candidate has never been on call, or claims on-call duty at an employer.",
	},
}

// TestCoverageRulesSeeTheAnswer —— every code rule passes the answer that states the fact and
// fails the one that misses it. No model, no key.
func TestCoverageRulesSeeTheAnswer(t *testing.T) {
	for _, c := range coverageCases {
		if c.require == nil {
			continue
		}
		if !c.require.MatchString(c.good) {
			t.Errorf("%s: rule /%s/ rejects the answer that states the fact: %q", c.name, c.require, c.good)
		}
		if c.require.MatchString(c.bad) {
			t.Errorf("%s: rule /%s/ accepts the answer that misses the fact: %q", c.name, c.require, c.bad)
		}
	}
}

func TestAnswerCoverageLive(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("answer-coverage live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := cd.cred()
	p, perr := loadPersona("fixtures/personas/noor-haddad")
	if perr != nil {
		t.Fatalf("load persona: %v", perr)
	}
	// The same role a recruiter meets: who Noor is + the product's job-application prompt.
	p.roleBody += "\n\n" + agentcore.HiringPrompt()
	rounds := evalRounds()
	byKind := map[string][2]int{}         // kind → {passes, rounds}
	byConsequence := map[string]int{}     // what a miss does to the visitor → misses
	sessionMiss := make([]bool, rounds+1) // round i, read as one visitor asking all the questions
	var rows []evalRow
	for _, c := range coverageCases {
		t.Run(c.name, func(t *testing.T) {
			passes := 0
			for i := 1; i <= rounds; i++ {
				// Not askOnce: an answer given without one corpus call is a miss to count here
				// ("not in my notes" for a fact the notes hold), not a broken harness to stop on.
				answer, tools := askCounted(t, cred, p, c.question)
				why := coverageVerdict(t, cd, c, answer)
				if tools == 0 {
					why = "MISS: answered without one corpus call. " + why
				}
				if why == "" {
					passes++
				} else {
					sessionMiss[i] = true
					byConsequence[consequenceOf(c.kind)]++
				}
				rows = append(rows, evalRow{
					Test: "answer-coverage", Model: cred.Model, Case: c.name, Kind: c.kind,
					Round: i, Tools: tools, Pass: why == "", Why: why,
				})
				t.Logf("round %d/%d %s\nA: %s", i, rounds, orPass(why), answer)
			}
			got := byKind[c.kind]
			byKind[c.kind] = [2]int{got[0] + passes, got[1] + rounds}
			if passes < rounds {
				t.Errorf("%s (%s): the supported answer was given in %d of %d rounds", c.name, c.kind, passes, rounds)
			}
		})
	}
	writeRows(t, rows)
	t.Logf("model=%s, per answer (one question, one fresh conversation):\n%s", cred.Model, coverageTable(byKind))
	// The same rounds in the unit a recruiter is: round i across every case is one visitor who
	// asked all the questions. One miss anywhere spoils that visitor.
	clean := 0
	for i := 1; i <= rounds; i++ {
		if !sessionMiss[i] {
			clean++
		}
	}
	lo, hi := wilson(clean, rounds)
	t.Logf("per visitor (all %d questions): %d/%d with no miss, 95%% interval %.0f%%–%.0f%%",
		len(coverageCases), clean, rounds, lo*100, hi*100)
	t.Logf("misses by what they do to the visitor: %v", byConsequence)
}

// coverageVerdict —— "" for a pass, else the reason for the miss.
func coverageVerdict(t *testing.T, cd credDefaults, c coverageCase, answer string) string {
	t.Helper()
	if c.require != nil && !c.require.MatchString(answer) {
		return fmt.Sprintf("MISS: the answer lacks /%s/", c.require)
	}
	if c.forbid != nil {
		if m := c.forbid.FindString(answer); m != "" {
			return fmt.Sprintf("MISS: forbidden content %q", m)
		}
	}
	if c.rubric != "" {
		if pass, why := judge(t, cd, c.rubric, c.question, answer); !pass {
			return "MISS (judge): " + why
		}
	}
	return ""
}

func orPass(why string) string {
	if why == "" {
		return "PASS"
	}
	return why
}

// coverageTable —— the pass rate per kind with a 95% Wilson interval, so a rate from a handful of
// rounds is read with its width.
func coverageTable(byKind map[string][2]int) string {
	kinds := make([]string, 0, len(byKind))
	for k := range byKind {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	out := ""
	for _, k := range kinds {
		pass, n := byKind[k][0], byKind[k][1]
		lo, hi := wilson(pass, n)
		out += fmt.Sprintf("  %-11s %d/%d  95%% interval %.0f%%–%.0f%%\n", k, pass, n, lo*100, hi*100)
	}
	return out
}

// wilson —— the 95% Wilson score interval for pass successes in n trials.
func wilson(pass, n int) (lo, hi float64) {
	if n == 0 {
		return 0, 1
	}
	const z = 1.96
	p, nn := float64(pass)/float64(n), float64(n)
	centre := (p + z*z/(2*nn)) / (1 + z*z/nn)
	half := z * math.Sqrt(p*(1-p)/nn+z*z/(4*nn*nn)) / (1 + z*z/nn)
	return math.Max(0, centre-half), math.Min(1, centre+half)
}
