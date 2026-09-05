// Package storage — S3-compatible object storage client. Production uses MinIO
// (self-hosted), config comes from STORAGE_* env vars. Every owner-uploaded binary
// (post cover images / raw attachments / custom page static assets) lands here.
//
// Does not expose the minio-go API directly: callers only see this package's Client
// interface, making it easy to swap in an in-memory impl for tests (e2e runs the
// full chain against a real minio container; unit tests can inject a fake later).
//
// Object key shape: `<owner_id>/<asset_id>` — flat naming, avoids path traversal;
// metadata (content-type / size / original_filename / sha256) all lands in the
// Postgres assets table — the bucket holds only raw bytes.
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

// presignTTL — validity window for the public GET link; the frontend refreshes it
// once when displaying a cover. Production could stretch it to 24h for cache
// friendliness; starting at 1h balances clock skew against the token-leak window.
const presignTTL = 1 * time.Hour

// PutInput — bundles Put's arguments; keeps revive's argument-limit ≤ 5.
type PutInput struct {
	Body        io.Reader
	Key         string
	ContentType string
	Size        int64
}

// Config — injected by the composition root. Unmarshaled directly from STORAGE_*
// env vars. Endpoint must not be empty (composition root fails fast); PublicURL is
// the host the browser connects to directly (in-container endpoint is minio:9000,
// the browser needs localhost:9200).
type Config struct {
	Endpoint  string // host:port, no scheme
	AccessKey string
	SecretKey string
	Bucket    string
	PublicURL string
	UseSSL    bool
}

// Client — wraps minio-go. NewClient creates the bucket idempotently; every
// owner-uploaded binary (post covers / raw attachments / custom page assets)
// goes through here. Object key shape "<owner_id>/<asset_id>" is flat, avoiding
// path traversal; metadata (content-type / size / sha256) lands in the Postgres
// assets table — the bucket holds only raw bytes.
//
// Two underlying clients because AWS SigV4 signs the host into the URL — internal
// Put/Delete uses the internal endpoint (minio:9000, container-to-container),
// while the presigned URL handed to the browser must be signed against the public
// endpoint (localhost:9200); you can't mint it then swap the host, the signature
// goes invalid. When PublicURL equals Endpoint the two clients are equivalent.
type Client struct {
	internal *minio.Client
	presign  *minio.Client
	bucket   string
}

// NewClient builds the client and ensures the bucket exists.
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
		// Region is hardcoded (MinIO defaults to us-east-1) so SigV4 doesn't need to
		// probe BucketLocation over HTTP first — the presign client doesn't need to
		// actually be reachable (its endpoint is the browser-side public host).
		Region: "us-east-1",
	})
	if err != nil {
		return nil, fmt.Errorf("storage: new minio client %q: %w", endpoint, err)
	}
	return c, nil
}

// buildPresignClient — PublicURL empty → reuse internal; non-empty → build a
// public-host client used only for PresignedGetObject, so a later host swap can't
// break the signature.
//
// **A missing scheme must be rejected on the spot, and must name which variable.**
// `url.Parse("files.example.com:9000")` does not error: it treats the whole string
// as opaque, so `Host` comes back empty. That empty string flows straight into
// minio.New, and the instance crashes on
// `new minio client "": Endpoint:  does not follow ip address or domain name standards` —
// a message that points at endpoint, so the owner checks `STORAGE_ENDPOINT`,
// which they actually set correctly.
// Hit this once in the real environment: the whole stack wouldn't come up, db/redis/minio
// were all healthy, only backend was crash-looping, and the log pointed at a variable
// that was fine (F-S-1).
//
// This isn't an edge-case input: `STORAGE_PUBLIC_URL` is the **browser-side** address,
// so a self-hoster naturally writes `files.example.com`; Coolify's magic FQDN variable
// also strips the `http://` when it round-trips.
func buildPresignClient(cfg *Config, internal *minio.Client) (*minio.Client, error) {
	if cfg.PublicURL == "" {
		return internal, nil
	}
	parsed, err := url.Parse(cfg.PublicURL)
	if err != nil {
		return nil, fmt.Errorf("storage: parse STORAGE_PUBLIC_URL %q: %w", cfg.PublicURL, err)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf(
			"storage: STORAGE_PUBLIC_URL %q has no scheme — write it as https://%s",
			cfg.PublicURL, cfg.PublicURL,
		)
	}
	return buildMinioClient(parsed.Host, cfg)
}

// Put uploads bytes.
func (m *Client) Put(ctx context.Context, in *PutInput) error {
	_, err := m.internal.PutObject(ctx, m.bucket, in.Key, in.Body, in.Size,
		minio.PutObjectOptions{ContentType: in.ContentType})
	if err != nil {
		return fmt.Errorf("storage: put %q: %w", in.Key, err)
	}
	return nil
}

// Delete removes the object.
func (m *Client) Delete(ctx context.Context, key string) error {
	if err := m.internal.RemoveObject(ctx, m.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: delete %q: %w", key, err)
	}
	return nil
}

// Get pulls bytes directly (no signed URL). Obsidian export writes the blob into
// a zip; blobs are typically < 10MB so reading the whole thing into memory is fine.
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

// PresignedGetURL issues a signed URL; signs directly with the presign client
// (host=PublicURL) to avoid breaking the SigV4 signature by swapping the host after.
func (m *Client) PresignedGetURL(ctx context.Context, key string) (string, error) {
	signed, err := m.presign.PresignedGetObject(ctx, m.bucket, key, presignTTL, nil)
	if err != nil {
		return "", fmt.Errorf("storage: presign %q: %w", key, err)
	}
	return signed.String(), nil
}

// Health — #101 real health check: can it reach minio and query the configured bucket.
func (m *Client) Health(ctx context.Context) error {
	if _, err := m.internal.BucketExists(ctx, m.bucket); err != nil {
		return fmt.Errorf("storage: health check: %w", err)
	}
	return nil
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
