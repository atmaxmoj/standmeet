package domain

// SystemInfo —— #101 /admin/system 的真实运行时快照(version/uptime/go runtime + 真 health ping)。
type SystemInfo struct {
	Version       string
	Health        []HealthCheck
	UptimeSeconds int64
	Goroutines    int
	MemAllocMB    int64
	NumCPU        int
}

// HealthCheck —— 一项依赖的真实健康(db/redis/storage 真 ping,不再写死 "ok")。
type HealthCheck struct {
	Name   string
	Detail string
	OK     bool
}
