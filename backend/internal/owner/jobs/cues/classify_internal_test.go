// classify_internal_test.go —— the follow-up classifier's decision contract (follow-up 链 spec §1).
//
// The classifier outputs metadata only (never rewrites the question or the card). Its hard gate
// (§3): a generic / new question is NEVER misclassified as a follow-up — misreading a new question
// as a follow-up washes project notes into a generic answer (the dangerous direction), so when it
// cannot tell it fails closed to "not a follow-up". Explicit back-references take a rule fast-path
// (no model). The model path (ambiguous bare references) is injected; nil = deterministic only,
// which must still be safe (fail closed).

package cues

import "testing"

const (
	projLarkspur = "larkspur"
	turnT1       = "t1"
)

func chain(turns ...ChainTurn) []ChainTurn { return turns }

func proj(text string, named ...string) ChainTurn {
	return ChainTurn{ID: turnT1, Text: text, NamedProjects: named}
}

// --- fast path: explicit back-reference, no model needed ---

func TestClassifyExplicitBackReferenceIsFollowUp(t *testing.T) {
	t.Parallel()
	prior := chain(proj("Walk me through Larkspur's answering path", projLarkspur))
	got := classify(prior, "You just said the model call can fail — what then?", nil)
	if !got.FollowUp {
		t.Fatalf("explicit 'you just said' must be a follow-up; got %+v", got)
	}
	if got.AnchorTurnID != turnT1 {
		t.Fatalf("anchor should be the referenced turn t1; got %q", got.AnchorTurnID)
	}
	if !contains(got.InheritedProjects, projLarkspur) {
		t.Fatalf("a follow-up inherits the anchor chain's projects; got %v", got.InheritedProjects)
	}
}

// --- fast path: bare referential (no independent content) ---

func TestClassifyBareReferentialIsFollowUp(t *testing.T) {
	t.Parallel()
	prior := chain(proj("How does Larkspur stage a rollout?", projLarkspur))
	for _, q := range []string{"Why?", "那 70 秒呢？", "And then?", "为什么？"} {
		got := classify(prior, q, nil)
		if !got.FollowUp {
			t.Fatalf("bare referential %q must be a follow-up; got %+v", q, got)
		}
		if !contains(got.InheritedProjects, projLarkspur) {
			t.Fatalf("bare %q should inherit larkspur; got %v", q, got.InheritedProjects)
		}
	}
}

// --- the hard gate: a new / generic question is NEVER a follow-up ---

func TestClassifyGenericQuestionIsNotFollowUp(t *testing.T) {
	t.Parallel()
	prior := chain(proj("Walk me through Larkspur", projLarkspur))
	generic := []string{
		"How do you write a design doc that gets approved?",
		"In general, how should a team run a blameless postmortem?",
		"What's your approach to keeping stakeholders updated?",
	}
	for _, q := range generic {
		got := classify(prior, q, nil)
		if got.FollowUp {
			t.Fatalf("generic %q must NOT be a follow-up (hard gate); got %+v", q, got)
		}
		if len(got.InheritedProjects) != 0 {
			t.Fatalf("a non-follow-up inherits nothing; got %v for %q", got.InheritedProjects, q)
		}
	}
}

// --- named-but-new: names a project but doesn't refer back → new question, no inheritance ---

func TestClassifyNamedButNewIsNotFollowUp(t *testing.T) {
	t.Parallel()
	prior := chain(proj("Walk me through Larkspur", projLarkspur))
	got := classify(prior, "Tell me about YouTeacher — how does it work?", nil)
	if got.FollowUp {
		t.Fatalf("naming a new project without a back-reference is a new question; got %+v", got)
	}
	if contains(got.InheritedProjects, projLarkspur) {
		t.Fatalf("named-but-new must not inherit the chain; got %v", got.InheritedProjects)
	}
}

// --- pivot: refers back only to turn away → linked but no inheritance ---

func TestClassifyPivotLinksButDoesNotInherit(t *testing.T) {
	t.Parallel()
	prior := chain(proj("Walk me through Larkspur", projLarkspur))
	got := classify(prior, "What about your other products instead?", nil)
	if contains(got.InheritedProjects, projLarkspur) {
		t.Fatalf("a pivot must not inherit the anchor's project; got %v", got.InheritedProjects)
	}
}

// --- ambiguous: the injected model decides; nil fails closed ---

func TestClassifyAmbiguousUsesModelWhenProvided(t *testing.T) {
	t.Parallel()
	prior := chain(proj("Walk me through Larkspur", projLarkspur))
	q := "What tradeoffs matter when serving models at scale?"
	// No model → fail closed.
	if got := classify(prior, q, nil); got.FollowUp {
		t.Fatalf("ambiguous + no model must fail closed; got %+v", got)
	}
	// A model that says yes → follow-up via the model path, inheriting the chain.
	yes := func([]ChainTurn, string) (bool, string) { return true, "reads as referential" }
	got := classify(prior, q, yes)
	if !got.FollowUp || !contains(got.InheritedProjects, projLarkspur) {
		t.Fatalf("model-yes should be a follow-up inheriting larkspur; got %+v", got)
	}
	// A model that says no → not a follow-up.
	no := func([]ChainTurn, string) (bool, string) { return false, "independent" }
	if gotNo := classify(prior, q, no); gotNo.FollowUp {
		t.Fatalf("model-no must not be a follow-up; got %+v", gotNo)
	}
}

// --- empty chain: nothing to refer back to ---

func TestClassifyEmptyChainNeverFollowUp(t *testing.T) {
	t.Parallel()
	if got := classify(nil, "Why?", nil); got.FollowUp {
		t.Fatalf("no prior turns → nothing to follow up; got %+v", got)
	}
}
