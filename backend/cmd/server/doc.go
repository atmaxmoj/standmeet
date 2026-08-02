// Package main —— standmeet backend 的组装根。它**只做装配**:把各处声明的东西接起来,
// 自己不实现业务。进程入口在 main.go。
//
// # 目录就是章程
//
// 这个目录长到三十几个文件后没有规矩可循:光看文件名答不出"这个文件在这儿干什么"。
// 现在分成五个包,每个包一句话说得清自己是干嘛的:
//
//	deps/      跑着的那一堆东西(连接池、各域仓储、两根轴的注册表、两个收口)。
//	           **只有数据,没有装配** —— 它是叶子,谁也不 import,所以下面四个包都能收同一个引用。
//	port/      组装根**实现某个域声明的窄口**:域说"我需要这么一件事",这里用手上的具体东西
//	           满足它。域因此不必反过来认识 owner / inference / redis。
//	axisconn/  连接器轴:内置与 owner 上传的连接器、品类操作、品类依赖注册表。
//	axiscap/   能力轴:内建声明的读入、注册、隔离存储、可配置项、码上的字段与用量闸、工作区。
//	wire/      把**一个机制**接起来。一个机制一个文件:出站收口、入站收口、周期任务、
//	           语料依赖、检索索引。
//
// 根目录只剩启动序列本身:main.go(入口)、boot_*(依赖装配 / HTTP / 日志 / 总接线)、
// cmd_*(CLI 子命令)。
//
// # 依赖是单向的
//
//	deps ← port ← axisconn ← axiscap ← wire ← main
//
// 这不是约定,是编译器管的事:包之间有环就编不过。把它们摊在一个包里的时候,任何一段都能
// 直接够到任何一段,"谁该认识谁"只能靠人记。
//
// # 两根轴,一样的形状
//
// 两根插件轴的**声明**都不在这儿:它们在 backend/capabilities/<id>/manifest.yaml 和
// backend/connectors/<id>/manifest.yaml。这两个包只负责把声明接到机制上。声明写进组装根
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
