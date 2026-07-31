// gateway.go —— 沙箱端的 reach-back 客户端。#135 constrained-reachback：booker 的业务逻辑
// 住在本沙箱里,凡是它够不到的外部东西(日历连接器 / 自己的隔离存储 / owner 元数据)一律
// 经绑进沙箱的 socket 调 host 的**固定词表**。它只能调这几个 op,加不了新 op。
//
// 底层复用 callHost(main.go)的 line-JSON 单请求/单响应。host 回的若是 capsocket 的
// {"error":...} 信封,这里翻成 Go error(工具层再折成 {ok:false} 给 agent)。

package main

import (
	"encoding/json"
	"fmt"
)

type errEnvelope struct {
	Error string `json:"error"`
}

// gwCall —— 发一个固定词表 op,回原始 JSON;host 错误信封 → error。
func gwCall(op string, fields map[string]any) (json.RawMessage, error) {
	fields["op"] = op
	resp, err := callHost(fields)
	if err != nil {
		return nil, err
	}
	var e errEnvelope
	if json.Unmarshal(resp, &e) == nil && e.Error != "" {
		return nil, fmt.Errorf("host %s: %s", op, e.Error)
	}
	return json.RawMessage(resp), nil
}

// gwConnectorInvoke —— 按名调 owner 的 active 连接器(calendar/mail)的一个 verb。
func gwConnectorInvoke(
	ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	return gwCall("connector.invoke", map[string]any{
		"owner_id": ownerID, "category": category, "verb": verb, "args": args,
	})
}

// gwConnectorInvokeBackground —— 交给 host 后台跑(带重试),不等结果。
// 用于"结果不该挡住调用方"的调用:约成通知信。**不能**在本进程起 goroutine 代替 ——
// 沙箱只活这一轮,tool 一返回进程就可能被回收,退避还没到就死了。
func gwConnectorInvokeBackground(
	ownerID, category, verb string, args json.RawMessage,
) error {
	_, err := gwCall("connector.invoke", map[string]any{
		"owner_id": ownerID, "category": category, "verb": verb, "args": args,
		"background": true,
	})
	return err
}

// gwCapstoreInsert —— 往本 cap 的隔离存储塞一份文档,回记录 id。
func gwCapstoreInsert(collection string, doc json.RawMessage) (string, error) {
	resp, err := gwCall("capstore.insert", map[string]any{
		"collection": collection, "doc": doc,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		ID string `json:"id"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", fmt.Errorf("capstore.insert decode: %w", uerr)
	}
	return r.ID, nil
}

// gwCapstoreQuery —— 取本 cap collection 里 doc 满足 filter 的文档。
func gwCapstoreQuery(collection string, filter json.RawMessage) ([]json.RawMessage, error) {
	resp, err := gwCall("capstore.query", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return nil, err
	}
	var r struct {
		Records []json.RawMessage `json:"records"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return nil, fmt.Errorf("capstore.query decode: %w", uerr)
	}
	return r.Records, nil
}

// gwCapstoreCount —— 数本 cap collection 里满足 filter 的文档数(配额闸)。
func gwCapstoreCount(collection string, filter json.RawMessage) (int64, error) {
	resp, err := gwCall("capstore.count", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return 0, err
	}
	var r struct {
		Count int64 `json:"count"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return 0, fmt.Errorf("capstore.count decode: %w", uerr)
	}
	return r.Count, nil
}

// gwCapstoreDelete —— 删本 cap collection 里满足 filter 的记录,返删除行数。
func gwCapstoreDelete(collection string, filter json.RawMessage) (int64, error) {
	resp, err := gwCall("capstore.delete", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return 0, err
	}
	var r struct {
		Deleted int64 `json:"deleted"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return 0, fmt.Errorf("capstore.delete decode: %w", uerr)
	}
	return r.Deleted, nil
}

// gwOwnerMeta —— 读一个白名单 owner 字段(如 timezone)。
func gwOwnerMeta(ownerID, field string) (string, error) {
	resp, err := gwCall("owner.meta", map[string]any{
		"owner_id": ownerID, "field": field,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		Value string `json:"value"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", fmt.Errorf("owner.meta decode: %w", uerr)
	}
	return r.Value, nil
}

// gwCapConfig —— 问 host 要**本能力自己的配置**。
//
// 为什么不是自己去 capstore 查那份文档:**默认值在声明里**(host 的 manifest ConfigField),
// 沙箱看不见声明。自己查存储的话,owner 没设过就什么都读不到,于是只能在这儿再写一份默认值 ——
// 那正是 host/沙箱两份策略当初漂移的根子(host 说到 18:00、缓冲 15,这儿按 17:00、缓冲 0)。
//
// 这个 op 回的是**已经按声明兜好底的最终值**,拿到就能用。
func gwCapConfig(ownerID string) (map[string]json.RawMessage, error) {
	resp, err := gwCall("capconfig.get", map[string]any{"owner_id": ownerID})
	if err != nil {
		return nil, err
	}
	var out map[string]json.RawMessage
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return nil, fmt.Errorf("capconfig decode: %w", uerr)
	}
	return out, nil
}

// capRecord —— 一条自己的记录:id + 文档。
type capRecord struct {
	ID  string          `json:"id"`
	Doc json.RawMessage `json:"doc"`
}

// gwCapstoreQueryRecords —— 带 id 的查询。按 id 取消一条预约,先得能看见 id。
func gwCapstoreQueryRecords(collection string, filter json.RawMessage) ([]capRecord, error) {
	resp, err := gwCall("capstore.query_records", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Records []capRecord `json:"records"`
	}
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return nil, fmt.Errorf("capstore query_records decode: %w", uerr)
	}
	return out.Records, nil
}

// gwCapstoreDeleteByID —— 按记录 id 删自己的一条。
func gwCapstoreDeleteByID(collection, recordID string) (int64, error) {
	resp, err := gwCall("capstore.delete_by_id", map[string]any{
		"collection": collection, "record_id": recordID,
	})
	if err != nil {
		return 0, err
	}
	var out struct {
		Deleted int64 `json:"deleted"`
	}
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return 0, fmt.Errorf("capstore delete_by_id decode: %w", uerr)
	}
	return out.Deleted, nil
}
