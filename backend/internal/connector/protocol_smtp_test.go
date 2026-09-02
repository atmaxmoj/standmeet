// protocol_smtp_test.go — backend-internal unit test: the SMTP protocol connector actually
// implements MailProxy, not configured → friendly ErrMailNotConfigured, connection state
// delegates to vault. Real sending (net/smtp) is covered by e2e.

package connector_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
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
	_, err := mp.Send(context.Background(), "owner-1", contract.MailMessage{
		To: "v@example.com", Subject: "hi", Body: "hello",
	})
	if !errors.Is(err, consumer.ErrMailNotConfigured) {
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
