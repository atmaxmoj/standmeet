// codes_members.go —— CRUD for CodeMember (the code_members table). Split out
// of codes.go to respect the max-lines 350 line cap.

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

// GetOrCreateMember —— named visitor: upserts by (code_id, display_name). Same
// name = the same person (resuming a session); is_anonymous is always false
// (anonymous visitors go through CreateAnonymousMember instead).
func (r *CodeRepo) GetOrCreateMember(
	ctx context.Context, codeID, displayName string,
) (entity.CodeMember, error) {
	return r.insertMemberUnderCap(ctx, codeID, displayName, false)
}

// insertMemberUnderCap —— enforces the member cap **inside one transaction**:
// lock the code → count members → insert.
//
// The three steps must be three **separate statements**: under READ COMMITTED, every
// read within one statement shares the same snapshot, so writing `FOR UPDATE` +
// `count(*)` into a single SQL statement only serializes the lock, not the count —
// a request arriving later still counts against the old snapshot once it gets the
// lock, can't see the row the other request just committed, and lets itself through
// anyway. That's why F-D-5 was fixed once and still leaked: 12 people hitting a
// cap-5 code at once landed 6 rows. Once split apart, the count is a new statement
// that starts after the row lock is acquired → a new snapshot → it can see already
// committed members.
//
// Letting a same-name request through is **resuming a session**, and doesn't consume
// a new slot (MemberExistsByName is checked first, before deciding whether the cap
// even matters).
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

// inTx —— opens a transaction, runs one thing, commits on success / rolls back on
// failure. A rollback failure is joined with the original error and handed out
// together (dropping either one would send the next person diagnosing in the
// wrong direction).
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

// hasRoom —— whether this code still accepts new members. No cap / already a
// member (resuming) / not yet full → accept.
func hasRoom(
	ctx context.Context, q *db.Queries, codeUUID pgtype.UUID, displayName string, maxMembers *int32,
) (bool, error) {
	if noCap(maxMembers) {
		return true, nil
	}
	// Same name = resuming a session, doesn't consume a new slot.
	exists, eerr := q.MemberExistsByName(ctx, db.MemberExistsByNameParams{
		CodeID: codeUUID, DisplayName: displayName,
	})
	if eerr != nil || exists {
		return exists, wrapIf(eerr, "member exists by name")
	}
	n, cerr := q.CountCodeMembers(ctx, codeUUID)
	return n < int64(*maxMembers), wrapIf(cerr, "count code members")
}

// noCap —— no cap set (NULL), or set to 0/negative, both mean unlimited.
func noCap(maxMembers *int32) bool {
	return maxMembers == nil || *maxMembers <= 0
}

func wrapIf(err error, what string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", what, err)
}

// memberInsertErr —— 0 rows inserted = the cap is full, not a database error.
//
// The cap is enforced inside that statement itself (see access_codes.sql:
// GetOrCreateCodeMember), so "full" shows up at this layer as no-rows. Translating
// it back into a domain error lets the caller say something a human can read; without
// the translation it would surface as the literal "upsert code member: no rows" —
// a sentence a visitor can't understand and an owner can't act on either.
func memberInsertErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrMemberQuotaReached
	}
	return fmt.Errorf("upsert code member: %w", err)
}

// CreateAnonymousMember —— an anonymous visitor (skipping a name) gets one
// independent member of their own: generates a unique guest name +
// is_anonymous=true. The client stores the returned member_id and resumes by
// id next time, so it never collapses together with another anonymous visitor.
func (r *CodeRepo) CreateAnonymousMember(
	ctx context.Context, codeID string,
) (entity.CodeMember, error) {
	name, gerr := genGuestName()
	if gerr != nil {
		return entity.CodeMember{}, gerr
	}
	// Anonymous visitors consume a slot too (one member each), so they go through the
	// same transaction gate — fixing only the named-visitor path would leave the exact
	// same concurrency hole sitting right next door (the shape that kept getting hit).
	return r.insertMemberUnderCap(ctx, codeID, name, true)
}

// CountMembers —— how many members this code already has (the name picker shows
// "N of M" pre-issue).
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

// GetMemberByID —— fetches by member id + code (used to resume a session from a
// client-stored member_id); not found → ErrMemberNotFound, and the caller falls
// back to looking up by name / creating a new anonymous member.
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

// genGuestName —— generates a unique anonymous name "guest-xxxxxxxx" (lowercase base32).
func genGuestName() (string, error) {
	buf := make([]byte, guestRandBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return "guest-" + strings.ToLower(enc)[:guestNameLen], nil
}

// ListMembers —— admin view of all members under a code (including revoked ones;
// the UI groups them itself).
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
