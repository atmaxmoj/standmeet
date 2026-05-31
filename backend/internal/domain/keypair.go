// keypair.go —— Phase C: Owner Ed25519 keypair domain value。私钥永远不
// 入 domain (owner 自己保管 PEM)；本结构只承载 owner 看得到的 metadata +
// backend 验签需要的公钥 PEM。
//
// 撤销 = hard delete (无 status 字段)。对齐 youteacher 极简风格。

package domain

import (
	"errors"
	"time"
)

// ErrKeypairUnauthorized —— 通用 sigv1 验失败 (key 不存在 / sig 不通 /
// ts 超窗口 / header 形态错)。caller 翻 HTTP 401。
var ErrKeypairUnauthorized = errors.New("keypair: unauthorized")

// OwnerKeypair —— DB 一行。PublicKeyPEM 用 PKCS8 Ed25519 编码。
type OwnerKeypair struct {
	LastUsedAt   *time.Time
	CreatedAt    time.Time
	ID           string
	OwnerID      string
	KeyID        string
	PublicKeyPEM string
	Label        string
}

// OwnerKeypairMetadata —— admin list 用：去掉 PEM + ownerID，只剩 owner UI
// 关心的字段。永远不返公钥 (owner 已下载 PEM 自己保管，不需要看 server side)。
type OwnerKeypairMetadata struct {
	LastUsedAt *time.Time
	CreatedAt  time.Time
	ID         string
	KeyID      string
	Label      string
}
