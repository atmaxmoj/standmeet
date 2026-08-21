// host_bridges_claim.go —— eval 侧的单赢占位。
//
// 真宿主用一次主键冲突保证「同一个 key 只有一个人拿得到」(见 capstore/claim.go)。这里是
// mini-host:同一个进程内一张表加一把锁,语义**必须一样** —— 一个只会返 true 的假占位会让
// 那条守卫在这一侧永远绿,而它守的正是「两个人同时抢一格」(F-B-15,[[stand-in-is-politer-than-reality]])。

package agentcore

import (
	"context"
	"sync"
	"time"
)

// claimTable —— 进程内的占位表。key = collection + "\x00" + key。
var claimTable = struct { //nolint:gochecknoglobals // mini-host 的进程级状态,跟真宿主的一张表对位
	till map[string]time.Time
	mu   sync.Mutex
}{till: map[string]time.Time{}}

// Claim —— 拿到返 true;已被别人占着且没过期返 false(不是错误)。
func (storeBridge) Claim(
	_ context.Context, collection, key string, ttlSeconds int,
) (bool, error) {
	claimTable.mu.Lock()
	defer claimTable.mu.Unlock()
	k := collection + "\x00" + key
	if till, held := claimTable.till[k]; held && till.After(time.Now()) {
		return false, nil
	}
	claimTable.till[k] = time.Now().Add(claimTTL(ttlSeconds))
	return true, nil
}

// Release —— 放掉自己占的那一格。
func (storeBridge) Release(_ context.Context, collection, key string) error {
	claimTable.mu.Lock()
	defer claimTable.mu.Unlock()
	delete(claimTable.till, collection+"\x00"+key)
	return nil
}

func claimTTL(seconds int) time.Duration {
	if seconds <= 0 {
		return time.Minute
	}
	return time.Duration(seconds) * time.Second
}
