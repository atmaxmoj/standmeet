// cap_codes.go —— Phase B-6 parity pilot: codes.revoke 通过 MCP 暴露。
// owner 现在在 admin UI 也能 revoke，但 owner 的 AI 客户端 (Claude Code 等)
// 没法 revoke —— 这是 MCP parity 缺口的一个具体填补。
//
// 后续 B-6 增量提交可加 codes.create / codes.update_quotas / codes.list /
// page.update_handle / corpus.update_wiki / calendar.list_slots /
// calendar.cancel_booking 等其他 parity 缺口。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
)

const capCodesBundle = "codes.bundle"

// CodesRevoker —— codes.bundle capability 需要的窄接口 (avoid 直接 import
// postgres.CodeRepo)。GetByID 用来验存在；Revoke 本身的 SQL 是 idempotent
// (0-row update 不报错) —— 直接给 owner AI 调会"撤销不存在的 code 也返
// 成功"，混淆。这里先 GetByID 校存在，OwnerID 一致才放过。
type CodesRevoker interface {
	GetByID(ctx context.Context, codeID string) (domain.AccessCode, error)
	Revoke(ctx context.Context, ownerID, codeID string) error
}

type codesCapability struct {
	codes CodesRevoker
	log   *slog.Logger
}

func newCodesCapability(codes CodesRevoker, log *slog.Logger) *codesCapability {
	return &codesCapability{codes: codes, log: log}
}

func (*codesCapability) ID() string               { return capCodesBundle }
func (*codesCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*codesCapability) VisitorBinding(_ context.Context, _ *agentskills.AssembleInput) (
	*agentskills.Binding, error,
) {
	return nil, agentskills.ErrHidden
}

func (*codesCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *codesCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{c.revokeBinding()}
}

func (c *codesCapability) revokeBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	args, perr := parseRevokeArgs(raw)
	if perr != nil {
		return agentskills.MCPError(perr.Error())
	}
	if existsErr := c.ensureCodeExists(ctx, ownerID, args.CodeID); existsErr != nil {
		return codesRevokeErr(c.log, existsErr)
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

// ensureCodeExists —— GetByID 返 ErrCodeInvalid → 透传 (handler 翻"code
// not found")；找到但 owner 不匹 → ErrCodeInvalid (不泄露存在性)；DB 故
// 障 → 透传 (handler 走 internal error)。
func (c *codesCapability) ensureCodeExists(
	ctx context.Context, ownerID, codeID string,
) error {
	code, err := c.codes.GetByID(ctx, codeID)
	if err != nil {
		if errors.Is(err, domain.ErrCodeInvalid) {
			return domain.ErrCodeInvalid
		}
		return fmt.Errorf("get code: %w", err)
	}
	if code.OwnerID != ownerID {
		return domain.ErrCodeInvalid
	}
	return nil
}

func codesRevokeErr(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrCodeInvalid) {
		return agentskills.MCPError("code not found")
	}
	log.Error("codes.revoke", "err", err)
	return agentskills.MCPError("revoke failed")
}

func marshalRevokeResult(log *slog.Logger, codeID string) agentskills.MCPResult {
	out, err := json.Marshal(revokeResultPayload{CodeID: codeID, Revoked: true})
	if err != nil {
		log.Error("codes.revoke marshal", "err", err)
		return agentskills.MCPError("encode payload")
	}
	return agentskills.MCPSuccess(string(out))
}
