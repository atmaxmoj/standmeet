// Package storage —— S3-compatible object storage 客户端。生产用 MinIO
// (self-host)，配置入口 STORAGE_* env。所有 owner-uploaded binary (post
// 封面图 / raw 附件 / custom page 静态资源) 都进这里。
//
// 不直接暴露 minio-go API：上层只看到本包的 Client interface，方便测试时
// 换 in-memory 实现 (e2e 用真 minio 容器跑全链，单元测试可后续注入 fake)。
//
// 对象 key 形态：`<owner_id>/<asset_id>` —— 平坦命名，避免 path traversal；
// 元数据 (content-type / size / original_filename / sha256) 全部落 Postgres
// 的 assets 表，bucket 里只放裸 bytes。
package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// presignTTL —— 公共 GET 链接有效期；前端展示 cover 时刷一次。生产可
// 拉长到 24h 让缓存友好；先给 1h 平衡掉错时钟 + token 泄漏窗口。
const presignTTL = 1 * time.Hour

// PutInput —— Put 的入参打包；revive argument-limit ≤ 5。
type PutInput struct {
	Body        io.Reader
	Key         string
	ContentType string
	Size        int64
}

// Config —— composition root 注入。STORAGE_* env 直接 unmarshal。
// Endpoint 不能空 (composition root fail-fast)；PublicURL 是前端浏览器
// 直连的 host (容器内 endpoint 是 minio:9000，浏览器需 localhost:9200)。
type Config struct {
	Endpoint  string // host:port，不含 scheme
	AccessKey string
	SecretKey string
	Bucket    string
	PublicURL string
	UseSSL    bool
}

// Client —— minio-go 封装。Bucket 在 NewClient 内 idempotent 建好；
// 所有 owner-uploaded binary (post 封面 / raw 附件 / custom page 资源)
// 都进这里。对象 key 形态 "<owner_id>/<asset_id>" 平坦避免 path traversal；
// 元数据 (content-type / size / sha256) 落 Postgres 的 assets 表，bucket
// 里只放裸 bytes。
//
// 两个底层 client 因为 AWS SigV4 把 host 签进 URL —— 内部 Put/Delete
// 用 internal endpoint (minio:9000，容器互通)，浏览器拿到的 presigned
// URL 必须签在 public endpoint (localhost:9200)，不能 mint 后改 host
// 否则签名 invalid。PublicURL 跟 Endpoint 同值时两个 client 等价。
type Client struct {
	internal *minio.Client
	presign  *minio.Client
	bucket   string
}

// NewClient 构造 + 确保 bucket 存在。
func NewClient(ctx context.Context, cfg *Config) (*Client, error) {
	internal, err := buildMinioClient(cfg.Endpoint, cfg)
	if err != nil {
		return nil, err
	}
	presign, perr := buildPresignClient(cfg, internal)
	if perr != nil {
		return nil, perr
	}
	out := &Client{internal: internal, presign: presign, bucket: cfg.Bucket}
	if eerr := out.ensureBucket(ctx); eerr != nil {
		return nil, eerr
	}
	return out, nil
}

func buildMinioClient(endpoint string, cfg *Config) (*minio.Client, error) {
	c, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		// Region 显式给死 (MinIO 默认 us-east-1)，让 SigV4 不需要预先
		// HTTP probe BucketLocation —— presign client 不需要能真连通
		// (它的 endpoint 是浏览器侧 public host)。
		Region: "us-east-1",
	})
	if err != nil {
		return nil, fmt.Errorf("storage: new minio client %q: %w", endpoint, err)
	}
	return c, nil
}

// buildPresignClient —— PublicURL 空 → 复用 internal；非空 → 用 public
// host 做一个仅用来 PresignedGetObject 的 client，避免后置改 host 破坏签名。
func buildPresignClient(cfg *Config, internal *minio.Client) (*minio.Client, error) {
	if cfg.PublicURL == "" {
		return internal, nil
	}
	parsed, err := url.Parse(cfg.PublicURL)
	if err != nil {
		return nil, fmt.Errorf("storage: parse public url: %w", err)
	}
	return buildMinioClient(parsed.Host, cfg)
}

// Put 上传 bytes。
func (m *Client) Put(ctx context.Context, in *PutInput) error {
	_, err := m.internal.PutObject(ctx, m.bucket, in.Key, in.Body, in.Size,
		minio.PutObjectOptions{ContentType: in.ContentType})
	if err != nil {
		return fmt.Errorf("storage: put %q: %w", in.Key, err)
	}
	return nil
}

// Delete 删除。
func (m *Client) Delete(ctx context.Context, key string) error {
	if err := m.internal.RemoveObject(ctx, m.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: delete %q: %w", key, err)
	}
	return nil
}

// Get 直接拉 bytes（不签 URL）。Obsidian export 把 blob 写进 zip 用，正常
// blob 一般 < 10MB，全量读到内存里可接受。
func (m *Client) Get(ctx context.Context, key string) ([]byte, error) {
	obj, err := m.internal.GetObject(ctx, m.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("storage: get %q: %w", key, err)
	}
	defer func() {
		if cerr := obj.Close(); cerr != nil {
			_ = cerr
		}
	}()
	buf, rerr := io.ReadAll(obj)
	if rerr != nil {
		return nil, fmt.Errorf("storage: read %q: %w", key, rerr)
	}
	return buf, nil
}

// PresignedGetURL 颁发签名 URL；用 presign client (host=PublicURL) 直接
// 签，避免事后改 host 破坏 SigV4 签名。
func (m *Client) PresignedGetURL(ctx context.Context, key string) (string, error) {
	signed, err := m.presign.PresignedGetObject(ctx, m.bucket, key, presignTTL, nil)
	if err != nil {
		return "", fmt.Errorf("storage: presign %q: %w", key, err)
	}
	return signed.String(), nil
}

func (m *Client) ensureBucket(ctx context.Context) error {
	exists, err := m.internal.BucketExists(ctx, m.bucket)
	if err != nil {
		return fmt.Errorf("storage: bucket exists check: %w", err)
	}
	if exists {
		return nil
	}
	if merr := m.internal.MakeBucket(ctx, m.bucket, minio.MakeBucketOptions{}); merr != nil {
		return fmt.Errorf("storage: make bucket %q: %w", m.bucket, merr)
	}
	return nil
}
