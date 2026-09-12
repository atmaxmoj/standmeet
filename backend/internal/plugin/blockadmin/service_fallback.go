// service_fallback.go — seam-slot fallback after disconnecting the active connection
// (promotes the next connected candidate). Split out of service.go to keep the latter ≤350
// lines.

package blockadmin

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// promoteFallback — the seam slot has no active supplier but there's still a connected
// candidate → set the first candidate active (fallback).
func (s *Service) promoteFallback(ctx context.Context, ownerID, seam string) error {
	conns, err := s.d.Repo.ListBySeam(ctx, ownerID, seam)
	if err != nil {
		return fmt.Errorf("list seam for fallback: %w", err)
	}
	if hasActiveConn(conns) {
		return nil
	}
	cand := firstConnectedID(conns)
	if cand == "" {
		return nil // no connected candidate → the slot goes empty, re-gated
	}
	if serr := s.d.Repo.SetActive(ctx, ownerID, cand, seam); serr != nil {
		return fmt.Errorf("promote fallback supplier: %w", serr)
	}
	return nil
}

func hasActiveConn(conns []credentials.Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}

func firstConnectedID(conns []credentials.Connection) string {
	for i := range conns {
		if conns[i].Connected {
			return conns[i].BlockID
		}
	}
	return ""
}
