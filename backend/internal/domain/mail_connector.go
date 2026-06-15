package domain

import "time"

// MailProvider —— v1 唯一的 mail connector provider(owner 自带 SMTP)。
const MailProvider = "smtp"

// MailConnector —— owner 的出站 SMTP 配置(明文 in-memory representation;
// username/password 在 repo 边界加解密)。v1 provider 恒为 "smtp",owner 自带
// SMTP 服务器(Gmail app 密码 / Postmark / Fastmail …),无第三方 SaaS 绑定。
type MailConnector struct {
	// ConnectedAt —— OTP 验证通过过的时间;nil = 存了凭据但还没验过。
	ConnectedAt *time.Time
	// OTPExpiresAt —— 当前待验 OTP 的过期时刻;nil = 没有待验 OTP。
	OTPExpiresAt *time.Time
	OwnerID      string
	Provider     string
	Host         string
	Username     string
	Password     string
	FromAddress  string
	FromName     string
	// OTPHash —— 当前待验 OTP 的 sha256;nil/空 = 没有待验 OTP。
	OTPHash []byte
	Port    int
	// OTPAttempts —— 当前 OTP 已错的次数;达 MailOTPMaxAttempts 即作废。
	OTPAttempts int
}

// HasCredentials —— owner 已填 host + from(SMTP 已配置,可能没 test 过)。
func (c *MailConnector) HasCredentials() bool {
	return c.Host != "" && c.FromAddress != ""
}

// Connected —— 配置完整且 test send 验证过凭据可用。
func (c *MailConnector) Connected() bool {
	return c.HasCredentials() && c.ConnectedAt != nil
}
