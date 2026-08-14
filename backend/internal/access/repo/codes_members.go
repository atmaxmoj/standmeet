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
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GetOrCreateMember —— 具名访客:按 (code_id, display_name) upsert。同名 = 同一
// 个人(续会);is_anonymous 永远 false(匿名走 CreateAnonymousMember)。
func (r *CodeRepo) GetOrCreateMember(
	ctx context.Context, codeID, displayName string,
) (entity.CodeMember, error) {
	return r.insertMemberUnderCap(ctx, codeID, displayName, false)
}

// insertMemberUnderCap —— 名额上限**在一个事务里**守住：锁码 → 数人 → 插入。
//
// 三步必须是三条**独立语句**：READ COMMITTED 下一条语句里的所有读取共用同一个快照，
// 所以「`FOR UPDATE` + `count(*)` 写进同一条 SQL」只串行了锁、没串行计数 ——
// 后到的那个请求拿到锁之后仍然按旧快照数人，看不见对方刚提交的那一行，于是照样放行。
// 这就是 F-D-5 修过一次却仍然漏的原因：12 个人同时冲上限 5 的码，落库 6。
// 拆开之后，count 是取得行锁之后开始的新语句 → 新快照 → 看得见已提交的成员。
//
// 同名放行是**续会**，不占新名额（先问 MemberExistsByName，再决定要不要看上限）。
func (r *CodeRepo) insertMemberUnderCap(
	ctx context.Context, codeID, displayName string, anon bool,
) (entity.CodeMember, error) {
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.CodeMember{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	row, terr := r.inTx(ctx, func(tx pgx.Tx) (db.CodeMember, error) {
		return insertMemberTx(ctx, tx, codeUUID, displayName, anon)
	})
	if terr != nil {
		return entity.CodeMember{}, terr
	}
	return toDomainMember(&row), nil
}

// inTx —— 开事务、跑一件事、成功提交/失败回滚。回滚失败跟原错误一起交出去（丢掉其中任何
// 一个都会让下一个人诊断错方向）。
func (r *CodeRepo) inTx(
	ctx context.Context, body func(pgx.Tx) (db.CodeMember, error),
) (db.CodeMember, error) {
	tx, terr := r.pool.Begin(ctx)
	if terr != nil {
		return db.CodeMember{}, fmt.Errorf("begin member tx: %w", terr)
	}
	row, ierr := body(tx)
	if ierr != nil {
		return db.CodeMember{}, rollbackWith(ctx, tx, ierr)
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return db.CodeMember{}, fmt.Errorf("commit member tx: %w", cerr)
	}
	return row, nil
}

func rollbackWith(ctx context.Context, tx pgx.Tx, cause error) error {
	if rerr := tx.Rollback(ctx); rerr != nil {
		return errors.Join(cause, fmt.Errorf("rollback: %w", rerr))
	}
	return cause
}

func insertMemberTx(
	ctx context.Context, tx pgx.Tx, codeUUID pgtype.UUID, displayName string, anon bool,
) (db.CodeMember, error) {
	q := db.New(tx)
	maxMembers, lerr := q.LockCodeForMemberInsert(ctx, codeUUID)
	if lerr != nil {
		return db.CodeMember{}, fmt.Errorf("lock code for member insert: %w", lerr)
	}
	room, rerr := hasRoom(ctx, q, codeUUID, displayName, maxMembers)
	if rerr != nil {
		return db.CodeMember{}, rerr
	}
	if !room {
		return db.CodeMember{}, entity.ErrMemberQuotaReached
	}
	row, qerr := q.UpsertCodeMember(ctx, db.UpsertCodeMemberParams{
		CodeID: codeUUID, DisplayName: displayName, IsAnonymous: anon,
	})
	if qerr != nil {
		return db.CodeMember{}, memberInsertErr(qerr)
	}
	return row, nil
}

// hasRoom —— 这张码还收不收人。无上限 / 已是成员(续会) / 人数未满 → 收。
func hasRoom(
	ctx context.Context, q *db.Queries, codeUUID pgtype.UUID, displayName string, maxMembers *int32,
) (bool, error) {
	if noCap(maxMembers) {
		return true, nil
	}
	// 同名 = 续会,不吃新名额。
	exists, eerr := q.MemberExistsByName(ctx, db.MemberExistsByNameParams{
		CodeID: codeUUID, DisplayName: displayName,
	})
	if eerr != nil || exists {
		return exists, wrapIf(eerr, "member exists by name")
	}
	n, cerr := q.CountCodeMembers(ctx, codeUUID)
	return n < int64(*maxMembers), wrapIf(cerr, "count code members")
}

// noCap —— 没设上限（NULL）或设成 0/负数,都表示不限。
func noCap(maxMembers *int32) bool {
	return maxMembers == nil || *maxMembers <= 0
}

func wrapIf(err error, what string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", what, err)
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
	name, gerr := genGuestName()
	if gerr != nil {
		return entity.CodeMember{}, gerr
	}
	// 匿名者也吃名额（每人一个 member），所以走同一道事务闸门 —— 只改具名那条路，
	// 等于把同一个并发洞留在隔壁（今天反复撞的那个形状）。
	return r.insertMemberUnderCap(ctx, codeID, name, true)
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
