// Package connector —— Phase B：出站、带凭据的连接器层（Nango 式 proxy）。
// 凭据存在 vault（加密落库），只在本层解密 + 代调外部服务；capability/usecases
// 层只拿 ownerID 句柄经 proxy 调，access token 这串值从不出本包。
//
// calendar.go —— Google Calendar proxy：实现 usecases.CalendarProxy。句柄
// (ownerID) → load 连接器 + 解密 + 必要时刷新 token + 调 gcal。
package connector

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// CalendarClient —— gcal.Client 抽象（fake 测试用）。
type CalendarClient interface {
	FreeBusy(ctx context.Context, in *gcal.FreeBusyInput) ([]gcal.BusyWindow, error)
	InsertEvent(ctx context.Context, in *gcal.InsertEventInput) (gcal.InsertedEvent, error)
	DeleteEvent(ctx context.Context, in *gcal.DeleteEventInput) error
	RefreshToken(ctx context.Context, in gcal.RefreshTokenInput) (gcal.TokenResponse, error)
}

// CalendarVault —— 连接器凭据存取（repo 边界解密 → 明文 connector）。
type CalendarVault interface {
	GetConnector(ctx context.Context, ownerID, provider string) (domain.CalendarConnector, error)
	SaveTokens(ctx context.Context, in *SaveTokensInput) error
	// ClearTokens —— soft disconnect：擦 OAuth token，保留 client_id/secret。撤销
	// (invalid_grant) 落库用：连接置 disconnected，下一 session 经单点闸 gate 掉。
	ClearTokens(ctx context.Context, ownerID, provider string) error
}

// SaveTokensInput —— 刷新后回存 token（composition root 把它翻成 postgres input）。
type SaveTokensInput struct {
	OwnerID, Provider, AccessToken, RefreshToken string
	ExpiresAt                                    time.Time
	Scopes                                       []string
}

// CalendarProxy —— 实现 usecases.CalendarProxy。
type CalendarProxy struct {
	client CalendarClient
	vault  CalendarVault
}

// NewCalendarProxy —— composition root 注入 gcal client + vault。
func NewCalendarProxy(client CalendarClient, vault CalendarVault) *CalendarProxy {
	return &CalendarProxy{client: client, vault: vault}
}

// Connected —— 连接器是否可用（有凭据 + 已授权）。
func (p *CalendarProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := p.vault.GetConnector(ctx, ownerID, domain.CalendarProvider)
	if err != nil {
		return false, fmt.Errorf("load connector: %w", err)
	}
	return conn.Connected(), nil
}

// FreeBusy —— owner 主日历忙时段。
func (p *CalendarProxy) FreeBusy(
	ctx context.Context, ownerID string, req usecases.FreeBusyReq,
) ([]usecases.BusyInterval, error) {
	var busy []gcal.BusyWindow
	if ferr := p.callWithAuth(ctx, ownerID, func(token string) error {
		return calendarRetry(ctx, readPolicy(), func() error {
			got, e := p.client.FreeBusy(ctx, &gcal.FreeBusyInput{
				AccessToken: token, TimeMin: req.TimeMin, TimeMax: req.TimeMax,
				CalendarIDs: []string{"primary"}, TimeZone: "UTC",
			})
			busy = got
			if e != nil {
				return fmt.Errorf("freebusy: %w", e)
			}
			return nil
		})
	}); ferr != nil {
		return nil, ferr
	}
	out := make([]usecases.BusyInterval, 0, len(busy))
	for i := range busy {
		out = append(out, usecases.BusyInterval{Start: busy[i].Start, End: busy[i].End})
	}
	return out, nil
}

// InsertEvent —— 在 owner 主日历建事件。
func (p *CalendarProxy) InsertEvent(
	ctx context.Context, ownerID string, req *usecases.InsertEventReq,
) (usecases.InsertedEvent, error) {
	spec := attendeesFor(req.VisitorEmail)
	// 幂等键在重试 / 401-refresh 循环外生成一次、跨重试复用：events.insert 是非幂等
	// 写，瞬时错（含「写后连接断」）盲重试会双订；带同一 id 重发 → 命中已存事件，恰
	// 好一单。
	key, kerr := idempotencyKey()
	if kerr != nil {
		return usecases.InsertedEvent{}, kerr
	}
	var ins gcal.InsertedEvent
	if ierr := p.callWithAuth(ctx, ownerID, func(token string) error {
		return calendarRetry(ctx, writePolicy(), func() error {
			got, e := p.client.InsertEvent(ctx, &gcal.InsertEventInput{
				AccessToken: token, CalendarID: "primary",
				Summary: req.Summary, Description: req.Description,
				Start: req.Start, End: req.End, TimeZone: req.TimeZone,
				Attendees: spec.attendees, SendUpdates: spec.sendUpdates,
				IdempotencyKey: key,
			})
			ins = got
			if e != nil {
				return fmt.Errorf("insert event: %w", e)
			}
			return nil
		})
	}); ierr != nil {
		return usecases.InsertedEvent{}, ierr
	}
	return usecases.InsertedEvent{EventID: ins.EventID, HTMLLink: ins.HTMLLink}, nil
}

// DeleteEvent —— 删事件（404/410 由 gcal client 吸收成 nil）。attendeeEmail
// 非空 → sendUpdates=all 通知取消。
func (p *CalendarProxy) DeleteEvent(
	ctx context.Context, ownerID, eventID, attendeeEmail string,
) error {
	token, err := p.freshToken(ctx, ownerID)
	if err != nil {
		return err
	}
	spec := attendeesFor(attendeeEmail)
	if derr := p.client.DeleteEvent(ctx, &gcal.DeleteEventInput{
		AccessToken: token, CalendarID: "primary", EventID: eventID, SendUpdates: spec.sendUpdates,
	}); derr != nil {
		return fmt.Errorf("delete event: %w", derr)
	}
	return nil
}

