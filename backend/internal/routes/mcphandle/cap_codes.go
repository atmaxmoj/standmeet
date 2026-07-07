// cap_codes.go —— Phase B-6 parity pilot: codes.revoke 通过 MCP 暴露。
// owner 现在在 admin UI 也能 revoke，但 owner 的 AI 客户端 (Claude Code 等)
// 没法 revoke —— 这是 MCP parity 缺口的一个具体填补。
//
// 后续 B-6 增量提交可加 codes.create / codes.update_quotas / codes.list /
// page.update_handle / corpus.update_wiki / calendar.list_slots /
// calendar.cancel_booking 等其他 parity 缺口。

package mcphandle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

const capCodesBundle = "codes.bundle"

// CodesRevoker —— codes.bundle capability 需要的窄接口 (avoid 直接 import
// postgres.CodeRepo)。
//
// E-13: Revoke 现在在 repo 层 0-row → ErrCodeInvalid，cap 不再需要先 GetByID
// 校 ownership。create / update_quotas 是 E-13 新加的 parity tools，复用同
// repo 接口。
type CodesRevoker interface {
	GetByID(ctx context.Context, codeID string) (domain.AccessCode, error)
	Revoke(ctx context.Context, ownerID, codeID string) error
	CreateAccessCode(
		ctx context.Context, in *domain.CreateAccessCodeInput,
	) (domain.AccessCode, error)
	UpdateQuotas(
		ctx context.Context, ownerID, codeID string,
		maxTurns, maxMembers *int32,
	) (domain.AccessCode, error)
}

type codesCapability struct {
	codes CodesRevoker
	log   *slog.Logger
}

func newCodesCapability(codes CodesRevoker, log *slog.Logger) *codesCapability {
	return &codesCapability{codes: codes, log: log}
}

func (*codesCapability) ID() string          { return capCodesBundle }
func (*codesCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*codesCapability) VisitorBinding(_ context.Context, _ *capreg.AssembleInput) (
	*capreg.Binding, error,
) {
	return nil, capreg.ErrHidden
}

func (*codesCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*codesCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *codesCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.revokeBinding(), c.createBinding(), c.updateQuotasBinding(),
	}
}

func (c *codesCapability) revokeBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.revoke",
		Description: "Revoke an access code by id. In-flight visitor sessions can " +
			"finish current turn but the next turn is blocked. Idempotent on already " +
			"revoked codes.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"code_id":{"type":"string","description":"Access code UUID."}
			},
			"required":["code_id"]
		}`),
		Handler: c.handleRevoke,
	}
}

type revokeArgsWire struct {
	CodeID string `json:"code_id"`
}

type revokeResultPayload struct {
	CodeID  string `json:"code_id"`
	Revoked bool   `json:"revoked"`
}

func (c *codesCapability) handleRevoke(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseRevokeArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.codes.Revoke(ctx, ownerID, args.CodeID); err != nil {
		return codesRevokeErr(c.log, err)
	}
	return marshalRevokeResult(c.log, args.CodeID)
}

func parseRevokeArgs(raw json.RawMessage) (revokeArgsWire, error) {
	var args revokeArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.CodeID == "" {
		return args, errors.New("code_id is required")
	}
	return args, nil
}

func codesRevokeErr(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return capreg.MCPError("code not found")
	}
	log.Error("codes.revoke", "err", err)
	return capreg.MCPError("revoke failed")
}

func marshalRevokeResult(log *slog.Logger, codeID string) capreg.MCPResult {
	out, err := json.Marshal(revokeResultPayload{CodeID: codeID, Revoked: true})
	if err != nil {
		log.Error("codes.revoke marshal", "err", err)
		return capreg.MCPError("encode payload")
	}
	return capreg.MCPSuccess(string(out))
}

// codes.create 在 cap_codes_create.go (拆出来守 max-lines)。

// ───── codes.update_quotas ──────────────────────────────────────

func (c *codesCapability) updateQuotasBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.update_quotas",
		Description: "Update an access code's per-member session quota and " +
			"per-session turn quota. Pass null to keep current value.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"code_id":{"type":"string"},
				"max_members":{"type":"number"},
				"max_turns_per_session":{"type":"number"}
			},
			"required":["code_id"]
		}`),
		Handler: c.handleUpdateQuotas,
	}
}

type updateQuotasArgsWire struct {
	MaxMembers *int32 `json:"max_members"`
	MaxTurns   *int32 `json:"max_turns_per_session"`
	CodeID     string `json:"code_id"`
}

func (c *codesCapability) handleUpdateQuotas(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseUpdateQuotasArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	merged, mErr := c.mergeQuotaArgs(ctx, ownerID, &args)
	if mErr != nil {
		return *mErr
	}
	code, err := c.codes.UpdateQuotas(
		ctx, ownerID, args.CodeID, merged.maxTurns, merged.maxMembers,
	)
	if err != nil {
		return updateQuotasErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "codes.update_quotas", map[string]any{
		"code_id":               code.ID,
		"max_members":           code.MaxMembers,
		"max_turns_per_session": code.MaxTurnsPerSession,
	})
}

func parseUpdateQuotasArgs(raw json.RawMessage) (updateQuotasArgsWire, error) {
	var args updateQuotasArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.CodeID == "" {
		return args, errors.New("code_id is required")
	}
	return args, nil
}

func updateQuotasErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return capreg.MCPError("code not found")
	}
	log.Error("cap codes.update_quotas", "err", err)
	return capreg.MCPError("update quotas failed")
}

// quotaPair —— mergeQuotaArgs 返值；caller 透传给 UpdateQuotas。
type quotaPair struct {
	maxMembers *int32
	maxTurns   *int32
}

// mergeQuotaArgs —— "Pass null to keep current value" 语义：caller 未传的字段
// 走 GetByID 拿当前值填回去。GetByID 返 ErrCodeInvalid (含 wrong-owner) →
// 翻 "code not found"。
func (c *codesCapability) mergeQuotaArgs(
	ctx context.Context, ownerID string, args *updateQuotasArgsWire,
) (*quotaPair, *capreg.MCPResult) {
	if args.MaxMembers != nil && args.MaxTurns != nil {
		return &quotaPair{maxMembers: args.MaxMembers, maxTurns: args.MaxTurns}, nil
	}
	cur, lookupErr := c.lookupOwnedCode(ctx, ownerID, args.CodeID)
	if lookupErr != nil {
		notFound := capreg.MCPError("code not found")
		return nil, &notFound
	}
	return buildMergedQuotas(args, cur), nil
}

func (c *codesCapability) lookupOwnedCode(
	ctx context.Context, ownerID, codeID string,
) (*domain.AccessCode, error) {
	cur, err := c.codes.GetByID(ctx, codeID)
	if err != nil {
		return nil, fmt.Errorf("get code: %w", err)
	}
	if cur.OwnerID != ownerID {
		return nil, domain.ErrCodeInvalid
	}
	return &cur, nil
}

func buildMergedQuotas(args *updateQuotasArgsWire, cur *domain.AccessCode) *quotaPair {
	out := &quotaPair{maxMembers: args.MaxMembers, maxTurns: args.MaxTurns}
	if out.maxMembers == nil {
		out.maxMembers = cur.MaxMembers
	}
	if out.maxTurns == nil {
		out.maxTurns = cur.MaxTurnsPerSession
	}
	return out
}
