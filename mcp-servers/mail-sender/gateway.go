// gateway.go —— 沙箱端 reach-back 客户端。#135 constrained-reachback:mail-sender 够不到的外部
// 东西(owner 的 active mail 连接器)一律经绑进沙箱的 socket 调 host 的**固定词表** op。它只能
// 调这几个 op,加不了新 op —— 跟 booker 同构。底层复用 callHost(main.go)的 line-JSON。
//
// 迁移前 mail-sender 走一个**私有** "send" host op;现在改走通用 connector.invoke("mail","send"),
// host 侧不再有 mail-sender 专属 handler,只挂通用 reach-back 网关(见 cmd/server 的 gateway 接线)。

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

// gwConnectorInvoke —— 按名调 owner 的 active 连接器(此处 mail)的一个 verb。
func gwConnectorInvoke(
	ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	return gwCall("connector.invoke", map[string]any{
		"owner_id": ownerID, "category": category, "verb": verb, "args": args,
	})
}
