// service_fallback.go — category-slot fallback after disconnecting the active connection
// (promotes the next connected candidate). Split out of service.go to keep the latter ≤350
// lines.

package connector

import (
	"context"
	"fmt"
)

// promoteFallback — the category slot has no active connector but there's still a connected
// candidate → set the first candidate active (fallback).
func (s *Service) promoteFallback(ctx context.Context, ownerID, category string) error {
	conns, err := s.d.Repo.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return fmt.Errorf("list category for fallback: %w", err)
	}
	if hasActiveConn(conns) {
		return nil
	}
	cand := firstConnectedID(conns)
	if cand == "" {
		return nil // no connected candidate → the slot goes empty, re-gated
	}
	if serr := s.d.Repo.SetActive(ctx, ownerID, cand, category); serr != nil {
		return fmt.Errorf("promote fallback connector: %w", serr)
	}
	return nil
}

func hasActiveConn(conns []Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}

func firstConnectedID(conns []Connection) string {
	for i := range conns {
		if conns[i].Connected {
			return conns[i].ConnectorID
		}
	}
	return ""
}
