package inference

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

const toolRead = "corpus_read"

// nopSink —— AgentSink stub; the accumSink tees to it, the test ignores everything.
type nopSink struct{}

func (nopSink) Text(string)                                         {}
func (nopSink) ToolStarted(string, string, string, json.RawMessage) {}
func (nopSink) ToolCompleted(string, string)                        {}
func (nopSink) Epilogue(*EpilogueFrame)                             {}
func (nopSink) Retrying(int)                                        {}
func (nopSink) Error(error)                                         {}
func (nopSink) Done(string)                                         {}

// readResult —— a corpus_read result fixture. show_as_source:true because wiki/output are only
// cited when they're a declared source (the suppressedFromCitation read gate); this test is about
// genre ROUTING, so the entries are sources.
func readResult(id, genre string) string {
	return fmt.Sprintf(`{"id":%q,"genre":%q,"show_as_source":true}`, id, genre)
}

// TestCollectCitation_RoutesByGenre —— a corpus_read'd entry routes to the channel for its genre:
// wiki→wiki, output→output, subjectivity→its OWN channel (not the old wiki catch-all), writing/raw
// dropped. Core of the private-subjectivity tier: subjectivity leaves on its own id list so the
// dialog layer can gate it separately.
func TestCollectCitation_RoutesByGenre(t *testing.T) {
	t.Parallel()
	s := newAccumSink(nopSink{})
	s.collectCitation(toolRead, readResult("W1", "wiki"))
	s.collectCitation(toolRead, readResult("O1", "output"))
	s.collectCitation(toolRead, readResult("S1", "subjectivity"))
	s.collectCitation(toolRead, readResult("WR1", "writing"))
	s.collectCitation(toolRead, readResult("R1", "raw"))
	s.collectCitation(toolRead, readResult("S1", "subjectivity")) // dup → deduped

	r := s.result("q")
	require.Equal(t, []string{"W1"}, r.CitedWikiIDs)
	require.Equal(t, []string{"O1"}, r.CitedOutputIDs)
	require.Equal(t, []string{"S1"}, r.CitedSubjectivityIDs,
		"subjectivity routes to its own channel, deduped")
}

// TestCollectCitation_OnlyCorpusRead —— citations come from corpus_read only (search doesn't cite).
func TestCollectCitation_OnlyCorpusRead(t *testing.T) {
	t.Parallel()
	s := newAccumSink(nopSink{})
	s.collectCitation("corpus_search", readResult("X", "subjectivity"))
	r := s.result("q")
	require.Empty(t, r.CitedSubjectivityIDs)
	require.Empty(t, r.CitedWikiIDs)
}
