// protocol_smtp_test.go —— 后端内部 UT：SMTP protocol 连接器真实现 MailProxy，未配 → 友好
// ErrMailNotConfigured，连接状态委托 vault。真发信（net/smtp）由 e2e 覆盖。

package connector_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type fakeSMTPVault struct {
	cfg       connector.SMTPConfig
	connected bool
}

func (v *fakeSMTPVault) Connected(_ context.Context, _, _ string) (bool, error) {
	return v.connected, nil
}

func (v *fakeSMTPVault) SMTPConfig(_ context.Context, _, _ string) (connector.SMTPConfig, error) {
	return v.cfg, nil
}

func TestSMTPConnector_NotConfigured_Friendly(t *testing.T) {
	t.Parallel()
	c := connector.NewSMTPConnector("smtp", &fakeSMTPVault{})
	mp, ok := c.(contract.MailProxy)
	if !ok {
		t.Fatalf("smtp connector is not a MailProxy: %T", c)
	}
	err := mp.Send(context.Background(), "owner-1", contract.MailMessage{
		To: "v@example.com", Subject: "hi", Body: "hello",
	})
	if !errors.Is(err, usecases.ErrMailNotConfigured) {
		t.Fatalf("unconfigured send should be ErrMailNotConfigured, got %v", err)
	}
}

func TestSMTPConnector_ConnectedDelegates(t *testing.T) {
	t.Parallel()
	c := connector.NewSMTPConnector("smtp", &fakeSMTPVault{connected: true})
	ok, err := c.Connected(context.Background(), "owner-1")
	if err != nil || !ok {
		t.Fatalf("Connected should delegate true, got ok=%v err=%v", ok, err)
	}
}
