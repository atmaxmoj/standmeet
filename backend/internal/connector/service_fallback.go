// service_fallback.go —— 断开 active 连接后的品类槽回退（promote 下一个 connected 候选）。
// 从 service.go 拆出，保持后者 ≤350 行。

package connector

import (
	"context"
	"fmt"
)

// promoteFallback —— 品类槽无 active 但还有 connected 候选 → 把第一个候选设为 active（回退）。
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
		return nil // 无 connected 候选 → 槽空，复闸
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
