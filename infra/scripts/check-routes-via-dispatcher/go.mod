// 独立 lint 工具模块（纯 stdlib）——不属于 backend 生产模块，只在 make lint 时
// 被构建+执行（CWD=backend，扫 ./internal/routes）。
module standmeet.tools/check-routes-via-dispatcher

go 1.26
