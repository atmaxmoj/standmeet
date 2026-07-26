// cap_page_pins.go —— page.pin / page.unpin:主页 insights/projects 是 corpus
// 的 pin 列表(docs/design/page-corpus-pinning.md),这里是 owner AI 的装填口。
// 不变量 pinned ⊆ published 由 usecases.PinToPage(唯一维护点)在写入时拒绝
// 未发布条目;这里只做参数解包 + 错误翻译。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func (c *pageCapability) pinBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.pin",
		Description: "Pin a PUBLISHED wiki entry onto the public homepage " +
			"(section: insights | projects). The page renders the entry's title + excerpt " +
			"and links into the reader — content lives in the corpus, never a second copy. " +
			"Pinning an unpublished entry is rejected: publish it first (seo.set_wiki_seo).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"section":{"type":"string","enum":["insights","projects"]},
				"wiki_id":{"type":"string","description":"Wiki entry UUID."}
			},
			"required":["section","wiki_id"]
		}`),
		Handler: c.handlePin,
	}
}

func (c *pageCapability) unpinBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.unpin",
		Description: "Remove a pinned wiki entry from a homepage section " +
			"(section: insights | projects).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"section":{"type":"string","enum":["insights","projects"]},
				"wiki_id":{"type":"string"}
			},
			"required":["section","wiki_id"]
		}`),
		Handler: c.handleUnpin,
	}
}

type pinArgsWire struct {
	Section string `json:"section"`
	WikiID  string `json:"wiki_id"`
}

type pinPayload struct {
	Section string   `json:"section"`
	Pinned  []string `json:"pinned"`
}

func (c *pageCapability) handlePin(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, argErr := decodePinArgs(raw)
	if argErr != nil {
		return capreg.MCPError(argErr.Error())
	}
	pinned, err := usecases.PinToPage(ctx, c.pins, ownerID, args.Section, args.WikiID)
	if err != nil {
		return pinErrToResult(c, "page.pin", err)
	}
	return mcputil.MarshalResult(c.log, "page.pin", &pinPayload{
		Section: args.Section, Pinned: pinned,
	})
}

func (c *pageCapability) handleUnpin(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, argErr := decodePinArgs(raw)
	if argErr != nil {
		return capreg.MCPError(argErr.Error())
	}
	pinned, err := usecases.UnpinFromPage(ctx, c.pins, ownerID, args.Section, args.WikiID)
	if err != nil {
		return pinErrToResult(c, "page.unpin", err)
	}
	return mcputil.MarshalResult(c.log, "page.unpin", &pinPayload{
		Section: args.Section, Pinned: pinned,
	})
}

func decodePinArgs(raw json.RawMessage) (pinArgsWire, error) {
	var args pinArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Section == "" || args.WikiID == "" {
		return args, errors.New("section and wiki_id are required")
	}
	return args, nil
}

func pinErrToResult(c *pageCapability, tool string, err error) capreg.MCPResult {
	if errors.Is(err, ownerdomain.ErrPinUnpublished) {
		return capreg.MCPError(
			"entry is not published — publish it first (seo.set_wiki_seo published:true), " +
				"then pin it")
	}
	if errors.Is(err, ownerdomain.ErrPinNotFound) {
		return capreg.MCPError("wiki entry not found")
	}
	c.log.Error("cap "+tool, "err", err)
	return capreg.MCPError(tool + " failed")
}
