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

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	capconfigroutes "github.com/atmaxmoj/standmeet/internal/routes/capconfig"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
	connectorroutes "github.com/atmaxmoj/standmeet/internal/routes/connector"
	ownerroutes "github.com/atmaxmoj/standmeet/internal/routes/owner"
)

// 预约**策略**的读写不在这儿了 —— 它是 booker 自己的配置:字段和默认值声明在 booker 的
// manifest(Config),值经通用的 capconfig 存进 booker 自己的隔离存储,沙箱经 capconfig.get
// 读回。host 这一侧曾经有一份 policyDoc + bookerPolicyStore + 自己的默认值兜底,注释还写着
// "跟沙箱 defaultBookingPolicy 一致" —— 实际不一致(host 到 18:00、缓冲 15;沙箱 17:00、缓冲 0)。

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
	// 沙箱经它读自己的配置(声明的默认值已经兜好)。没有这条,沙箱就只能自己再写一份默认值。
	capconfigroutes.RegisterOps(srv, bookerConfig(store))
	ownerroutes.RegisterOwnerMetaOp(srv, d.ownerRepo)
	go srv.Serve(ctx)
}

// bookerConfig —— 绑死到 booker 命名空间 + booker 声明的配置读口。
func bookerConfig(store *capstore.Store) boundCapConfig {
	return boundCapConfig{
		cfg:  capconfig.New(store, bookerCapKind, bookerCapID),
		decl: bookerManifest().Config,
	}
}

// boundCapConfig —— capconfigroutes.BoundConfig 的实现:构造期绑死 (kind,id,声明),
// 沙箱那侧只能问"我的配置",填不了别人的。
type boundCapConfig struct {
	cfg  *capconfig.Store
	decl []mcpplugin.ConfigField
}

func (b boundCapConfig) Values(
	ctx context.Context, ownerID string,
) (map[string]json.RawMessage, error) {
	values, err := b.cfg.Values(ctx, ownerID, b.decl)
	if err != nil {
		return nil, fmt.Errorf("booker config: %w", err)
	}
	return values, nil
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
