// res_instance_types.go —— instance 观测面:**这台机器**的形状(运行时 + 依赖健康)。
//
// instance 名义上是一个资源,实际上是几套互不相干的观测数据。类型按"观测的是什么"分文件:
// 这里是机器本身,corpus 那套在 res_instance_corpus_types.go,用量和事件流在
// res_instance_usage_types.go。

package dispatcher

// InstanceStatus —— 健康快照。
type InstanceStatus struct {
	Version       string
	Health        []HealthCheck
	UptimeSeconds int64
	MemAllocMB    int64
	DiskTotalMB   int64
	DiskFreeMB    int64
	MemTotalMB    int64
	MemUsedMB     int64
	LoadAvg1      float64
	Goroutines    int
	NumCPU        int
}

// HealthCheck —— 一个依赖的探活结果。
type HealthCheck struct {
	Name   string
	Detail string
	OK     bool
}
