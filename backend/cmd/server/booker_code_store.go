// booker_code_store.go —— booker 自己管的 **per-code 配置**(预约配额 + 是否通知 owner)。
//
// 它落在 booker 自己的隔离 capstore("code_config" collection,按 code_id),**不进内核的
// access_code 表** —— 内核不认识 "booking"。owner 发码时填的那个数字经 access.CodeExtras
// 这个通用口子进出(见 booker_code_config.go)。
//
// 这一整块是**还没还的债**:per-code 的能力配置该跟 per-owner 的 capconfig 一样有通用面,
// 那时候这个文件就没了。现在它是把债摆在明面上,而不是假装不存在。

package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
)

// booker 的 capstore 归属(schema = mcp_calendar_book)。
const bookerCapKind = capstore.KindMCP

var bookerCapID = "calendar.book"

// bookerQuotaStore —— admin 发码 / 改配额 / 列表读写 booker 的 per-code 预约配额。
type bookerQuotaStore struct{ store *capstore.Store }

func newBookerQuotaStore(d *runtimeDeps) bookerQuotaStore {
	return bookerQuotaStore{store: capstore.New(d.db)}
}

func (b bookerQuotaStore) SetMaxBookings(
	ctx context.Context, codeID string, maxBookings *int32,
) error {
	cfg, err := bookingCodeConfigOf(ctx, b.store, codeID)
	if err != nil {
		return err
	}
	notify := false
	if cfg != nil {
		notify = cfg.NotifyOwner
	}
	return setBookingCodeConfig(ctx, b.store,
		&bookingCodeConfig{CodeID: codeID, MaxBookings: maxBookings, NotifyOwner: notify})
}

func (b bookerQuotaStore) MaxBookingsOf(ctx context.Context, codeID string) (*int32, error) {
	cfg, err := bookingCodeConfigOf(ctx, b.store, codeID)
	if err != nil || cfg == nil {
		return nil, err
	}
	return cfg.MaxBookings, nil
}

// bookingCodeConfig —— 一张码上 booker 那几个字段。
type bookingCodeConfig struct {
	MaxBookings *int32 `json:"max_bookings,omitempty"`
	CodeID      string `json:"code_id"`
	NotifyOwner bool   `json:"notify_owner"`
}

const bookingCodeConfigColl = "code_config"

func codeConfigFilter(codeID string) (json.RawMessage, error) {
	f, err := json.Marshal(map[string]string{"code_id": codeID})
	if err != nil {
		return nil, fmt.Errorf("code_config filter: %w", err)
	}
	return f, nil
}

// setBookingCodeConfig —— 先删后插(单例)。没配额也不通知 → 只清不写:无配置 = 不闸不通知。
func setBookingCodeConfig(
	ctx context.Context, store *capstore.Store, cfg *bookingCodeConfig,
) error {
	if cfg.CodeID == "" {
		return nil
	}
	if err := clearCodeConfig(ctx, store, cfg.CodeID); err != nil {
		return err
	}
	if cfg.MaxBookings == nil && !cfg.NotifyOwner {
		return nil
	}
	return insertCodeConfig(ctx, store, cfg)
}

func clearCodeConfig(ctx context.Context, store *capstore.Store, codeID string) error {
	filter, ferr := codeConfigFilter(codeID)
	if ferr != nil {
		return ferr
	}
	if _, derr := store.Delete(
		ctx, bookerCapKind, bookerCapID, bookingCodeConfigColl, filter,
	); derr != nil {
		return fmt.Errorf("code_config clear: %w", derr)
	}
	return nil
}

func insertCodeConfig(ctx context.Context, store *capstore.Store, cfg *bookingCodeConfig) error {
	doc, merr := json.Marshal(cfg)
	if merr != nil {
		return fmt.Errorf("code_config encode: %w", merr)
	}
	if _, ierr := store.Insert(
		ctx, bookerCapKind, bookerCapID, bookingCodeConfigColl, doc,
	); ierr != nil {
		return fmt.Errorf("code_config set: %w", ierr)
	}
	return nil
}

// bookingCodeConfigOf —— 读某张码的配置(没设过 → nil)。
func bookingCodeConfigOf(
	ctx context.Context, store *capstore.Store, codeID string,
) (*bookingCodeConfig, error) {
	if codeID == "" {
		return nil, nil //nolint:nilnil // 无 code = 无配置,不是错误
	}
	filter, ferr := codeConfigFilter(codeID)
	if ferr != nil {
		return nil, ferr
	}
	recs, qerr := store.Query(ctx, bookerCapKind, bookerCapID, bookingCodeConfigColl, filter)
	if qerr != nil {
		return nil, fmt.Errorf("code_config get: %w", qerr)
	}
	return decodeCodeConfig(recs)
}

func decodeCodeConfig(recs []json.RawMessage) (*bookingCodeConfig, error) {
	if len(recs) == 0 {
		return nil, nil //nolint:nilnil // 没设过 = nil
	}
	var cfg bookingCodeConfig
	if uerr := json.Unmarshal(recs[0], &cfg); uerr != nil {
		return nil, fmt.Errorf("code_config decode: %w", uerr)
	}
	return &cfg, nil
}
