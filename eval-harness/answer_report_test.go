// answer_report_test.go —— no model, no key. Reads the results file the answer evals write
// (EVAL_RESULTS, default results/answers.jsonl) and prints four tables an insurer would ask for:
//
//	rate          misses per kind of question, per model, with a 95% interval; and the rate for a
//	              mix of questions other than the test set's (results/mix.json, if present)
//	credibility   each kind's small-sample rate blended with the model's rate over all kinds
//	actual/expected   the misses a long conversation had, against what the same questions asked
//	              alone predicted
//	found late    failures the instant rule passed and the second look caught
//
// Run: make eval-answer-report

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
)

func TestAnswerReport(t *testing.T) {
	path := envOrDefault("EVAL_RESULTS", "results/answers.jsonl")
	rows, err := readRows(path)
	if err != nil {
		t.Skipf("no results to report on (%v); run make eval-answer-coverage first", err)
	}
	byModel := map[string][]evalRow{}
	for _, r := range rows {
		byModel[r.Model] = append(byModel[r.Model], r)
	}
	models := sortedKeys(byModel)
	mix := readMix("results/mix.json")
	for _, m := range models {
		rs := byModel[m]
		t.Logf("\n===== %s (%d rows) =====\n%s\n%s\n%s\n%s", m, len(rs),
			rateTable(rs, mix), credibilityTable(rs), actualExpectedTable(rs), foundLateTable(rs))
	}
}

func readRows(path string) ([]evalRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	var out []evalRow
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		var r evalRow
		if json.Unmarshal(sc.Bytes(), &r) == nil && r.Test != "" {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s holds no rows", path)
	}
	return out, sc.Err()
}

// readMix —— how often each kind of question is asked in real use, as weights. Absent = none.
func readMix(path string) map[string]float64 {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var m map[string]float64
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}

// tally —— misses and trials.
type tally struct{ miss, n int }

func (c tally) rate() float64 {
	if c.n == 0 {
		return 0
	}
	return float64(c.miss) / float64(c.n)
}

func coverageByKind(rs []evalRow) map[string]tally {
	out := map[string]tally{}
	for _, r := range rs {
		if r.Test != "answer-coverage" {
			continue
		}
		c := out[r.Kind]
		c.n++
		if !r.Pass {
			c.miss++
		}
		out[r.Kind] = c
	}
	return out
}

// rateTable —— the miss rate per kind, and the rate under a mix of kinds other than the test set's.
func rateTable(rs []evalRow, mix map[string]float64) string {
	byKind := coverageByKind(rs)
	if len(byKind) == 0 {
		return "rate: no coverage rows"
	}
	out := "RATE  misses per answer, one fresh conversation each\n"
	var all tally
	for _, k := range sortedKeys(byKind) {
		c := byKind[k]
		lo, hi := wilson(c.miss, c.n)
		out += fmt.Sprintf("  %-11s %2d/%-3d  %5.1f%%  95%% interval %.0f%%–%.0f%%\n", k, c.miss, c.n, c.rate()*100, lo*100, hi*100)
		all.miss, all.n = all.miss+c.miss, all.n+c.n
	}
	out += fmt.Sprintf("  as tested (the test set's own mix): %.1f%%\n", all.rate()*100)
	if mix == nil {
		return out + "  under the real mix: no results/mix.json yet (kind → share of real questions)\n"
	}
	sum, weighted := 0.0, 0.0
	for k, w := range mix {
		if c, ok := byKind[k]; ok {
			sum, weighted = sum+w, weighted+w*c.rate()
		}
	}
	if sum > 0 {
		out += fmt.Sprintf("  under the real mix (results/mix.json): %.1f%%\n", weighted/sum*100)
	}
	return out
}

