// Package connector —— 消费者无关的、可装配的连接器层（#155）。底座（Hub 注册表 + 品类槽位
// 分派 + 通用 openapi runtime + protocol runtime）+ 装配器：把「一份 OpenAPI spec + JSONata
// binding」或「一份 protocol 配置」装配成消费者认的品类契约（usecases.CalendarProxy /
// MailProxy）。内置与上传同构（只是 manifest 数据来源不同）。凭据解密、认证注入、重试全在
// 本包内——消费者（booker / mailer / 未来 IM）只见品类契约，不知背后是哪个 provider、哪 kind。
package connector
