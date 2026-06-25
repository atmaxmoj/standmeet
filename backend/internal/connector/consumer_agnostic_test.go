// consumer_agnostic_test.go —— 守卫：connector 是**消费者无关、双向**的底座。
//
// 动机（详见 hub.go）：把连接器拉到一个**完全非 MCP** 的消费路径 + **双向**（read+write），
// 锁死两件事，任何后续改动都不许破：
//
//  1. 一个**不 import capreg（MCP 包）**的消费者 —— 这里的 fakeGateway，代表将来的 IM
//     Gateway / 任务编排 —— 也能按名解析连接器、双向用它。本测试文件的 import 列表里**没有
//     capreg**，这就是编译期的证明：连接器跟 MCP 完全解耦。
//
//  2. 凭据从不出连接器：Gateway / agent 侧拿到的是句柄（Connector + 能力接口），read 和
//     write 都不漏 token / secret —— 句柄面上根本没有掏凭据的方法。
//
// 场景（owner 在 IM 被 @ → Gateway 唤起 agent → agent 用连接器凭据消费 channel 记录，
// 再用同一凭据发回）：
//
//	IM Gateway ──唤起──> agent
//	                      │ ① ReadChannel：用连接器凭据消费 channel 历史（进上下文）
//	                      │ ② Send：用同一凭据把回复发回 channel
//	                      ▼
//	                 discord 连接器（持 bot token，双向，凭据只在内部）
//
// 一个底座、多个消费者：capreg 的 enabledCaps gate 是「MCP 那个消费者」，本测试是「IM
// Gateway 那个消费者」，将来共用同一个 Hub。
package connector_test

import (
	"context"
	"errors"
	"reflect"
	"regexp"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/stretchr/testify/require"
)

var (
	errNoConnector  = errors.New("gateway: discord connector not registered")
	errNotMessenger = errors.New("gateway: discord connector is not a messenger")
)

// fakeDiscord —— 一个**双向** IM 连接器：持 bot token（凭据只活在连接器内部），能 read
// channel 历史 + send 消息。对外（句柄面）**没有任何掏 token 的方法**。
type fakeDiscord struct {
	botToken string              // 凭据：只在连接器内部用，绝不经句柄漏出去
	history  map[string][]string // channel → 历史消息（read 用）
	sent     map[string][]string // channel → 已发消息（write 落点）
}

func (d *fakeDiscord) Name() string { return "discord" }

func (d *fakeDiscord) Connected(_ context.Context, _ string) (bool, error) {
	return d.botToken != "", nil
}

// ReadChannel —— 用 botToken 调 IM API 拉 channel 历史（此处省略真调用）。
func (d *fakeDiscord) ReadChannel(_ context.Context, _, channel string) ([]string, error) {
	_ = d.botToken // 凭据在内部使用
	return d.history[channel], nil
}

// Send —— 用 botToken 把消息发回 channel。
func (d *fakeDiscord) Send(_ context.Context, _, channel, msg string) error {
	_ = d.botToken
	d.sent[channel] = append(d.sent[channel], msg)
	return nil
}

// messenger —— 消费者眼里 IM 连接器的能力接口（read + write）。消费者按名解析到
// connector.Connector 后，类型断言到它。**接口里没有任何凭据 getter**。
type messenger interface {
	ReadChannel(ctx context.Context, ownerID, channel string) ([]string, error)
	Send(ctx context.Context, ownerID, channel, msg string) error
}

// fakeGateway —— 代表将来的 IM Gateway / 任务编排：owner 在 IM 被 @ 唤起 → 用连接器凭据
// 消费 channel 记录进上下文 →（agent 处理）→ 用同一凭据发回复。**全程不碰 MCP / capreg。**
type fakeGateway struct{ hub *connector.Hub }

func (g *fakeGateway) handleMention(
	ctx context.Context, owner, channel, agentReply string,
) ([]string, error) {
	c, ok := g.hub.Resolve("discord")
	if !ok {
		return nil, errNoConnector
	}
	im, ok := c.(messenger)
	if !ok {
		return nil, errNotMessenger
	}
	history, err := im.ReadChannel(ctx, owner, channel) // ① 用凭据消费 channel 记录
	if err != nil {
		return nil, err
	}
	return history, im.Send(ctx, owner, channel, agentReply) // ② 用同一凭据发回去
}

func TestConnector_ConsumerAgnostic_BidirectionalGateway(t *testing.T) {
	t.Parallel()
	disc := &fakeDiscord{
		botToken: "super-secret-bot-token",
		history:  map[string][]string{"#general": {"hi", "anyone around?"}},
		sent:     map[string][]string{},
	}
	hub := connector.NewHub()
	hub.Register(disc)

	gw := &fakeGateway{hub: hub}
	history, err := gw.handleMention(
		context.Background(), "owner-1", "#general", "hello from the agent")
	require.NoError(t, err)

	// 双向都通：read 拿到了 channel 历史（进 agent 上下文）……
	require.Equal(t, []string{"hi", "anyone around?"}, history, "agent 经连接器凭据读到了 channel 历史")
	// ……send 把回复发了出去。
	require.Equal(t, []string{"hello from the agent"}, disc.sent["#general"], "agent 经同一凭据发回了 channel")

	// 凭据不泄漏：Gateway 拿到的句柄（messenger 接口）面上没有任何掏 token 的方法。
	assertHandleHasNoCredGetter(t, reflect.TypeOf((*messenger)(nil)).Elem())
	assertHandleHasNoCredGetter(t, reflect.TypeOf((*connector.Connector)(nil)).Elem())
}

var credRe = regexp.MustCompile(`(?i)token|secret|password|credential|apikey`)

func assertHandleHasNoCredGetter(t *testing.T, iface reflect.Type) {
	t.Helper()
	for i := 0; i < iface.NumMethod(); i++ {
		name := iface.Method(i).Name
		require.Falsef(t, credRe.MatchString(name),
			"connector 句柄接口 %s 暴露了凭据方法 %q —— 凭据必须留在连接器内", iface, name)
	}
}
