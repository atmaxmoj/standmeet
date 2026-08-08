// codes_members.go —— CodeMember (code_members 表) CRUD。从 codes.go 拆出
// 守 max-lines 350 line cap。

package repo

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetOrCreateMember —— 具名访客:按 (code_id, display_name) upsert。同名 = 同一
// 个人(续会);is_anonymous 永远 false(匿名走 CreateAnonymousMember)。
func (r *CodeRepo) GetOrCreateMember(
	ctx context.Context, codeID, displayName string,
) (entity.CodeMember, error) {
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := db.New(r.pool)
	row, qerr := q.GetOrCreateCodeMember(ctx, db.GetOrCreateCodeMemberParams{
		CodeID: codeUUID, DisplayName: displayName, IsAnonymous: false,
	})
	if qerr != nil {
		return entity.CodeMember{}, memberInsertErr(qerr)
	}
	return toDomainMember(&row), nil
}

// memberInsertErr —— 插了 0 行 = 名额满了,不是数据库出错。
//
// 上限守在那条语句自己里(见 access_codes.sql:GetOrCreateCodeMember),所以「满」在这一层的样子
// 就是 no-rows。把它翻回领域错误,调用方才能说人话;不翻的话它会以 "upsert code member: no rows"
// 的形状冒到面上 —— 一个访客读不懂、owner 也定位不到的句子。
func memberInsertErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrMemberQuotaReached
	}
	return fmt.Errorf("upsert code member: %w", err)
}

// CreateAnonymousMember —— 匿名访客(skip 名字)每人一个独立 member:生成唯一
// guest 名 + is_anonymous=true。client 拿返回的 member_id 存下,再来凭 id 续会,
// 不会跟别的匿名者塌成一个。
func (r *CodeRepo) CreateAnonymousMember(
	ctx context.Context, codeID string,
) (entity.CodeMember, error) {
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	name, gerr := genGuestName()
	if gerr != nil {
		return entity.CodeMember{}, gerr
	}
	row, qerr := db.New(r.pool).GetOrCreateCodeMember(ctx, db.GetOrCreateCodeMemberParams{
		CodeID: codeUUID, DisplayName: name, IsAnonymous: true,
	})
	if qerr != nil {
		return entity.CodeMember{}, memberInsertErr(qerr)
	}
	return toDomainMember(&row), nil
}

// CountMembers —— 这张码已有几个 member(名字选择器 pre-issue 显 "N of M")。
func (r *CodeRepo) CountMembers(ctx context.Context, codeID string) (int32, error) {
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return 0, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	n, qerr := db.New(r.pool).CountCodeMembers(ctx, codeUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count code members: %w", qerr)
	}
	return int32(n), nil
}

// GetMemberByID —— 按 member id + code 取(client 存 member_id 续会用);
// 不存在 → ErrMemberNotFound,caller 退到按名字 / 新建匿名。
func (r *CodeRepo) GetMemberByID(
	ctx context.Context, memberID, codeID string,
) (entity.CodeMember, error) {
	mUUID, err := pgstore.ParseUUID(memberID)
	if err != nil {
		return entity.CodeMember{}, fmt.Errorf("parse member id: %w", err)
	}
	cUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return entity.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	row, qerr := db.New(r.pool).GetCodeMemberByID(ctx, db.GetCodeMemberByIDParams{
		ID: mUUID, CodeID: cUUID,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.CodeMember{}, entity.ErrMemberNotFound
		}
		return entity.CodeMember{}, fmt.Errorf("get member by id: %w", qerr)
	}
	return toDomainMember(&row), nil
}

const (
	guestRandBytes = 5 // 5 bytes → 8 base32 chars
	guestNameLen   = 8
)

// genGuestName —— "guest-xxxxxxxx" 唯一匿名名(lowercase base32)。
func genGuestName() (string, error) {
	buf := make([]byte, guestRandBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return "guest-" + strings.ToLower(enc)[:guestNameLen], nil
}

// ListMembers —— admin 看 code 下所有 member（含 revoked，UI 自己分组）。
func (r *CodeRepo) ListMembers(
	ctx context.Context, codeID string) ([]entity.CodeMember, error,
) {
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, qerr := q.ListCodeMembers(ctx, codeUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list code members: %w", qerr)
	}
	out := make([]entity.CodeMember, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainMember(&rows[i]))
	}
	return out, nil
}

func toDomainMember(m *db.CodeMember) entity.CodeMember {
	out := entity.CodeMember{
		ID:          pgstore.FormatUUID(m.ID),
		CodeID:      pgstore.FormatUUID(m.CodeID),
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
