// pgtype.UUID 和 string 之间的转换 helper。
// pgx 出来是 16 字节 array；domain 层暴露 string（hex with dashes）。

package postgres

import (
	"encoding/hex"
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

// formatUUID 把 pgtype.UUID 转成 RFC 4122 字符串（"xxxxxxxx-xxxx-..."）。
// 未来 milestone 需要从 string 转 pgtype.UUID 时再加 parseUUID。
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
