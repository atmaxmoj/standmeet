package entity_test

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
)

// streamCase —— one tool result and what of it may / may not reach the visitor's stream.
type streamCase struct {
	name, tool, result string
	want, absent       []string
}

var streamCases = []streamCase{
	{
		name: "citable wiki read keeps its citation", tool: "corpus_read",
		result: `{"genre":"wiki","id":"1","path":"a","title":"A","body":"OPEN",` +
			`"show_as_source":true,"extra":"X"}`,
		want: []string{`"OPEN"`, `"path":"a"`}, absent: []string{"extra", "show_as_source"},
	},
	{
		name: "non-citable wiki read sends nothing", tool: "corpus_read",
		result: `{"genre":"wiki","id":"1","body":"HIDDEN","show_as_source":false}`,
		absent: []string{"HIDDEN"},
	},
	{
		name: "subjectivity read sends nothing", tool: "corpus_read",
		result: `{"genre":"subjectivity","id":"1","body":"SELF"}`, absent: []string{"SELF"},
	},
	{
		name: "writing read is citable", tool: "corpus_read",
		result: `{"genre":"writing","id":"1","slug":"s","body":"POST"}`, want: []string{"POST"},
	},
	{
		name: "search snippets send nothing", tool: "corpus_search",
		result: `[{"snippet":"SNIP"}]`, absent: []string{"SNIP"},
	},
	{
		name: "unparseable read sends nothing", tool: "corpus_read",
		result: `not json SECRET`, absent: []string{"SECRET"},
	},
	{
		name: "other tools pass through", tool: "calendar_book",
		result: `{"ok":true,"when":"W"}`, want: []string{`"when":"W"`},
	},
}

// TestVisitorToolResult — what of a tool result reaches the visitor's live stream (F-A-28).
func TestVisitorToolResult(t *testing.T) {
	t.Parallel()
	for _, c := range streamCases {
		checkStream(t, &c, entity.VisitorToolResult(c.tool, c.result))
	}
}

func checkStream(t *testing.T, c *streamCase, got string) {
	t.Helper()
	for _, w := range c.want {
		if !strings.Contains(got, w) {
			t.Errorf("%s: want %q in %q", c.name, w, got)
		}
	}
	for _, a := range c.absent {
		if strings.Contains(got, a) {
			t.Errorf("%s: %q must not be in %q", c.name, a, got)
		}
	}
}
