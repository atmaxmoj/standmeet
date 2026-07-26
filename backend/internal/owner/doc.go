// Package owner —— owner 领域值对象:Owner aggregate(+ AI/BYOAI settings)、PageContent
// (公开页内容切面 + pin 卡)、CustomPage(SDK 自建页托管)。从 internal/domain god-package 切出;
// usecases/postgres/routes/ownercore/jobs 共享。pure leaf,无 internal 依赖。mail/prompt 待连接器解锁后并入。
package owner
