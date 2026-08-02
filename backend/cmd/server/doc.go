// Package main —— standmeet backend 的组装根。它**只做装配**:把各处声明的东西接起来,
// 自己不实现业务。进程入口在 main.go。
//
// # 文件名就是章程
//
// 这个目录长到三十几个文件后没有规矩可循 —— 光看文件名答不出"这个文件在这儿干什么"。
// 现在每个文件用前缀说明自己的职责,一共六类,多一类都要先想清楚:
//
//	main.go        进程入口。启动顺序在这里读得完,不散在别处。
//	boot_*         启动序列与进程级装配:依赖聚合、HTTP 服务器、日志、总接线。
//	wire_*         把**一个机制**接起来。一个机制一个文件:出站收口、入站收口、周期任务、
//	               码上的字段与用量闸、owner MCP 面、语料依赖、检索索引。
//	axis_cap_*     能力轴的接线(内建声明的读入、注册、隔离存储、可配置项、工作区)。
//	axis_conn_*    连接器轴的接线(内建与 owner 上传的连接器、品类操作)。
//	port_*         组装根**实现某个域声明的窄口**:域说"我需要这么一件事",这里用手上的
//	               具体东西满足它。域因此不必反过来认识 owner/inference/redis。
//	cmd_*          CLI 子命令(不进 HTTP 面的运维入口)。
//
// # 两根轴,一样的形状
//
// 两根插件轴的**声明**都不在这儿:它们在 backend/capabilities/<id>/manifest.yaml 和
// backend/connectors/<id>/manifest.yaml。这个目录只负责把声明接到机制上。声明写进组装根
// 是这轮之前的样子 —— 能力自己的知识长在装配的地方,加一个能力就要改装配。
//
// # 两个收口
//
//	出站  internal/routes/dispatcher —— 面从这儿取能力
//	入站  internal/routes/hostdesk   —— 沙箱里的能力从这儿回头问宿主要东西
//
// 各建**一个**,别处一律从它投影。收口存在的前提是没有别的路;所以这个目录不许自己挂动词、
// 自己开 socket、自己起 ticker —— 三条都有门禁看着(check-routes-via-dispatcher /
// check-hostops-via-desk / check-periodic-via-scheduler)。
package main
