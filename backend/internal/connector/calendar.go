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
	token, err := p.freshToken(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	busy, ferr := p.client.FreeBusy(ctx, &gcal.FreeBusyInput{
		AccessToken: token, TimeMin: req.TimeMin, TimeMax: req.TimeMax,
		CalendarIDs: []string{"primary"}, TimeZone: "UTC",
	})
	if ferr != nil {
		return nil, fmt.Errorf("freebusy: %w", ferr)
	}
	out := make([]usecases.BusyInterval, 0, len(busy))
	for i := range busy {
		out = append(out, usecases.BusyInterval{Start: busy[i].Start, End: busy[i].End})
	}
	return out, nil
}

// InsertEvent —— 在 owner 主日历建事件。
func (p *CalendarProxy) InsertEvent(
	ctx context.Context, ownerID string, req usecases.InsertEventReq,
) (usecases.InsertedEvent, error) {
	token, err := p.freshToken(ctx, ownerID)
	if err != nil {
		return usecases.InsertedEvent{}, err
	}
	atts, send := attendeesFor(req.VisitorEmail)
	ins, ierr := p.client.InsertEvent(ctx, &gcal.InsertEventInput{
		AccessToken: token, CalendarID: "primary",
		Summary: req.Summary, Description: req.Description,
		Start: req.Start, End: req.End, TimeZone: req.TimeZone,
		Attendees: atts, SendUpdates: send,
	})
	if ierr != nil {
		return usecases.InsertedEvent{}, fmt.Errorf("insert event: %w", ierr)
	}
	return usecases.InsertedEvent{EventID: ins.EventID, HTMLLink: ins.HTMLLink}, nil
}

// DeleteEvent —— 删事件（404/410 由 gcal client 吸收成 nil）。attendeeEmail
// 非空 → sendUpdates=all 通知取消。
func (p *CalendarProxy) DeleteEvent(ctx context.Context, ownerID, eventID, attendeeEmail string) error {
	token, err := p.freshToken(ctx, ownerID)
	if err != nil {
		return err
	}
	_, send := attendeesFor(attendeeEmail)
	if derr := p.client.DeleteEvent(ctx, &gcal.DeleteEventInput{
		AccessToken: token, CalendarID: "primary", EventID: eventID, SendUpdates: send,
	}); derr != nil {
		return fmt.Errorf("delete event: %w", derr)
	}
	return nil
}

func attendeesFor(email string) ([]gcal.EventAttendee, string) {
	if email == "" {
		return []gcal.EventAttendee{}, "none"
	}
	return []gcal.EventAttendee{{Email: email}}, "all"
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
	resp, rerr := p.client.RefreshToken(ctx, gcal.RefreshTokenInput{
		ClientID: conn.ClientID, ClientSecret: conn.ClientSecret, RefreshToken: conn.RefreshToken,
	})
	if rerr != nil {
		if errors.Is(rerr, gcal.ErrInvalidGrant) {
			return "", domain.ErrCalendarRevoked
		}
		return "", fmt.Errorf("refresh token: %w", rerr)
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
