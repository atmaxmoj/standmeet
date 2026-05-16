# StandMeet

AI-powered personal introduction platform. Owner 把自己的信息放上去，visitor 通过 AI 来了解 owner。

## Architecture

Monorepo，DDD + SOLID 设计。

| Directory | Tech | Port | 职责 |
|-----------|------|------|------|
| `server/` | Python/Django 6 + PostgreSQL + DRF + FastMCP | 8000 | MCP server + REST API |
| `gateway/` | Node.js + Claude Agent SDK | 8001 | Invitation Mode WebSocket gateway |
| `web/` | Next.js 15 + React 19 | 3000 | Visitor 前端 |
| `standmeet-client/` | Electron + React + Vite | desktop | Owner 管理端（独立 repo） |

## Two Modes（完全独立，互不相关）

### Invitation Mode

- **端点**: WebSocket `ws://host:8001`
- **认证**: Invite code（`sm_xxx`）通过 WebSocket auth 消息
- **流程**: Owner 创建邀请码 → Visitor 在网页输码 → WebSocket 连接 Gateway → Claude Agent SDK query → in-process MCP tools → Django content API
- **AI 费用**: Owner 出（Claude 订阅 Max/Pro，不需要 API key）
- **Chat log**: 按 invite code 记录，Owner 在 Electron 客户端查看

### BYOAI Mode（Bring Your Own AI）

- **端点**: `/mcp/`（FastMCP streamable HTTP）
- **认证**: 标准 MCP OAuth（和 invite code 无关）
- **流程**: Visitor 扫 QR code → Claude Code 自动走 OAuth 拿 Bearer token → MCP tools 查 owner 公开内容
- **AI 费用**: Visitor 自己出
- **QR code 内容**: `{"mcpServers":{"standmeet":{"url":"http://host/mcp/"}}}`（纯 URL，无 token）

## Server Structure

```
server/
├── domain/          # 纯实体、接口、path_matcher、异常
├── application/     # Service 层（content, invite, access）+ prompt/permission helpers
├── infrastructure/  # Django ORM、auth
├── interfaces/      # DRF REST API + FastMCP server
│   ├── api/         # REST endpoints（invite, content, settings, internal）
│   └── mcp/         # MCP server（独立于 invite 系统）
└── standmeet/       # Django 配置 + ASGI 入口
```

## Gateway Structure

```
gateway/
├── src/
│   ├── session/     # Session store + query queue（多 visitor 隔离 + 并发控制）
│   ├── runtime/     # Claude Agent SDK query + in-process MCP tools
│   ├── django/      # Invite validation + chat logging（调 Django internal API）
│   └── ws/          # WebSocket handler + connection manager
└── tests/e2e/
```

## Testing（重中之重！！！）

**每次改代码必须先跑测试，改完再跑测试。没有测试的功能不算完成。**

**当用户 report 了一个 bug，最重要的事情不是急着修 bug，而是先意识到：测试不全才让这个 bug 漏出去了。正确流程：先写一个会失败的测试复现这个 bug → 然后修 bug → 测试通过。绝对不能跳过写测试直接改代码。**

**写完测试和修完 bug 之后不要停，继续想：这个 bug 暴露了哪些其他测试盲区？举一反三，把同类场景的测试一起补全。不要等用户再 report 下一个类似的问题。**

**改完代码必须立刻跑测试验证，不要改完就停下来等用户。完整流程：写测试 → 跑测试看到失败 → 改代码 → 跑测试看到通过 → 重启 Docker 服务让用户能手工验证。缺任何一步都不算完成。**

**测试失败时必须先看日志再下结论。** 不看 `docker compose logs` 就猜原因是绝对禁止的。正确流程：看日志 → 定位根因 → 修复 → 再跑测试。不要凭空猜测"token 过期""环境问题"之类的结论。

**日志不够就加日志。** 如果现有日志不足以定位问题，先加日志、重新跑测试、看新日志，再决定怎么修。不要在日志不充分的情况下猜测原因。

