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
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/reachback"
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
func (b bookerPolicyStore) Get(ctx context.Context, ownerID string) (domain.BookingPolicy, error) {
	filter, ferr := json.Marshal(map[string]string{"owner_id": ownerID})
	if ferr != nil {
		return domain.BookingPolicy{}, fmt.Errorf("policy filter: %w", ferr)
	}
	recs, qerr := b.store.Query(ctx, bookerCapKind, bookerCapID, "policy", filter)
	if qerr != nil {
		return domain.BookingPolicy{}, fmt.Errorf("policy get: %w", qerr)
	}
	if len(recs) == 0 {
		return domain.DefaultBookingPolicy(ownerID), nil
	}
	var doc policyDoc
	if uerr := json.Unmarshal(recs[0], &doc); uerr != nil {
		return domain.BookingPolicy{}, fmt.Errorf("policy decode: %w", uerr)
	}
	return domain.BookingPolicy{
		OwnerID: ownerID, WorkingHoursStart: doc.WorkingHoursStart,
		WorkingHoursEnd: doc.WorkingHoursEnd, AllowedWeekdays: doc.AllowedWeekdays,
		MinLeadDays: doc.MinLeadDays, BufferMin: doc.BufferMin,
	}, nil
}

// Set —— 覆盖 owner 的政策(单例:先删该 owner 旧文档,再插新的)。
func (b bookerPolicyStore) Set(ctx context.Context, ownerID string, p *domain.BookingPolicy) error {
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

// bookerOwnerMeta —— owner.meta 的后端:白名单字段(gateway 已挡非白名单)从 owner 记录取。
type bookerOwnerMeta struct{ d *runtimeDeps }

func (o bookerOwnerMeta) Meta(ctx context.Context, ownerID, field string) (string, error) {
	owner, err := o.d.ownerRepo.GetByID(ctx, ownerID)
	if err != nil {
		return "", fmt.Errorf("owner.meta get owner: %w", err)
	}
	switch field {
	case "timezone":
		return owner.ProfileTimezone, nil
	case "full_name":
		return owner.FullName, nil
	default:
		return "", fmt.Errorf("owner.meta: field %q not served", field)
	}
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
	deps := &reachback.Deps{
		Connectors: d.connectorSlots,
		Store:      bookerCapStore{store: store},
		Owner:      bookerOwnerMeta{d: d},
	}
	deps.Register(srv)
	go srv.Serve(ctx)
}

// bookerQuotaGate —— #135:quota 闸留在 host,但 booker 的 concretes(collection "bookings"
// + key "code_id")住在 composition root(允许认 concretes),经**通用** capstore.count 数 booker
// 自己隔离命名空间里的预约。达 max_bookings → 隐藏 tool(跟其它闸一致:hide,不 error-on-use)。
// 核心(usecases/inference)仍不认 "booking";只有这里的组装根认得。无 quota/无 code → 不闸。
func bookerQuotaGate(d *runtimeDeps) capreg.SessionGate {
	store := capstore.New(d.db)
	return func(ctx context.Context, in *capreg.AssembleInput) (bool, error) {
		if !hasBookingQuota(in) {
			return true, nil
		}
		count, err := bookerBookingCount(ctx, store, in.CodeID)
		if err != nil {
			return false, err
		}
		return count < int64(*in.MaxBookings), nil
	}
}

func hasBookingQuota(in *capreg.AssembleInput) bool {
	return in.MaxBookings != nil && *in.MaxBookings > 0 && in.CodeID != ""
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
