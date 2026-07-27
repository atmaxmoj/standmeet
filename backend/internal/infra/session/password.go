// Argon2id 密码 hash + verify。
//
// 参数选择对齐设计稿 E.2 推荐：time=3, memory=64 MB, threads=4, keyLen=32。
// 输出格式：$argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
// 这是 standard "PHC" string format，passlib / argon2-cffi 等也认这个。

package session

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    uint32 = 3
	argonMemory  uint32 = 64 * 1024 // KiB
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32
	argonSaltLen        = 16

	// phcFieldCount —— $argon2id$v=...$m=...$salt$hash split by '$' = 6.
	phcFieldCount = 6
)

// ErrPasswordMismatch —— password 不对（不区分用户存在与否，留给 caller 翻译）。
var (
	ErrPasswordMismatch = errors.New("password mismatch")
	errMalformedPHC     = errors.New("verify password: malformed phc string")
)

// HashPassword 用 Argon2id hash + 随机 salt，返回 PHC 字符串。
func HashPassword(plaintext string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}
	key := argon2.IDKey([]byte(plaintext), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
	return encoded, nil
}

// VerifyPassword 用 constant-time compare 校验明文密码与 PHC 字符串。
// 错误时返回 ErrPasswordMismatch（或解析失败的 wrap）。
func VerifyPassword(plaintext, encoded string) error {
	parts := strings.Split(encoded, "$")
	params, err := parsePHC(parts)
	if err != nil {
		return err
	}
	got := argon2.IDKey(
		[]byte(plaintext),
		params.salt,
		params.time, params.memory, params.threads,
		uint32(len(params.want)),
	)
	if subtle.ConstantTimeCompare(params.want, got) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

type phcParams struct {
	salt    []byte
	want    []byte
	memory  uint32
	time    uint32
	threads uint8
}

// parsePHC 把 split 后的 6 段拆成结构化 params。拆成三个 sub-helper 让
// 每个函数 cyclo ≤ 4（cyclop 全局上限 5）。
func parsePHC(parts []string) (phcParams, error) {
	if err := validatePHCFrame(parts); err != nil {
		return phcParams{}, err
	}
	p, err := parsePHCParamLine(parts[3])
	if err != nil {
		return phcParams{}, err
	}
	bytes, err := decodePHCBase64(parts[4], parts[5])
	if err != nil {
		return phcParams{}, err
	}
	p.salt = bytes.salt
	p.want = bytes.want
	return p, nil
}

// phcBytes 把 decodePHCBase64 的两个 []byte 返回打包成单个结构，
// 同时满足 confusing-results 和 nonamedreturns 两个 revive rule。
type phcBytes struct {
	salt []byte
	want []byte
}

func validatePHCFrame(parts []string) error {
	if len(parts) != phcFieldCount {
		return errMalformedPHC
	}
	if parts[1] != "argon2id" {
		return errMalformedPHC
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return fmt.Errorf("verify password: parse version: %w", err)
	}
	return nil
}

func parsePHCParamLine(line string) (phcParams, error) {
	p := phcParams{}
	if _, err := fmt.Sscanf(line, "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return phcParams{}, fmt.Errorf("verify password: parse params: %w", err)
	}
	return p, nil
}

func decodePHCBase64(saltStr, hashStr string) (phcBytes, error) {
	salt, err := base64.RawStdEncoding.DecodeString(saltStr)
	if err != nil {
		return phcBytes{}, fmt.Errorf("verify password: decode salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(hashStr)
	if err != nil {
		return phcBytes{}, fmt.Errorf("verify password: decode hash: %w", err)
	}
	return phcBytes{salt: salt, want: want}, nil
}
