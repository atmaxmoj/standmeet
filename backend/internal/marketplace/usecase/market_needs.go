// market_needs.go —— how the marketplace card's "still needs which connector" line gets
// computed (F-F-4).
//
// The truth is derived, in a three-stage chain: the skill declares which **tools** it uses
// (SKILL.md's `allowed-tools`) → the **capabilities** that provide those tools need which
// connectors (the manifest's `requires`) → has this owner connected them. None of the three
// stages live in this domain, so here we only declare a port and let the composition root
// answer it.

package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// ConnectorNeeds —— port: given a skill that declares it uses these tools, which connectors
// does it need behind the scenes, and which of those is this owner still missing.
//
// Why the answer is "which ones are still missing" rather than "which ones does it need":
// these two halves used to be shipped separately — the server sent the requirement (it never
// actually did), the client took the connector list and computed the set difference itself,
// and along the way hand-mapped category into a third naming, 'Calendar' / 'Email'. Two
// halves of the same question living on two different machines are bound to drift apart.
type ConnectorNeeds interface {
	// DepsForTools —— the connector names behind these tools. Pure in-memory.
	DepsForTools(tools []string) []string
	// Unconnected —— of these connectors, the ones this owner hasn't connected yet.
	Unconnected(ctx context.Context, ownerID string, deps []string) ([]string, error)
}

// fillNeeds —— fill in "which connectors are still missing" for the results on this page
// whose **body has been read**.
//
// Asked in one shot: the page's connector names are unioned first, "which ones aren't
// connected" is asked once, then the answer is split back out to each result. Asking
// per-result instead would turn one page of 12 cards into 12 rounds of the same check.
//
// When it can't answer (no port wired / no owner context / the check errored), **fill in
// nothing**: Needs stays nil = unknown. Filling in an empty list would say "unknown" as
// "nothing missing" — which is exactly what this field used to do.
func fillNeeds(
	ctx context.Context, port ConnectorNeeds, ownerID string, page []entity.MarketSkill,
) {
	if port == nil || ownerID == "" {
		return
	}
	missing, err := unconnectedForPage(ctx, port, ownerID, page)
	if err != nil {
		slog.Default().Warn("marketplace: cannot resolve connector needs", "err", err)
		return
	}
	assignNeeds(port, missing, page)
}

// assignNeeds —— split the page-wide "not connected yet" set out by each result's own
// connector needs. Skips results whose body wasn't read — their answer is "unknown", and
// nil is that answer.
func assignNeeds(port ConnectorNeeds, missing []string, page []entity.MarketSkill) {
	for i := range page {
		if page[i].AllowedTools == nil {
			continue
		}
		page[i].Needs = intersect(missing, port.DepsForTools(page[i].AllowedTools))
	}
}

// unconnectedForPage —— of the connectors this whole page needs, the ones this owner
// hasn't connected yet.
func unconnectedForPage(
	ctx context.Context, port ConnectorNeeds, ownerID string, page []entity.MarketSkill,
) ([]string, error) {
	all := pageDeps(port, page)
	missing, err := port.Unconnected(ctx, ownerID, all)
	if err != nil {
		return nil, fmt.Errorf("unconnected deps: %w", err)
	}
	return missing, nil
}

// pageDeps —— the full set of connectors this page (the results whose body was read)
// needs, deduplicated.
func pageDeps(port ConnectorNeeds, page []entity.MarketSkill) []string {
	seen := map[string]struct{}{}
	all := []string{}
	for i := range page {
		if page[i].AllowedTools == nil {
			continue
		}
		all = appendNew(all, seen, port.DepsForTools(page[i].AllowedTools))
	}
	return all
}

func appendNew(out []string, seen map[string]struct{}, more []string) []string {
	for _, v := range more {
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// intersect —— the entries of want that also appear in missing, ordered by want. Always
// returns non-nil: reaching this point means this result's body was already read, so
// "nothing missing" is an answer, not "unknown".
func intersect(missing, want []string) []string {
	lack := make(map[string]struct{}, len(missing))
	for _, m := range missing {
		lack[m] = struct{}{}
	}
	out := []string{}
	for _, w := range want {
		if _, hit := lack[w]; hit {
			out = append(out, w)
		}
	}
	return out
}
