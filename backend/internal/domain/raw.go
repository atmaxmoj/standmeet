// raw.go —— owner 通过 MCP 推上来的"半成品" corpus 条目（curate 前）。

package domain

import (
	"errors"
	"time"
)

// RawEntry —— owner 通过 MCP push 进 corpus 的"半成品"，未整理。
type RawEntry struct {
	CreatedAt      time.Time
	PromotedTo     *string
	ID             string
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
	Archived       bool
}

// ErrRawNotFound —— 按 id 查 raw 未命中。
var ErrRawNotFound = errors.New("raw entry not found")
