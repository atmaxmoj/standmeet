// booker_gateway.go —— #135 constrained-reachback:booker 外置到沙箱后,host 侧不再跑
// booker 的业务逻辑(旧 booker_socket.go 的 RegisterBookerSocket 那套已删)。这里只把
// **固定词表 reach-back 网关**挂上 booker 的 socket:沙箱里的 booker 经它调 connector.invoke
// (日历/邮件)、capstore(自己的隔离预约存储)、owner.meta(时区/名字)。host 认不得 "booking"。
//
// capstore 绑死到 (mcp, "calendar.book")—— 沙箱填不了别的命名空间。schema 装机时 provision。

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/capstore"
	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
	connectorroutes "github.com/atmaxmoj/standmeet/internal/routes/connector"
	ownerroutes "github.com/atmaxmoj/standmeet/internal/routes/owner"
)

// policyDoc —— booker capstore "policy" collection 的落盘形状。json 键跟沙箱 booker 的
// bookingPolicy 一致,owner 经此写、沙箱 booker 经 loadPolicy 读同一份文档。
type policyDoc struct {
	OwnerID           string   `json:"owner_id"`
	WorkingHoursStart string   `json:"working_hours_start"`
	WorkingHoursEnd   string   `json:"working_hours_end"`
	AllowedWeekdays   []string `json:"allowed_weekdays"`
	MinLeadDays       int32    `json:"min_lead_days"`
	BufferMin         int32    `json:"buffer_min"`
}

// bookerPolicyStore —— admin /booking-policy 的存储后端:owner 的预约政策存 booker 的隔离
// capstore(policy 单一来源;沙箱 booker 也读它)。核心不再有 booking_policy 表参与。
type bookerPolicyStore struct{ store *capstore.Store }

func newBookerPolicyStore(d *runtimeDeps) bookerPolicyStore {
	return bookerPolicyStore{store: capstore.New(d.db)}
}

// Get —— owner 的政策;没设过 → 默认(跟沙箱 booker 的 defaultBookingPolicy 一致)。
func (b bookerPolicyStore) Get(ctx context.Context, ownerID string) (booker.BookingPolicy, error) {
	filter, ferr := json.Marshal(map[string]string{"owner_id": ownerID})
	if ferr != nil {
		return booker.BookingPolicy{}, fmt.Errorf("policy filter: %w", ferr)
	}
	recs, qerr := b.store.Query(ctx, bookerCapKind, bookerCapID, "policy", filter)
	if qerr != nil {
		return booker.BookingPolicy{}, fmt.Errorf("policy get: %w", qerr)
	}
	if len(recs) == 0 {
		return booker.DefaultBookingPolicy(ownerID), nil
	}
	var doc policyDoc
	if uerr := json.Unmarshal(recs[0], &doc); uerr != nil {
		return booker.BookingPolicy{}, fmt.Errorf("policy decode: %w", uerr)
	}
	return booker.BookingPolicy{
		OwnerID: ownerID, WorkingHoursStart: doc.WorkingHoursStart,
		WorkingHoursEnd: doc.WorkingHoursEnd, AllowedWeekdays: doc.AllowedWeekdays,
		MinLeadDays: doc.MinLeadDays, BufferMin: doc.BufferMin,
	}, nil
}

// Set —— 覆盖 owner 的政策(单例:先删该 owner 旧文档,再插新的)。
func (b bookerPolicyStore) Set(ctx context.Context, ownerID string, p *booker.BookingPolicy) error {
	filter, ferr := json.Marshal(map[string]string{"owner_id": ownerID})
	if ferr != nil {
		return fmt.Errorf("policy filter: %w", ferr)
	}
	if _, derr := b.store.Delete(ctx, bookerCapKind, bookerCapID, "policy", filter); derr != nil {
		return fmt.Errorf("policy clear: %w", derr)
	}
	doc, merr := json.Marshal(policyDoc{
		OwnerID: ownerID, WorkingHoursStart: p.WorkingHoursStart,
		WorkingHoursEnd: p.WorkingHoursEnd, AllowedWeekdays: p.AllowedWeekdays,
		MinLeadDays: p.MinLeadDays, BufferMin: p.BufferMin,
	})
	if merr != nil {
		return fmt.Errorf("policy encode: %w", merr)
	}
	if _, ierr := b.store.Insert(ctx, bookerCapKind, bookerCapID, "policy", doc); ierr != nil {
		return fmt.Errorf("policy set: %w", ierr)
	}
	return nil
}

// bookerCapID —— booker 的 capstore 归属(schema = mcp_calendar_book)。
const bookerCapKind = capstore.KindMCP