// credibilityTable —— Bühlmann: each kind's own rate, pulled toward the model's rate over all
// kinds by Z = n/(n+k), k = (variance within a kind) / (variance between kinds), both estimated
// from these rows. Few rounds per kind means a small Z: the kind's own number is mostly noise.
func credibilityTable(rs []evalRow) string {
	byKind := coverageByKind(rs)
	if len(byKind) < 2 {
		return "credibility: needs two or more kinds"
	}
	var all tally
	within, nBar := 0.0, 0.0
	for _, c := range byKind {
		all.miss, all.n = all.miss+c.miss, all.n+c.n
		p := c.rate()
		within += p * (1 - p)
		nBar += float64(c.n)
	}
	kinds := float64(len(byKind))
	within, nBar = within/kinds, nBar/kinds
	mean, between := all.rate(), 0.0
	for _, c := range byKind {
		between += (c.rate() - mean) * (c.rate() - mean)
	}
	between = between/(kinds-1) - within/nBar // the part of the spread that sampling noise does not explain
	out := fmt.Sprintf("CREDIBILITY  class = this model over all kinds, miss rate %.1f%%\n", mean*100)
	if between <= 0 {
		return out + "  the kinds differ no more than chance would make them: Z = 0, use the class rate for every kind\n"
	}
	k := within / between
	out += fmt.Sprintf("  k = %.1f rounds (the sample size at which a kind's own rate gets half the weight)\n", k)
	for _, name := range sortedKeys(byKind) {
		c := byKind[name]
		z := float64(c.n) / (float64(c.n) + k)
		out += fmt.Sprintf("  %-11s own %5.1f%%  Z %.2f  blended %5.1f%%\n", name, c.rate()*100, z, (z*c.rate()+(1-z)*mean)*100)
	}
	return out
}

// actualExpectedTable —— a question asked alone predicts its miss rate; the same question inside
// a long conversation is the actual. Where a question never missed alone, the prediction is zero
// and the honest comparison is against the most it could be (the interval's upper end).
func actualExpectedTable(rs []evalRow) string {
	alone, long := map[string]tally{}, map[string]tally{}
	for _, r := range rs {
		switch r.Test {
		case "answer-coverage":
			c := alone[r.Case]
			c.n++
			if !r.Pass {
				c.miss++
			}
			alone[r.Case] = c
		case "answer-survival":
			c := long[r.Case]
			c.n++
			if !r.Pass {
				c.miss++
			}
			long[r.Case] = c
		}
	}
	out := "ACTUAL / EXPECTED  the same question: asked alone (expected) and inside a 12-turn conversation (actual)\n"
	var act, exp, expHi float64
	shown := 0
	for _, name := range sortedKeys(long) {
		a, ok := alone[name]
		if !ok || a.n == 0 {
			continue
		}
		l := long[name]
		_, hi := wilson(a.miss, a.n)
		e, eHi := a.rate()*float64(l.n), hi*float64(l.n)
		out += fmt.Sprintf("  %-18s actual %d/%-2d  expected %.1f (at most %.1f)\n", name, l.miss, l.n, e, eHi)
		act, exp, expHi, shown = act+float64(l.miss), exp+e, expHi+eHi, shown+1
	}
	if shown == 0 {
		return out + "  needs coverage and survival rows for the same questions\n"
	}
	ratio := "undefined (expected 0)"
	if exp > 0 {
		ratio = fmt.Sprintf("%.2f", act/exp)
	}
	return out + fmt.Sprintf("  all: actual %.0f, expected %.1f (at most %.1f)  A/E %s\n", act, exp, expHi, ratio)
}

// foundLateTable —— of the answers the instant rule passed, how many the second look failed. The
// ratio of all failures to those the rule saw is the development factor: what to multiply an
// instant count by to get the count a review will end up with.
func foundLateTable(rs []evalRow) string {
	ruleMiss, audited, late := 0, 0, 0
	for _, r := range rs {
		if r.Test != "answer-coverage" || r.Kind == "silent" || r.Kind == "scoped" {
			continue
		}
		if !r.Pass {
			ruleMiss++
		}
		if r.Audit != "" {
			audited++
			if r.Audit != "clean" {
				late++
			}
		}
	}
	out := "FOUND LATE  answerable questions: the instant rule, then a second look at every answer it passed\n"
	if audited == 0 {
		return out + "  no audited rows yet\n"
	}
	lo, hi := wilson(late, audited)
	out += fmt.Sprintf("  the rule failed %d; of %d it passed, the second look failed %d (%.0f%%, 95%% interval %.0f%%–%.0f%%)\n",
		ruleMiss, audited, late, float64(late)/float64(audited)*100, lo*100, hi*100)
	if ruleMiss > 0 {
		out += fmt.Sprintf("  development factor %.2f: the instant count times this is the count after review\n",
			float64(ruleMiss+late)/float64(ruleMiss))
	} else if late > 0 {
		out += "  development factor undefined: the instant count was zero and the review found some\n"
	}
	return out
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