// attendeeSpec —— 与会者 + sendUpdates 策略一对（单返回值，避开 unnamedResult
// 与 nonamedreturns 之间的拉锯）。
type attendeeSpec struct {
	sendUpdates string
	attendees   []gcal.EventAttendee
}

func attendeesFor(email string) attendeeSpec {
	if email == "" {
		return attendeeSpec{attendees: []gcal.EventAttendee{}, sendUpdates: "none"}
	}
	return attendeeSpec{attendees: []gcal.EventAttendee{{Email: email}}, sendUpdates: "all"}
}

// callWithAuth —— 跑一次需 token 的 gcal 调用。撞 401（token 被拒：owner 在外部撤销
// 了授权，但 access token 还没到期 → 不会主动刷新）→ 强制刷新一次再重试。强制刷新撞
// invalid_grant → 撤销落库 + ErrCalendarRevoked（撤销→gate 联动）。读写共用。
func (p *CalendarProxy) callWithAuth(
	ctx context.Context, ownerID string, fn func(token string) error,
) error {
	token, err := p.freshToken(ctx, ownerID)
	if err != nil {
		return err
	}
	cerr := fn(token)
	if !errors.Is(cerr, gcal.ErrUnauthorized) {
		return cerr
	}
	fresh, rerr := p.forceRefresh(ctx, ownerID)
	if rerr != nil {
		return rerr
	}
	return fn(fresh)
}

// forceRefresh —— 不论 access token 是否过期，强制刷新一次（401 后用：token 未到期
// 但被外部撤销）。复用 refreshAndStore 的 invalid_grant → 撤销落库逻辑。
func (p *CalendarProxy) forceRefresh(ctx context.Context, ownerID string) (string, error) {
	conn, err := p.vault.GetConnector(ctx, ownerID, domain.CalendarProvider)
	if err != nil {
		return "", fmt.Errorf("load connector: %w", err)
	}
	if !conn.Connected() {
		return "", domain.ErrCalendarNotConnected
	}
	return p.refreshAndStore(ctx, &conn)
}

// freshToken —— load 连接器，过期则刷新 + 回存；invalid_grant → ErrCalendarRevoked。
// access token 明文只在本函数 / 本包内存活，不外泄。
func (p *CalendarProxy) freshToken(ctx context.Context, ownerID string) (string, error) {
	conn, err := p.vault.GetConnector(ctx, ownerID, domain.CalendarProvider)
	if err != nil {
		return "", fmt.Errorf("load connector: %w", err)
	}
	if !conn.Connected() {
		return "", domain.ErrCalendarNotConnected
	}
	if !conn.AccessTokenStale() {
		return conn.AccessToken, nil
	}
	return p.refreshAndStore(ctx, &conn)
}

// refreshAndStore —— token 过期时刷新 + 回存；invalid_grant → ErrCalendarRevoked。
// 从 freshToken 拆出守 cyclop ≤5。
func (p *CalendarProxy) refreshAndStore(
	ctx context.Context, conn *domain.CalendarConnector,
) (string, error) {
	// token refresh 不重试：撞 invalid_grant → 撤销落库 + 友好降级；撞 network/5xx →
	// 友好「稍后再试」（booking 路上的同步操作，快速降级优于多轮退避，决策点 D-6 per-op）。
	resp, rerr := p.client.RefreshToken(ctx, gcal.RefreshTokenInput{
		ClientID:     conn.ClientID,
		ClientSecret: conn.ClientSecret,
		RefreshToken: conn.RefreshToken,
	})
	if rerr != nil {
		return "", p.onRefreshErr(ctx, conn, rerr)
	}
	if serr := p.vault.SaveTokens(ctx, &SaveTokensInput{
		OwnerID: conn.OwnerID, Provider: conn.Provider,
		AccessToken: resp.AccessToken, RefreshToken: resp.RefreshToken,
		ExpiresAt: resp.ExpiresAt, Scopes: conn.Scopes,
	}); serr != nil {
		return "", fmt.Errorf("save refreshed token: %w", serr)
	}
	return resp.AccessToken, nil
}

// onRefreshErr —— 刷新失败归类：invalid_grant → 落库 disconnect（擦 token → 连接
// disconnected，下一 session 经单点闸 gate 掉，撤销→gate 联动）+ ErrCalendarRevoked；
// 落库失败不掩盖撤销，仅记日志。其余原样包。从 refreshAndStore 抽出守 cognitive ≤7。
func (p *CalendarProxy) onRefreshErr(
	ctx context.Context, conn *domain.CalendarConnector, rerr error,
) error {
	if errors.Is(rerr, gcal.ErrInvalidGrant) {
		if cerr := p.vault.ClearTokens(ctx, conn.OwnerID, conn.Provider); cerr != nil {
			slog.Default().Warn("clear tokens after invalid_grant failed",
				"owner", conn.OwnerID, "provider", conn.Provider, "err", cerr)
		}
		return domain.ErrCalendarRevoked
	}
	if gcal.Transient(rerr) { // network/5xx 重试耗尽 → 友好「稍后再试」(E7)
		return domain.ErrCalendarUnavailable
	}
	return fmt.Errorf("calendar: %w", rerr)
}