var bookerCapID = "calendar.book"

// bookerCapStore —— 把通用 capstore.Store 绑死到 booker 的隔离命名空间(接口里没 kind/id)。
type bookerCapStore struct{ store *capstore.Store }

func (b bookerCapStore) Insert(
	ctx context.Context, collection string, doc json.RawMessage,
) (string, error) {
	id, err := b.store.Insert(ctx, bookerCapKind, bookerCapID, collection, doc)
	if err != nil {
		return "", fmt.Errorf("booker capstore insert: %w", err)
	}
	return id, nil
}

func (b bookerCapStore) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := b.store.Query(ctx, bookerCapKind, bookerCapID, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("booker capstore query: %w", err)
	}
	return docs, nil
}

func (b bookerCapStore) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Count(ctx, bookerCapKind, bookerCapID, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("booker capstore count: %w", err)
	}
	return n, nil
}

func (b bookerCapStore) Delete(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Delete(ctx, bookerCapKind, bookerCapID, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("booker capstore delete: %w", err)
	}
	return n, nil
}

// wireBookerGateway —— provision booker 的隔离 schema + 把固定词表网关挂上 booker.sock。
func wireBookerGateway(ctx context.Context, d *runtimeDeps) {
	store := capstore.New(d.db)
	if perr := store.Provision(ctx, bookerCapKind, bookerCapID); perr != nil {
		d.log.Error("booker capstore provision", "err", perr)
		return
	}
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("booker socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/booker.sock", d.log)
	if err != nil {
		d.log.Error("booker socket listen", "err", err)
		return
	}
	connectorroutes.RegisterInvokeOp(srv, d.connectorSlots)
	capstoreroutes.RegisterOps(srv, bookerCapStore{store: store})
	ownerroutes.RegisterOwnerMetaOp(srv, d.ownerRepo)
	go srv.Serve(ctx)
}

// bookerQuotaStore —— adminroutes.BookingQuotaStore 的实现:admin 发码/改配额/列表读写 booker
// 自己的 per-code 预约配额(落 booker capstore)。内核 access_code 不再有 MaxBookings。
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

// bookingCodeConfig —— booker 自己管的 per-code 配置(#135: 能力自己管自己)。owner 发码时设的
// 预约配额/通知**不进内核 access_code**,由 booker 存进自己的隔离 capstore("code_config" collection,
// keyed by code_id)。host 侧的 quota 闸 + 沙箱侧的 notify 都读它。
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

// setBookingCodeConfig —— 发码时把 booking 的 per-code 配置写进 booker 自己的 capstore(先删后插,
// 单例)。max_bookings 为空且不通知 → 不写(无配置 = 不闸/不通知)。
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
		return nil // 无配置 = 只清不写
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

// bookingCodeConfigOf —— 读某 code 的 booking 配置(没设过 → nil)。
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

// bookerQuotaGate —— #135:quota 闸留在 host,上限从 booker 自己的 capstore("code_config")读、
// count 也在自己的 "bookings" 数(能力自己管自己;内核不再有 MaxBookings)。达上限 → 隐藏 tool
// (hide,不 error-on-use)。无配置/无上限/无 code → 不闸。核心仍不认 "booking"。
func bookerQuotaGate(d *runtimeDeps) capreg.SessionGate {
	store := capstore.New(d.db)
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		return bookingWithinQuota(ctx, store, in.CodeID)
	}
}

func bookingWithinQuota(ctx context.Context, store *capstore.Store, codeID string) (bool, error) {
	cfg, cerr := bookingCodeConfigOf(ctx, store, codeID)
	if cerr != nil {
		return false, cerr
	}
	if noBookingLimit(cfg) {
		return true, nil
	}
	count, err := bookerBookingCount(ctx, store, codeID)
	if err != nil {
		return false, err
	}
	return count < int64(*cfg.MaxBookings), nil
}

func noBookingLimit(cfg *bookingCodeConfig) bool {
	return cfg == nil || cfg.MaxBookings == nil || *cfg.MaxBookings <= 0
}

func bookerBookingCount(ctx context.Context, store *capstore.Store, codeID string) (int64, error) {
	filter, merr := json.Marshal(map[string]string{"code_id": codeID})
	if merr != nil {
		return 0, fmt.Errorf("booker quota filter: %w", merr)
	}
	count, cerr := store.Count(ctx, bookerCapKind, bookerCapID, "bookings", filter)
	if cerr != nil {
		return 0, fmt.Errorf("booker quota count: %w", cerr)
	}
	return count, nil
}
