package paritymanifest

// manifest_outward.go —— the OUTWARD-plane manifest (facade-directions.md). These are the
// role-grantable capabilities served to granted outsiders: the chat facade (LLM in the loop) and
// the api facade (programmatic, no LLM). Owner-plane ops live in manifest_table*.go; the two planes
// never mix (an op on the wrong-plane facade is a "leak" — enforced by facadeparity.Conform).
//
// The api facade renders one endpoint per op, named by the op-id, so no primitive→op mapping is
// needed here (unlike the owner side, where one admin route can serve several MCP tools). The
// chat facade's realizing tool names (corpus_search / calendar_book / …) are wired to these ops in
// Wave D when the live registry ratchet lands; this file is the semantic source of truth.

import fp "github.com/atmaxmoj/standmeet/internal/facadeparity"

// Outward facade names.
const (
	FacadeChat = "chat"
	FacadeAPI  = "api"
)

// Outward op-ids. The non-Agentic ones are api candidates (they enter KnownAPIGaps until the api
// renderer serves them); the Agentic ones (ask / summarize / mail) only ever render on chat.
const (
	OpCorpusSearch = "outward.corpus.search"
	OpCorpusRead   = "outward.corpus.read"
	OpCorpusList   = "outward.corpus.list"
	OpCorpusLinks  = "outward.corpus.links"
	OpBookingSlots = "outward.booking.slots"
	OpBookingBook  = "outward.booking.book"
	OpAsk          = "outward.ask"
	OpSummarize    = "outward.summarize"
	OpMailSend     = "outward.mail.send"
)

// query —— a read-derived-from-query op (HTTP QUERY, RFC 10008); see facadeparity.Kind.
func query(id string, r fp.Reach) fp.Op { return fp.Op{ID: id, Kind: fp.Query, Reach: r} }

// ManifestOutward —— the outward-plane ops. Reads/queries are grantable to any outward facade;
// Agentic actions Except the api facade (it can't carry an LLM-in-the-loop op).
func ManifestOutward() []fp.Op {
	return []fp.Op{
		query(OpCorpusSearch, fp.OutwardRead()),
		read(OpCorpusRead, fp.OutwardRead()),
		read(OpCorpusList, fp.OutwardRead()),
		read(OpCorpusLinks, fp.OutwardRead()),
		read(OpBookingSlots, fp.OutwardRead()),
		act(OpBookingBook, fp.OutwardAction()),
		act(OpAsk, fp.OutwardAction().Except(fp.Agentic)),
		act(OpSummarize, fp.OutwardAction().Except(fp.Agentic)),
		act(OpMailSend, fp.OutwardAction().Except(fp.Agentic)),
	}
}

// apiFacade —— the api facade profile: outward plane, programmatic (no Agentic), serves reads +
// actions. (The chat facade profile — which carries Agentic — is wired with the live chat ratchet
// in Wave D; FacadeChat above reserves its name.)
func apiFacade() fp.Facade {
	return fp.Facade{Name: FacadeAPI, Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true}
}

// APIMissing —— op-ids that per their Reach must be on the api facade but aren't among the live api
// endpoints (endpoint names ARE op-ids). The api paydown worklist: an empty renderer → every
// non-Agentic outward op is missing; shipping an endpoint shrinks it. Mirrors MCPMissing.
func APIMissing(liveAPIEndpoints []string) []string {
	exposed := make(map[string]bool, len(liveAPIEndpoints))
	for _, e := range liveAPIEndpoints {
		exposed[e] = true
	}
	out := []string{}
	for _, v := range fp.Conform(ManifestOutward(), []fp.Exposure{
		{Facade: apiFacade(), Exposed: exposed},
	}) {
		if v.Facade == FacadeAPI && v.Kind == "missing" {
			out = append(out, v.OpID)
		}
	}
	return out
}

// AllOps —— the combined owner + outward op set. The one manifest a full boot/leak check runs over:
// any facade (owner or outward) exposing an op of the other plane surfaces as a leak.
func AllOps() []fp.Op {
	m := Manifest()
	outward := ManifestOutward()
	out := make([]fp.Op, 0, len(m)+len(outward))
	for i := range m {
		out = append(out, m[i].Op)
	}
	return append(out, outward...)
}
