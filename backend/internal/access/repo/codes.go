// codes.go —— access_codes + code_members + conversations + messages Repository.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// errParseCodeIDPrefix —— the literal "parse code id: %w" shows up 6+ times in this
// file, so it's pulled into a constant.
const errParseCodeIDPrefix = "parse code id: %w"

// CodeRepo —— access_codes CRUD.
type CodeRepo struct {
	pool *pgstore.Pool
}

// NewCodeRepo constructs a CodeRepo.
func NewCodeRepo(pool *pgstore.Pool) *CodeRepo { return &CodeRepo{pool: pool} }

// CreateCodeInput —— inputs for creating an access code. AssumedRoleID is required
// (the caller usecase defaults to public when it doesn't give one explicitly).
type CreateCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	PromptID           *string
	LimitPerPeriod     *entity.PeriodLimit
	Label              string
	Code               string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	ProviderID         string
	OwnerID            string
	Ghosts             []string
}

// optStr —— empty string → nil (the "not given" shape ParseOptionalUUID expects);
// non-empty → pointer. An optional foreign key is an empty string in this domain and
// NULL on the sqlc side; this function is that translation.
func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Create writes one access_code row.
func (r *CodeRepo) Create(
	ctx context.Context, in *CreateCodeInput) (entity.Code, error,
) {
	return createCodeOn(ctx, db.New(r.pool), in)
}

// CreateAccessCodeTx —— issues a code **inside the caller's transaction**, for
// cross-domain callers (job-loop application-commit: writing the application row and
// issuing the code must be atomic in the same tx). access doesn't let other domains
// touch the access_codes DAO directly; going through this to issue a code on a shared
// pgx.Tx keeps both the atomicity and the domain boundary. Parameters are pgx
// primitives (this domain's generated DBTX type never leaks out).
func CreateAccessCodeTx(
	ctx context.Context, tx pgx.Tx, in *entity.CreateAccessCodeInput,
) (entity.Code, error) {
	return createCodeOn(ctx, db.New(tx), accessInputToCreate(in))
}

// createCodeOn —— writes one access_code row on any DBTX (pool connection or
// transaction). Shared by Create and CreateAccessCodeTx.
func createCodeOn(ctx context.Context, q *db.Queries, in *CreateCodeInput) (entity.Code, error) {
	// Derive a code from the label when none is given. Every code-creation path
	// converges here, so this rule exists in exactly one place.
	in.Code = entity.DeriveCode(in.Code, in.Label)
	params, perr := buildCreateCodeParams(in)
	if perr != nil {
		return entity.Code{}, perr
	}
	row, err := q.CreateAccessCode(ctx, *params)
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "access_codes_code_key" {
			return entity.Code{}, entity.ErrCodeTaken
		}
		return entity.Code{}, fmt.Errorf("create access code: %w", err)
	}
	return CodeFromRow(&row), nil
}

// CreateAccessCode —— a domain-input wrapper around Create; used by the MCP cap
// (the mcp package can't import postgres structs). Internally it just copies
// CreateAccessCodeInput into an access.CreateCodeInput and calls Create.
func (r *CodeRepo) CreateAccessCode(
	ctx context.Context, in *entity.CreateAccessCodeInput,
) (entity.Code, error) {
	return r.Create(ctx, accessInputToCreate(in))
}

// accessInputToCreate —— translates CreateAccessCodeInput → CreateCodeInput
// (fields map one-to-one).
func accessInputToCreate(in *entity.CreateAccessCodeInput) *CreateCodeInput {
	return &CreateCodeInput{
		OwnerID:            in.OwnerID,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		AssumedRoleID:      in.AssumedRoleID,
		Ghosts:             in.Ghosts,
		ExpiresAt:          in.ExpiresAt,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		PromptID:           in.PromptID,
		InlinePrompt:       in.InlinePrompt,
		ProviderID:         in.ProviderID,
	}
}

// codeCreateIDs —— the four ids that creating a code needs to parse (two required,
// two optional). Pulled out on its own so buildCreateCodeParams is left doing only
// one thing: assembling parameters.
type codeCreateIDs struct {
	owner    pgtype.UUID
	role     pgtype.UUID
	prompt   pgtype.UUID
	provider pgtype.UUID
}

