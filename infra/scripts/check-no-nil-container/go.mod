// 独立 lint 工具模块（纯 stdlib）——不属于 backend 生产模块，只在 make lint 时
// 被构建+执行（CWD=backend，扫 ./internal + ./cmd）。
module standmeet.tools/check-no-nil-container

go 1.26
