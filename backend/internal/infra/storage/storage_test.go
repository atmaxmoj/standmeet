// storage_test.go —— `STORAGE_PUBLIC_URL` 没写 scheme 时，实例必须**说清楚是它**。
//
// ①🔴 真环境（Coolify，2026-08-26）：整栈起不来。db / redis / minio / gotenberg 都健康，
// backend 崩溃循环，日志是：
//
//	init storage: new minio client "": Endpoint:  does not follow ip address
//	or domain name standards.
//
// 那个空的 endpoint **不是** `STORAGE_ENDPOINT` —— 它设着 `minio:9000`，容器 env 里查过。
// 空的是 presign client 的 endpoint，而它来自 `url.Parse(PublicURL).Host`。
//
// ②🎯 `buildPresignClient`：`url.Parse("host:9000")` 对一个没有 scheme 的串
// **不报错**，把整串当 opaque，`Host` 是空串。于是空主机名一路传进 minio.New，
// 报出来的那句话指着一个 owner 根本没设错的变量。
//
// 这不是边角输入：`STORAGE_PUBLIC_URL` 是浏览器侧地址，自托管的人自然会写
// `files.example.com`；Coolify 的 `SERVICE_FQDN_*` 变量按设计就不带 scheme
// （带 scheme 的是 `SERVICE_URL_*`）。而失败的样子是**整个实例起不来**，
// 错误却指向别处。
//
// ── 为什么从 `NewClient` 验，而不是直接戳内部那个函数 ────────────────────────────
// 这是 composition root 唯一会调的入口，也是 owner 真正会走的那条路。
// 好处是判据跟着入口走：哪天校验挪了地方，这几条仍然问的是同一件事。
// 代价是「带 scheme 的正常路径」在没有真 minio 时走不完 —— 所以那两条断的是
// **它越过了这道校验**（错误不再提这个变量），而不是「连上了」。

package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// deadEndpoint —— 立刻连接失败的地址。这几条测的是**启动期校验**，
// 不是网络；用一个必然拒绝的端口让越过校验之后的那一步快速失败。
const deadEndpoint = "127.0.0.1:1"

func TestPublicURLWithoutSchemeIsRejectedByName(t *testing.T) {
	t.Parallel()
	_, err := storage.NewClient(context.Background(), &storage.Config{
		Endpoint: deadEndpoint, AccessKey: "k", SecretKey: "s", Bucket: "b",
		// owner 会这么写的形态：一个主机名加端口，没有 scheme。
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

// 带 scheme 的必须**越过**这道校验。断的是「错误不再是这一条」——
// 没有真 minio，连接那一步注定失败，那不是这几条要说的事。
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

// 空 PublicURL 是合法的「不用单独的 presign 主机」，同样必须越过这道校验。
func TestEmptyPublicURLClearsTheCheck(t *testing.T) {
	t.Parallel()
	_, err := storage.NewClient(context.Background(), &storage.Config{
		Endpoint: deadEndpoint, AccessKey: "k", SecretKey: "s", Bucket: "b",
	})
	if err != nil && strings.Contains(err.Error(), "STORAGE_PUBLIC_URL") {
		t.Fatalf("an empty PublicURL is legitimate and must clear the check: %v", err)
	}
}
