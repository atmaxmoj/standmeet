// vendor_openapi.go —— 厂商发布 OpenAPI 文档的替身。
//
// 存在的理由:「从 URL 抓 spec」这条路的 **happy path 一条 e2e 都没有**。用到抓取的两条现有用例
// 走的都是失败场景(不可达 / 被出站策略挡下),于是「抓回来的那份文档能不能真的装配成连接器」
// 从来没有人走过 —— F-C-25 就活在那条缝里(抓得到候选,装配却送出一份空 spec)。
//
// 文档**故意不声明 servers**:真厂商文档常常如此(Cal.com v2 写的就是 `"servers": []`),owner
// 只能在面板上补 base URL。一条守卫因此覆盖整段真实旅程:抓 → 被拒并点名 → 补 base URL →
// 出候选 → 装配。
//
// 也**故意不声明 securitySchemes**:同样照着真文档的样子,让面板落到 manual 兜底方案那条路。

package main

import "net/http"

// vendorSpecNoServers —— 最小但完整的 OpenAPI 3.0:显式空 servers、两个带 operationId 的操作、
// 无 securitySchemes。够摄入闸判定,也够装配出 agent 工具。
const vendorSpecNoServers = `{
  "openapi": "3.0.0",
  "info": { "title": "Vendor Scheduling API", "version": "2.0.0" },
  "servers": [],
  "paths": {
    "/v2/bookings": {
      "get": {
        "operationId": "bookings.list",
        "summary": "List bookings",
        "responses": { "200": { "description": "ok" } }
      },
      "post": {
        "operationId": "bookings.create",
        "summary": "Create a booking",
        "responses": { "201": { "description": "created" } }
      }
    }
  }
}`

func (s *server) serveVendorSpecNoServers(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write([]byte(vendorSpecNoServers)); err != nil {
		s.log.Warn("write vendor spec", "err", err)
	}
}
