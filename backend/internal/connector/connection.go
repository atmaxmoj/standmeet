package connector

import "time"

// Connection —— 一个连接器对某 owner 的**解密后**连接状态（#155 统一连接器层）。
// repo 边界解密后给出，凭据明文只在 connector 层内存活、不进 usecases。Credentials 是解密后的
// 凭据 JSON，按 kind 解（openapi oauth2 {client_id,client_secret} / apiKey {key} / smtp config）。
type Connection struct {
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
	// Unreadable —— 这一行的密文这台实例解不开了（换过 INSTANCE_SECRET，或者密文被动过）。
	//
	// **为什么是一个状态位而不是一个错误**（F-C-41）：轮换密钥之后 `connectors.list` 整个 500，
	// 界面把它当成「列表是空的」，于是**每一张卡**都渲成「你没连过」——而库里密文和 connected_at
	// 都还在。owner 会在一份自己没读到的配置上面动手。
	//
	// 行的**身份**是明文列（connector_id / category / kind），读不出来的只有密钥。所以这一行
	// 该照常回去、照常说自己是谁，只是带着「重新连一下」这句话。
	//
	// ⚠️ 别指望区分「被篡改」和「换了密钥」：AES-GCM 的认证失败在密码学上就是同一件事。
	// 这一位同时覆盖两种世界，那句话也要同时说得通。
	Unreadable bool
}
