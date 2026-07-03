// system.go —— #101 GET /system 出真实运行时信息(version/uptime/go runtime + 真 health ping)。
// 数据由 composition root 的 sysInfoProvider 提供(持 db/redis/storage 做真 ping)。

package admin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// SystemInfoProvider —— #101 admin system 面板数据源。
type SystemInfoProvider interface {
	SystemInfo(ctx context.Context) domain.SystemInfo
}

type healthCheckResp struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type systemInfoResp struct {
	Version       string            `json:"version"`
	Health        []healthCheckResp `json:"health"`
	UptimeSeconds int64             `json:"uptime_seconds"`
	Goroutines    int               `json:"goroutines"`
	MemAllocMB    int64             `json:"mem_alloc_mb"`
	NumCPU        int               `json:"num_cpu"`
}

func (h *Handlers) getSystemInfo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		info := h.SystemInfo.SystemInfo(r.Context())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(toSystemInfoResp(info)); err != nil {
			logEncodeErr(h.Log, "encode system info", err)
		}
	}
}

func toSystemInfoResp(info domain.SystemInfo) systemInfoResp {
	health := make([]healthCheckResp, 0, len(info.Health))
	for i := range info.Health {
		health = append(health, healthCheckResp{
			Name: info.Health[i].Name, Detail: info.Health[i].Detail, OK: info.Health[i].OK,
		})
	}
	return systemInfoResp{
		Version:       info.Version,
		UptimeSeconds: info.UptimeSeconds,
		Goroutines:    info.Goroutines,
		MemAllocMB:    info.MemAllocMB,
		NumCPU:        info.NumCPU,
		Health:        health,
	}
}
