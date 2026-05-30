// codes_members.go —— CodeMember (code_members 表) CRUD。从 codes.go 拆出
// 守 max-lines 350 line cap。

package postgres

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// GetOrCreateMember —— 按 (code_id, display_name) upsert code_member。
// IdentityPicker 用：访客在 gate 输入名字 → 这里拿/建一个 member row →
// session 携带 member_id 让后续 quota check 命中正确的人。
func (r *CodeRepo) GetOrCreateMember(
	ctx context.Context, codeID, displayName string,
) (domain.CodeMember, error) {
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return domain.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := dbq.New(r.pool)
	row, qerr := q.GetOrCreateCodeMember(ctx, dbq.GetOrCreateCodeMemberParams{
		CodeID: codeUUID, DisplayName: displayName, IsAnonymous: displayName == "",
	})
	if qerr != nil {
		return domain.CodeMember{}, fmt.Errorf("upsert code member: %w", qerr)
	}
	return toDomainMember(&row), nil
}

// ListMembers —— admin 看 code 下所有 member（含 revoked，UI 自己分组）。
func (r *CodeRepo) ListMembers(ctx context.Context, codeID string) ([]domain.CodeMember, error) {
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, qerr := q.ListCodeMembers(ctx, codeUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list code members: %w", qerr)
	}
	out := make([]domain.CodeMember, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMember(&rows[i]))
	}
	return out, nil
}

func toDomainMember(m *dbq.CodeMember) domain.CodeMember {
	out := domain.CodeMember{
		ID:          formatUUID(m.ID),
		CodeID:      formatUUID(m.CodeID),
		DisplayName: m.DisplayName,
		IsAnonymous: m.IsAnonymous,
	}
	if m.Email != nil {
		out.Email = *m.Email
	}
	if m.LastSeenAt.Valid {
		out.LastSeenAt = m.LastSeenAt.Time
	}
	return out
}
