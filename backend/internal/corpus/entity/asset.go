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
	// Kind —— 'image'(正文配图 / hero)| 'attachment'(可下载的附件)。
	// 收什么类型、多大按它分:一段视频天生比一张图大,同一个数卡两者等于禁掉视频。
	Kind      string
	SizeBytes int64
}

// 素材的种类 —— 收什么类型、多大按它分。
const (
	AssetKindImage      = "image"      // 正文配图 / hero
	AssetKindAttachment = "attachment" // 可下载的附件(PDF 等)
)

// ErrEntryNotFound —— 按 id 找一条语料未命中(**跨 genre**)。素材挂在语料上,而挂的时候
// 只有 id;每个 genre 各有一个 not-found 哨兵,但"素材要挂的那条不在"是同一件事。
var ErrEntryNotFound = errors.New("corpus entry not found")

// ErrAssetNotFound —— asset id 不存在 / 不属于该 owner。
var ErrAssetNotFound = errors.New("asset not found")

// NoteHero —— 一条 note 的 hero 区,以及正文(里面带着 standmeet-asset 引用)。
//
// hero 不是"一张图":设计里是图 + 压在图上那句话 + 色调三样一起。三样都在共享的
// corpus_notes 表上,所以**任意 genre 都能有** —— 以前只有 writing 那条路写它们。
type NoteHero struct {
	Body          string
	CoverAssetID  string
	CoverHeadline string
	CoverHue      string
}

// ErrMediaRejected —— 这份素材不收(类型不在白名单 / 字节与声明不符 / 超上限 / 取不到 /
// 非 https)。都是**调用方给的东西**的问题,不是本机故障 —— 面上该翻成 4xx。
var ErrMediaRejected = errors.New("media rejected")
