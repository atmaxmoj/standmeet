// pgtype.UUID 和 string 之间的转换 helper。
// pgx 出来是 16 字节 array；domain 层暴露 string（hex with dashes）。

package postgres

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	uuidStringLen = 36 // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
	uuidDash1     = 8
	uuidDash2     = 13
	uuidDash3     = 18
	uuidDash4     = 23
)

// parseUUID 把 RFC 4122 字符串转 pgtype.UUID。无效输入返回 error；
// session 解码出的 owner_id 字符串走这条路再去 query。
func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, fmt.Errorf("scan uuid: %w", err)
	}
	return u, nil
}

// isUUID —— s 是不是合法 RFC 4122 uuid 串。slug（URL-friendly，含小写字母/连字符
// 但从不是 36 字节 uuid 形态）永不误判为 true，故可安全用来在 uuid-或-slug 寻址间分流。
func isUUID(s string) bool {
	var u pgtype.UUID
	return u.Scan(s) == nil
}

// formatUUID 把 pgtype.UUID 转成 RFC 4122 字符串（"xxxxxxxx-xxxx-..."）。
func formatUUID(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	src := u.Bytes[:]
	buf := make([]byte, uuidStringLen)
	hex.Encode(buf[0:uuidDash1], src[0:4])
	buf[uuidDash1] = '-'
	hex.Encode(buf[uuidDash1+1:uuidDash2], src[4:6])
	buf[uuidDash2] = '-'
	hex.Encode(buf[uuidDash2+1:uuidDash3], src[6:8])
	buf[uuidDash3] = '-'
	hex.Encode(buf[uuidDash3+1:uuidDash4], src[8:10])
	buf[uuidDash4] = '-'
	hex.Encode(buf[uuidDash4+1:uuidStringLen], src[10:16])
	return strings.ToLower(string(buf))
}
