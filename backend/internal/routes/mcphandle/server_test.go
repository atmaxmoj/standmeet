package mcphandle_test

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
)

// TestServerInstructions — the whole point of the connect instructions is that the owner's
// agent, on installing the client, immediately knows how to curate the corpus and to check its
// version. So the string must actually carry that load: the running version (interpolated, not
// a placeholder), the raw→wiki→output pipeline with corpus.promote, and the upgrade_check nudge.
// If any of those drops out, an agent connects blind — which is exactly the gap this closes.
func TestServerInstructions(t *testing.T) {
	t.Parallel()
	got := mcphandle.ServerInstructions("v9.9.9")

	for _, s := range []string{
		"v9.9.9",                // the real version reached the agent, not a hardcoded one
		"corpus.create",         // how to capture
		"corpus.promote",        // how to move along the pipeline
		"raw", "wiki", "output", // the genre model
		"instance.upgrade_check", // the version-sniff nudge the owner asked for
		"microsite.guide",        // authoring a good custom page starts by reading the guide
	} {
		if !strings.Contains(got, s) {
			t.Fatalf("connect instructions must mention %q, but did not; got:\n%s", s, got)
		}
	}
}
