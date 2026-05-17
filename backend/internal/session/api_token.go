// api_token.go —— API token 生成 + 哈希。
//
// 格式：`smk_<24-char-base32>`，明文只在创建那一刻返回一次，DB 存 sha256 hex。
// 对齐 youteacher 简化：无 scope（schema 占位 *）、无 prefix UI 字段、撤销 = 硬删。

package session

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	apiTokenPlaintextBytes = 15 // 24-char base32 时正好 15 字节 raw
	apiTokenPrefix         = "smk_"
)

// NewAPIToken 生成 plaintext API token。
func NewAPIToken() (string, error) {
	buf := make([]byte, apiTokenPlaintextBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	// base32 不带 padding，lowercase 让 owner 抄起来不会大小写混乱。
	encoded := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf))
	return apiTokenPrefix + encoded, nil
}

// HashAPIToken 对明文 token 算 sha256 hex；DB 存这个比对登录请求时的 hash。
func HashAPIToken(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}
