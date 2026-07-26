// recovery.go —— #100 account recovery phrase。
//
// GenerateRecovery(authed):生成高熵 phrase → 只存 hash(bcrypt,复用 password hasher)→ 明文
// **只**发到 owner 邮箱(走 owner 自己的 mail connector,SMTP 凭据不出 vault)。
// Recover(public):锁在外面时拿 {email, phrase} 对 hash,对上 → 作废(单次)→ 发 owner session。
// 公开端点 brute-force 面由 route 层 login-guard 限速;这层只做「验对 → 换 session」。

package usecases

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/session"
)

const (
	// recoveryPhraseBytes —— 128-bit 随机,base32 化后约 26 字符,brute-force 不可行。
	recoveryPhraseBytes = 16
	// phraseGroupLen —— readable 分组:每 4 字符一个连字符段(k7m2-9xqp-…)。
	phraseGroupLen = 4
)

// RecoveryDeps —— recovery 依赖。Owners=读写 recovery_hash + creds;Sessions=recover 后发 session;
// Proxy=走 owner SMTP 把 phrase 邮出去。
type RecoveryDeps struct {
	Owners   *postgres.OwnerRepo
	Sessions *session.OwnerSessionStore
	Proxy    OutboundSender
}

// RecoverInput —— 公开 /recover 入参。
type RecoverInput struct {
	Email  string
	Phrase string
}

// RecoverOutput —— recover 成功后的 session(跟 Login 一致,route 落 cookie)。
type RecoverOutput struct {
	SessionToken string
	CSRFToken    string
	OwnerID      string
	OwnerHandle  string
}

// GenerateRecovery —— 生成 phrase、存 hash、把明文邮给 owner。要求已配 mail connector(否则 Send 报错)。
func GenerateRecovery(ctx context.Context, deps *RecoveryDeps, ownerID string) error {
	owner, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("recovery owner lookup: %w", err)
	}
	phrase, serr := storeNewRecovery(ctx, deps, ownerID)
	if serr != nil {
		return serr
	}
	if merr := deps.Proxy.Send(ctx, ownerID, OutboundMessage{
		To:      owner.Email,
		Subject: "Your StandMeet recovery phrase",
		Body:    recoveryEmailBody(phrase),
	}); merr != nil {
		return fmt.Errorf("send recovery phrase: %w", merr)
	}
	return nil
}

// storeNewRecovery —— 生成 phrase + hash + 存,返明文 phrase(给邮件)。
func storeNewRecovery(ctx context.Context, deps *RecoveryDeps, ownerID string) (string, error) {
	phrase, perr := newRecoveryPhrase()
	if perr != nil {
		return "", perr
	}
	hash, herr := session.HashPassword(phrase)
	if herr != nil {
		return "", fmt.Errorf("hash recovery phrase: %w", herr)
	}
	if serr := deps.Owners.SetRecoveryHash(ctx, ownerID, hash); serr != nil {
		return "", fmt.Errorf("store recovery hash: %w", serr)
	}
	return phrase, nil
}

// Recover —— {email, phrase} 对上 recovery_hash → 作废(单次)→ 发 session。任何不对 → ErrUnauthorized
// (不区分「无此邮箱 / 没生成过 / phrase 错」,防枚举)。
func Recover(ctx context.Context, deps *RecoveryDeps, in *RecoverInput) (RecoverOutput, error) {
	if in.Email == "" || in.Phrase == "" {
		return RecoverOutput{}, ErrEmptyField
	}
	creds, verr := verifyRecovery(ctx, deps, in)
	if verr != nil {
		return RecoverOutput{}, verr
	}
	return issueRecovered(ctx, deps, &creds)
}

// verifyRecovery —— email + phrase 对 recovery_hash。任何失败一律 ErrUnauthorized(防枚举)。
func verifyRecovery(
	ctx context.Context, deps *RecoveryDeps, in *RecoverInput,
) (postgres.Credentials, error) {
	creds, err := deps.Owners.GetCredentialsByEmail(ctx, in.Email)
	if err != nil {
		return postgres.Credentials{}, ownerdomain.ErrUnauthorized
	}
	if creds.RecoveryHash == "" {
		return postgres.Credentials{}, ownerdomain.ErrUnauthorized
	}
	if vperr := session.VerifyPassword(in.Phrase, creds.RecoveryHash); vperr != nil {
		return postgres.Credentials{}, ownerdomain.ErrUnauthorized
	}
	return creds, nil
}

// issueRecovered —— 单次用:先作废 recovery_hash 再发 session(并发也只有一个成)。
func issueRecovered(
	ctx context.Context, deps *RecoveryDeps, creds *postgres.Credentials,
) (RecoverOutput, error) {
	if cerr := deps.Owners.ClearRecoveryHash(ctx, creds.OwnerID); cerr != nil {
		return RecoverOutput{}, fmt.Errorf("clear recovery: %w", cerr)
	}
	issued, ierr := deps.Sessions.Issue(ctx, creds.OwnerID)
	if ierr != nil {
		return RecoverOutput{}, fmt.Errorf("issue recovered session: %w", ierr)
	}
	return RecoverOutput{
		SessionToken: issued.Token, CSRFToken: issued.Data.CSRFToken,
		OwnerID: creds.OwnerID, OwnerHandle: creds.Handle,
	}, nil
}

// newRecoveryPhrase —— 128-bit 随机 → base32 小写 → 4 字符一组连字符(readable,如 k7m2-9xqp-…)。
func newRecoveryPhrase() (string, error) {
	b := make([]byte, recoveryPhraseBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("recovery rand: %w", err)
	}
	raw := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	groups := make([]string, 0, len(raw)/phraseGroupLen+1)
	for i := 0; i < len(raw); i += phraseGroupLen {
		end := min(i+phraseGroupLen, len(raw))
		groups = append(groups, raw[i:end])
	}
	return strings.Join(groups, "-"), nil
}

func recoveryEmailBody(phrase string) string {
	return strings.Join([]string{
		"Someone (hopefully you) generated an account recovery phrase for your StandMeet instance.",
		"",
		"phrase: " + phrase,
		"",
		"Keep it safe. If you're ever locked out, enter your email + this phrase on the recovery " +
			"page to sign back in. It works once.",
	}, "\n")
}
