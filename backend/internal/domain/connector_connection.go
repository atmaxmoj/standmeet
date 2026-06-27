package domain

import "time"

// ConnectorConnection —— 一个连接器对某 owner 的**解密后**连接状态（#155 统一连接器层）。
// repo 边界解密后给出，凭据明文只在 connector 层内存活、不进 usecases。Credentials 是解密后的
// 凭据 JSON，按 kind 解（openapi oauth2 {client_id,client_secret} / apiKey {key} / smtp config）。
type ConnectorConnection struct {
	TokenExpiresAt *time.Time
	ConnectorID    string
	Category       string
	Kind           string
	AccessToken    string
	RefreshToken   string
	Credentials    []byte
	Scopes         []string
	Connected      bool
	Active         bool
}
