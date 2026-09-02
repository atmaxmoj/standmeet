// storage_test.go — when `STORAGE_PUBLIC_URL` is written without a scheme, the
// instance must **say clearly that it's this variable**.
//
// ①🔴 Real environment (Coolify, 2026-08-26): the whole stack wouldn't come up.
// db / redis / minio / gotenberg were all healthy, backend was crash-looping, and
// the log said:
//
//	init storage: new minio client "": Endpoint:  does not follow ip address
//	or domain name standards.
//
// That empty endpoint is **not** `STORAGE_ENDPOINT` — it was set to `minio:9000`,
// checked in the container env. The empty one is the presign client's endpoint,
// and it comes from `url.Parse(PublicURL).Host`.
//
// ②🎯 `buildPresignClient`: `url.Parse("host:9000")` does **not** error on a
// scheme-less string — it treats the whole thing as opaque, so `Host` is empty.
// The empty hostname then flows straight into minio.New, and the message it
// reports points at a variable the owner never got wrong.
//
// This isn't an edge-case input: `STORAGE_PUBLIC_URL` is the browser-side address,
// so a self-hoster naturally writes `files.example.com`; Coolify's `SERVICE_FQDN_*`
// variables are designed without a scheme (`SERVICE_URL_*` is the one with a
// scheme). And the failure looks like **the whole instance won't start**, while
// the error points somewhere else.
//
// ── Why verify from `NewClient` instead of poking the internal function directly ──
// This is the only entry point the composition root ever calls, and the path the
// owner actually walks. The upside: the assertion tracks the entry point — if the
// check ever moves, these tests still ask the same question. The cost: the
// "scheme-present, happy path" can't run to completion without a real minio — so
// those two tests assert **it cleared this check** (the error no longer names this
// variable), not "it connected".

package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// deadEndpoint — an address that fails to connect immediately. These tests are
// about **startup-time validation**, not networking; a port that's guaranteed to
// refuse lets the step after the check fail fast.
const deadEndpoint = "127.0.0.1:1"

func TestPublicURLWithoutSchemeIsRejectedByName(t *testing.T) {
	t.Parallel()
	_, err := storage.NewClient(context.Background(), &storage.Config{
		Endpoint: deadEndpoint, AccessKey: "k", SecretKey: "s", Bucket: "b",
		// The shape an owner would actually write: a hostname plus port, no scheme.
		PublicURL: "files.example.com:9000",
	})
	if err == nil {
		t.Fatal("a scheme-less PublicURL was accepted silently — " +
			"it leaves the presign client with an empty host and kills the instance " +
			"with a message pointing at a different variable")
	}
	if !strings.Contains(err.Error(), "STORAGE_PUBLIC_URL") {
		t.Fatalf("the error does not name the variable, so the owner cannot act on it: %v", err)
	}
	if !strings.Contains(err.Error(), "files.example.com:9000") {
		t.Fatalf("the error does not echo back what they actually wrote: %v", err)
	}
}

// A PublicURL with a scheme must **clear** this check. What's asserted is that the
// error is no longer this one — without a real minio, the connect step is bound
// to fail, and that's not what this test is about.
func TestPublicURLWithSchemeClearsTheCheck(t *testing.T) {
	t.Parallel()
	_, err := storage.NewClient(context.Background(), &storage.Config{
		Endpoint: deadEndpoint, AccessKey: "k", SecretKey: "s", Bucket: "b",
		PublicURL: "https://files.example.com",
	})
	if err != nil && strings.Contains(err.Error(), "STORAGE_PUBLIC_URL") {
		t.Fatalf("a PublicURL with a scheme must clear the check: %v", err)
	}
}

// An empty PublicURL legitimately means "no separate presign host", and must
// likewise clear this check.
func TestEmptyPublicURLClearsTheCheck(t *testing.T) {
	t.Parallel()
	_, err := storage.NewClient(context.Background(), &storage.Config{
		Endpoint: deadEndpoint, AccessKey: "k", SecretKey: "s", Bucket: "b",
	})
	if err != nil && strings.Contains(err.Error(), "STORAGE_PUBLIC_URL") {
		t.Fatalf("an empty PublicURL is legitimate and must clear the check: %v", err)
	}
}
