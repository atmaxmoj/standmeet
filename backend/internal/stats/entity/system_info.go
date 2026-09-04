package entity

// SystemInfo — a real runtime snapshot for /admin/system: go runtime + real
// health pings + host resources (disk/memory/load — the self-hosted owner's
// first-glance ops data).
type SystemInfo struct {
	Version       string
	PublicIP      string // the instance's public IP (deploy-provided), for the panel
	Health        []HealthCheck
	Containers    []Container // this compose project's per-service CPU/memory (own cluster)
	UptimeSeconds int64
	MemAllocMB    int64 // Go process heap (runtime), != host RAM
	DiskTotalMB   int64 // host data disk total capacity
	DiskFreeMB    int64 // host data disk free space
	MemTotalMB    int64 // host physical memory total
	MemUsedMB     int64 // host physical memory used
	LoadAvg1      float64
	Goroutines    int
	NumCPU        int
}

// HealthCheck — the real health of one dependency (db/redis/storage really
// pinged, not a hardcoded "ok").
type HealthCheck struct {
	Name   string
	Detail string
	OK     bool
}

// Container — one compose service's live resource usage (the owner's own cluster).
type Container struct {
	Name       string
	CPUPercent float64
	MemBytes   int64
	MemLimit   int64
}
