// Package credentialdomain —— owner 持有的凭据/密钥值对象:APIKey(客户端签名进 MCP 的 key 元数据)、
// OwnerKeypair(Ed25519 sigv1 签名密钥)、AICredential(AI provider 密钥)。从 internal/domain
// god-package 切出;usecases/postgres/routes/ownercore 共享。pure leaf,无 internal 依赖。
package credentialdomain
