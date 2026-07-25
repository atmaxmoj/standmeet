// mail_retry.go —— owner-notify 专用的「重试发信」proxy（D-6 R6）。包一层 MailProxy，
// 对**瞬时传输错**（连接被断/拒/超时/EOF）按 notifyPolicy 后台重试；ErrMailNotConfigured
// 等永久错不重。只 owner-notify 走这层 —— 确认信是同步单发、失败即在卡内报错，**不重**。
// retry 基座只许 connector 用（arch），故重试落这里、不进 usecases/cmd。

package connector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/retry"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// RetryingMailProxy —— 包一个 contract.MailProxy，Send 按 notifyPolicy 重试瞬时传输错。
type RetryingMailProxy struct {
	inner contract.MailProxy
}

// NewRetryingMailProxy —— composition root 注入底层 MailProxy（owner-notify 用）。
func NewRetryingMailProxy(inner contract.MailProxy) *RetryingMailProxy {
	return &RetryingMailProxy{inner: inner}
}

// Connected —— 读类，透传不重。
func (p *RetryingMailProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := p.inner.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("mail connected: %w", err)
	}
	return ok, nil
}

// Send —— 按预算重试瞬时传输错；未达对端的连接错重发安全（owner-notify 非幂等敏感）。
func (p *RetryingMailProxy) Send(
	ctx context.Context, ownerID string, msg contract.MailMessage,
) error {
	if err := retry.Do(ctx, notifyPolicy(), func() error {
		return p.inner.Send(ctx, ownerID, msg)
	}); err != nil {
		return fmt.Errorf("owner notify send: %w", err)
	}
	return nil
}

// mailTransient —— 只重瞬时传输错（连接断/拒/超时/EOF）；ErrMailNotConfigured 等永久错不重。
func mailTransient(err error) bool {
	if err == nil || errors.Is(err, usecases.ErrMailNotConfigured) {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
