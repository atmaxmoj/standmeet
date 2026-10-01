package subscriber_test

// Which rules an event wakes: the type glob, then the filter (none, the subject, or a declared data
// key). A rule for another code, another subject or another type stays asleep.

import (
	"encoding/json"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
)

const started = "conversation.started"

func TestMatchingRules(t *testing.T) {
	t.Parallel()
	ev := events.Event{
		Type: started, Subject: "conversation/c1",
		Data: json.RawMessage(`{"conversation_id":"c1","code_id":"code-A"}`),
	}
	rules := []entity.NotifyRule{
		{ID: "any", EventType: started},
		{ID: "glob", EventType: "conversation.*"},
		{ID: "codeA", EventType: started, FilterKey: "code_id", FilterValue: "code-A"},
		{ID: "codeB", EventType: started, FilterKey: "code_id", FilterValue: "code-B"},
		{ID: "subj", EventType: started, FilterKey: "subject", FilterValue: "conversation/c1"},
		{ID: "subjX", EventType: started, FilterKey: "subject", FilterValue: "conversation/c2"},
		{ID: "other", EventType: "booking.created"},
	}
	hits := subscriber.MatchingRules(rules, &ev)
	got := make([]string, 0, len(hits))
	for _, r := range hits {
		got = append(got, r.ID)
	}
	want := []string{"any", "glob", "codeA", "subj"}
	if len(got) != len(want) {
		t.Fatalf("matched %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("matched %v, want %v", got, want)
		}
	}
}
