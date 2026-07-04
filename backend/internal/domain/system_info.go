package domain

// SystemInfo —— /admin/system 的真实运行时快照:go runtime + 真 health ping + 主机资源
// (磁盘/内存/负载 —— 自托管 owner 的第一眼运维数据)。
type SystemInfo struct {
	Version       string
	Health        []HealthCheck
	UptimeSeconds int64
	MemAllocMB    int64 // Go 进程堆(runtime),≠ 主机 RAM
	DiskTotalMB   int64 // 主机数据盘总量
	DiskFreeMB    int64 // 主机数据盘空闲
	MemTotalMB    int64 // 主机物理内存总量
	MemUsedMB     int64 // 主机物理内存已用
	LoadAvg1      float64
	Goroutines    int
	NumCPU        int
}

// HealthCheck —— 一项依赖的真实健康(db/redis/storage 真 ping,不再写死 "ok")。
type HealthCheck struct {
	Name   string
	Detail string
	OK     bool
}
