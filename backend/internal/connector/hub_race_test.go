package connector_test

import (
	"context"
	"strconv"
	"sync"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// hubStubConn —— 最小 Connector，供 Hub 并发测试用。
type hubStubConn struct{ name string }

func (c hubStubConn) Name() string                                  { return c.name }
func (hubStubConn) Kind() string                                    { return "openapi" }
func (hubStubConn) Connected(context.Context, string) (bool, error) { return true, nil }

// TestHubConcurrentUpsertResolve —— owner 运行时建/改连接器（Upsert，写 map）与访客品类槽解析
// （Resolve，读 map）会并发发生。Hub 无锁时 go test -race 必红「concurrent map read and map
// write」（且 prod 会直接 fatal）。加锁后此测试干净通过——即这条并发不变量的守护。
func TestHubConcurrentUpsertResolve(t *testing.T) {
	t.Parallel()
	h := connector.NewHub()
	const n = 64
	var wg sync.WaitGroup
	for i := range n {
		id := strconv.Itoa(i)
		wg.Go(func() { h.Upsert(hubStubConn{name: id}) })
		wg.Go(func() { _, _ = h.Resolve(id) })
	}
	wg.Wait()
}
