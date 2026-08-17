// svc_creds.go —— 「存一次凭据」到底意味着什么。
//
// 两条规矩住在这里，因为它们互相牵制，分开写必然走岔：
//
//   1. **按键合并，不是整体替换**（F-C-35）。面板只发 owner 敲过的那几个键
//      （`use-connector-card.ts` 的 `setField` 只记改动过的字段），而卡上逐字写着
//      「留空即保留」。以前请求体被原样写下去 —— owner 改一个端口，host/username/password
//      一起消失，全程不报错；下一次连接失败时那句「check the host, port, and credentials」
//      还会把他指向端口，而真正没了的是密码。
//      「没给这个键」和「把这个键设成空」是两件事，合并让它们分得开。
//
//   2. **真的变了才重置 connected**（F-C-30）。§三 D-5 要求「改身份/凭据必须重新验证」——
//      前提是**改了**。而面板点 Connect 的第一件事就是存一遍凭据，无条件清掉的话，一条
//      好端端的连接会在授权还没开始之前就显示成「没连」，token 却还活着；owner 看到
//      「没连」会重做一遍授权，而访客那一侧拿着活 token 的能力可能照常工作。
//
// 合并先于比对：要比的是**合并之后**跟原值差不差，而不是请求体跟原值差不差 ——
// 后者会把「只发了一个键」永远算成「变了」。

package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
)

// SaveCredentials —— 存凭据。category/kind 由内置 manifest 定；未知 id → ErrNotFound。
func (s *Service) SaveCredentials(ctx context.Context, ownerID, id string, body []byte) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
	}
	merged, changed := mergeCredentials(s.storedCredentials(ctx, ownerID, id), body)
	if err := s.d.Repo.SaveCredentials(ctx, &SaveConnectorCredsInput{
		OwnerID: ownerID, ConnectorID: id,
		Category: m.Category, Kind: m.Kind, Credentials: merged,
		ResetConnected: changed,
	}); err != nil {
		return fmt.Errorf("save connector credentials: %w", err)
	}
	return nil
}

// storedCredentials —— 这个连接器现在存着的凭据明文；没有 / 读不出 → 空（当作首次写入）。
func (s *Service) storedCredentials(ctx context.Context, ownerID, id string) []byte {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return []byte{}
	}
	return conn.Credentials
}

// credMap —— 凭据在这一层的形状：键 → **原样的 JSON 值**。
//
// 用 RawMessage 而不是解成具体类型，是因为每个连接器的字段各不相同（smtp 是七个字符串，
// oauth2 是两个，外加一个 scopes 数组）。同时它让「变没变」的判断退化成**字节比较** ——
// 比按类型逐个比更准，也不需要知道每个字段是什么。
type credMap = map[string]json.RawMessage

// mergeCredentials —— 收到的键覆盖，没收到的保留。返回合并结果 + **有没有真的变**。
//
// 两边任一不是 JSON 对象（首次写入、或历史上存的不是对象）→ 退回「整体替换 + 算作变了」：
// 合并不了的时候，宁可按老行为走，也不要猜。
func mergeCredentials(existing, incoming []byte) ([]byte, bool) {
	cur, curOK := decodeCredMap(existing)
	in, inOK := decodeCredMap(incoming)
	if !curOK || !inOK {
		return incoming, true
	}
	changed := applyCredKeys(cur, in)
	out, err := json.Marshal(cur)
	if err != nil {
		return incoming, true
	}
	return out, changed
}

// decodeCredMap —— 解成键 → 原样 JSON；空的或不是对象 → 解不了。
func decodeCredMap(raw []byte) (credMap, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var m credMap
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, false
	}
	return m, true
}

// applyCredKeys —— 把收到的键写进 cur，并报有没有哪个键的值**真的**不一样。
func applyCredKeys(cur, in credMap) bool {
	changed := false
	for k, v := range in {
		old, had := cur[k]
		if !had || !bytes.Equal(old, v) {
			changed = true
		}
		cur[k] = v
	}
	return changed
}
