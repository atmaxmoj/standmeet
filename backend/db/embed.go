// embed.go —— 把 migrations/ 编进后端二进制。
//
// 这个文件存在的唯一理由是**位置**：`go:embed` 够不到包目录以外的东西，
// 而 migration 的家在 `backend/db/migrations/`。放一个 Go 文件在它旁边，
// 比在构建时把 .sql 抄进某个包里好 —— 抄的那一步会漂移，而漂移的样子是
// 「镜像里的 migration 比代码旧」，没有任何东西会报这件事。
//
// 最终镜像只 COPY 那个二进制（backend/Dockerfile），所以读磁盘的方案在 prod
// 根本没有文件可读。编进去之后，「部署了这一版」和「这一版的 schema 改动在手上」
// 是同一件事。

// Package db —— schema.sql 和 migrations/ 的家；这个 Go 包只是它们的 go:embed 载体。
package db

import "embed"

// Migrations —— 全部 .sql，文件名即顺序（ISO 日期开头，字典序＝时间序）。
//
//go:embed migrations/*.sql
var Migrations embed.FS