**所有操作都用 Makefile 一键化。** 绝对不要直接跑 `docker compose` 或 `cd web && npx playwright test`。所有 Docker 和测试操作必须通过 `make xxx` 执行（Makefile 在 repo root）。如果 Makefile 缺少需要的命令，先加到 Makefile 再用。

- 只写端到端测试，不写单元测试
- 测试应启动真实服务、建立真实连接，不 mock 外部依赖
- 基础设施用 Docker 跑
- **端到端测试 = 从用户视角走完整流程**。涉及前端的测试用 Playwright 从浏览器点击、输入、发送，走到 gateway 再到 server，一个 Playwright 测试覆盖整条链路。不要用 vitest + raw WebSocket 之类的方式绕过浏览器来"假装"端到端。
- **测试必须验证正确结果，不能接受错误也算通过**。比如发消息的测试必须验证收到了 assistant 回复，如果收到 error 就必须失败。测试通过 = 功能正常工作，不是"没崩溃"。
- **改了 UI → 跑 web E2E 测试**
- **改了 gateway → 跑 gateway E2E 测试**
- **改了 server → 跑 server pytest**
- 如果现有测试覆盖不到你改的东西，**先加测试再改代码**
- **前端绝对不能把技术错误原样暴露给用户**。所有 error message 必须经过 friendly 转换，fallback 也必须是用户能看懂的话（如"Something went wrong"），绝不能出现 stack trace、进程退出码等技术细节
- 写测试时要覆盖错误场景：gateway 返回错误、连接断开、无效 invite code 等，确认用户看到的是友好提示

```bash
# 跑测试（改代码前后都要跑！）——在 repo root 下：
make test               # 一键：clean → 启动 test infra → server pytest → web playwright → 关闭（失败自动 dump 日志到 logs/）
```

**Playwright 测试是主力测试**，覆盖整条链路：浏览器 → Next.js → Gateway WebSocket → Claude → Django API。不要用 vitest + raw WebSocket 写"假端到端"。

## Design Principle: 先找参考再动手

**写任何模块之前，先想"谁做过类似的"，找到优秀的开源实现作为参考。** 不管是大架构还是小模块，优先迁移已验证的设计，而不是从零发明。

- 动手前先问：有没有开源项目已经解决了这个问题？
- 找到参考后，理解它的设计意图，再迁移到本项目的上下文中
- 这不是盲目 copy-paste，而是站在别人验证过的设计上做适配

## Key Rules

- **MCP 和 invite code 是两套完全独立的系统，绝对不要混在一起**
- MCP 走标准 OAuth，不涉及 invite code
- Invite code 只用于 Invitation Mode（web chat + chat logs）
- Owner auth: `smo_xxx` tokens
- Visitor auth (Invitation Mode): `sm_xxx` invite codes

## Commands

**所有 Docker 操作在 repo root 用 Makefile 跑：**

```bash
# 开发环境（自动 clean 旧容器再启动）
make dev                # 前台启动全部（db, server, gateway, web），看日志
make dev-up             # 后台启动全部，等 healthy
make dev-down           # 关闭开发环境

# Demo 数据（dev 环境启动后执行）
make populate           # 填充 demo content + roles + invite codes，幂等可重复跑

# 测试（自动 clean → 启动 test infra → 跑测试 → dump 日志 → 关闭）
make test               # 一键跑全部测试（server pytest + gateway vitest + web playwright），失败自动 dump 日志到 logs/

# 部署
make deploy             # build + docker compose up
make build              # 验证所有子项目能 build（client tsc + web next build + docker build）

# 清理
make clean              # 关闭所有 compose + 清理 volumes
```

**所有测试都在 Docker 里跑，不需要宿主机安装 Python/Node 等依赖。`make test` 一条命令搞定。**

直接跑子项目（不经过 Docker，开发用）：

```bash
cd server && uv run uvicorn standmeet.asgi:application
cd gateway && npm start
cd standmeet-client && npx tsc
cd web && npm run dev
```

## Git Commits

- **Never add `Co-Authored-By` lines** in commit messages