func parseCodeCreateIDs(in *CreateCodeInput) (codeCreateIDs, error) {
	var out codeCreateIDs
	var err error
	if out.owner, err = pgstore.ParseUUID(in.OwnerID); err != nil {
		return out, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if out.role, err = pgstore.ParseUUID(in.AssumedRoleID); err != nil {
		return out, fmt.Errorf("parse assumed_role_id: %w", err)
	}
	if out.prompt, err = pgstore.ParseOptionalUUID(in.PromptID); err != nil {
		return out, fmt.Errorf("parse prompt_id: %w", err)
	}
	if out.provider, err = pgstore.ParseOptionalUUID(optStr(in.ProviderID)); err != nil {
		return out, fmt.Errorf("parse provider_id: %w", err)
	}
	return out, nil
}

func buildCreateCodeParams(in *CreateCodeInput) (*db.CreateAccessCodeParams, error) {
	ids, err := parseCodeCreateIDs(in)
	if err != nil {
		return nil, err
	}
	qs, jerr := json.Marshal(in.Ghosts)
	if jerr != nil {
		return nil, fmt.Errorf("marshal suggested questions: %w", jerr)
	}
	// limit_per_period is a nullable jsonb: not set → period stays nil → stored as SQL
	// NULL (= unlimited). Inlined rather than a helper: a helper that returns a nil
	// []byte would trip the no-nil-container rule (a happy-path container return must
	// not be nil), and here nil is exactly the right answer. A local nil variable isn't
	// governed by that guard.
	var period []byte
	if in.LimitPerPeriod != nil {
		var plerr error
		if period, plerr = json.Marshal(in.LimitPerPeriod); plerr != nil {
			return nil, fmt.Errorf("marshal limit_per_period: %w", plerr)
		}
	}
	return &db.CreateAccessCodeParams{
		ProviderID:         ids.provider,
		OwnerID:            ids.owner,
		Code:               in.Code,
		Label:              in.Label,
		Purpose:            in.Purpose,
		Ghosts:             qs,
		ExpiresAt:          ptrToTimestamptz(in.ExpiresAt),
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession,
		AssumedRoleID:      ids.role,
		PromptID:           ids.prompt,
		InlinePrompt:       in.InlinePrompt,
		LimitPerPeriod:     period,
	}, nil
}

// UpdateRole —— changes a code's assumed_role_id. The new role must belong to the
// same owner (the caller has already checked this). role id is required now that
// the schema column is NOT NULL.
func (r *CodeRepo) UpdateRole(
	ctx context.Context, ownerID, codeID, roleID string,
) (entity.Code, error) {
	params, perr := buildUpdateCodeRoleParams(ownerID, codeID, roleID)
	if perr != nil {
		return entity.Code{}, perr
	}
	row, qerr := db.New(r.pool).UpdateAccessCodeRole(ctx, *params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("update access code role: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

func buildUpdateCodeRoleParams(
	ownerID, codeID, roleID string,
) (*db.UpdateAccessCodeRoleParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	roleUUID, rerr := pgstore.ParseUUID(roleID)
	if rerr != nil {
		return nil, fmt.Errorf("parse role id: %w", rerr)
	}
	return &db.UpdateAccessCodeRoleParams{
		ID: codeUUID, OwnerID: ownerUUID, AssumedRoleID: roleUUID,
	}, nil
}

// UpdatePermissions / buildUpdatePermissionsParams were removed in A.3-IAM-5 —
// the corpus_permissions column is dropped; the ACL now runs through Role.CorpusURIs.

// Revoke flips code.status to 'revoked'; GetAccessCode (which only queries active
// codes) skips it from then on.
//
// A 0-row match (wrong owner / unknown code id) returns ErrCodeInvalid so the callers
// (admin REST + MCP) can both translate it uniformly into "code not found", instead of
// silently returning OK and letting the owner believe the revoke succeeded. The original
// sqlc-generated RevokeAccessCode went through Exec and discarded the CommandTag, so it
// couldn't see RowsAffected; this bypasses that and calls pool.Exec directly for the tag.
func (r *CodeRepo) Revoke(ctx context.Context, ownerID, codeID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	tag, rerr := r.pool.Exec(
		ctx,
		`UPDATE access_codes SET status='revoked' WHERE id=$1 AND owner_id=$2`,
		codeUUID, ownerUUID,
	)
	if rerr != nil {
		return fmt.Errorf("revoke access code: %w", rerr)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrCodeInvalid
	}
	return nil
}

// member CRUD (GetOrCreateMember / ListMembers / toDomainMember) is split out
// into codes_members.go to respect the max-lines cap.

// UpdateQuotas changes a code's quotas; returns the new row (so the admin UI can
// refresh directly).
func (r *CodeRepo) UpdateQuotas(
	ctx context.Context, ownerID, codeID string, maxTurns, maxMembers *int32,
) (entity.Code, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateAccessCodeQuotas(ctx, db.UpdateAccessCodeQuotasParams{
		ID: codeUUID, OwnerID: ownerUUID,
		MaxTurnsPerSession: maxTurns, MaxMembers: maxMembers,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("update access code quotas: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

// SetGhostEvidence —— F-A-10 per-code override: nil = inherits the role's switch;
// non-nil = explicit override. Returns the new row.
func (r *CodeRepo) SetGhostEvidence(
	ctx context.Context, ownerID, codeID string, val *bool,
) (entity.Code, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	codeUUID, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return entity.Code{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	row, qerr := db.New(r.pool).SetAccessCodeGhostEvidence(ctx,
		db.SetAccessCodeGhostEvidenceParams{
			ID: codeUUID, OwnerID: ownerUUID, RequireGhostEvidence: val,
		})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Code{}, entity.ErrCodeInvalid
		}
		return entity.Code{}, fmt.Errorf("set access code ghost evidence: %w", qerr)
	}
	return CodeFromRow(&row), nil
}

// Get/List/decode helpers are split out into codes_query.go to respect max-lines.

func ptrToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
