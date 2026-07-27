// asset.go —— owner-uploaded 二进制 (图片/附件) 元数据。bytes 落 MinIO，
// 这里只承载 PG-side 行。posts/wiki/raw 通过 asset_id 引用；URL 由 backend
// 即时 presign，前端不直连 storage 凭证。

package entity

import (
	"errors"
	"time"
)

// Asset —— assets 表的值对象。HolderID 是这张 asset 所属的实体 id
// (post.id / wiki.id / ...)。Owner 通过 holder → holder.owner_id 间接查。
type Asset struct {
	CreatedAt        time.Time
	ID               string
	HolderID         string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	SizeBytes        int64
}

// ErrAssetNotFound —— asset id 不存在 / 不属于该 owner。
var ErrAssetNotFound = errors.New("asset not found")
