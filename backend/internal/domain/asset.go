// asset.go —— owner-uploaded 二进制 (图片/附件) 元数据。bytes 落 MinIO，
// 这里只承载 PG-side 行。posts/wiki/raw 通过 asset_id 引用；URL 由 backend
// 即时 presign，前端不直连 storage 凭证。

package domain

import (
	"errors"
	"time"
)

// Asset —— assets 表的值对象。
type Asset struct {
	CreatedAt        time.Time
	ID               string
	OwnerID          string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	SizeBytes        int64
}

// ErrAssetNotFound —— asset id 不存在 / 不属于该 owner。
var ErrAssetNotFound = errors.New("asset not found")
