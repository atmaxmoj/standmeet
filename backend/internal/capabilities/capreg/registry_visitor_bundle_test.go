// registry_visitor_bundle_test.go —— 开一场会话时,各能力的实例化必须**并发**。
//
// `/api/v1/sessions` 要拿到全部能力的 tool spec,所以它躲不开"每个能力都拨一次" ——
// 但没有理由一个一个拨。每个外置能力实例化 = 起一个 bwrap 沙箱(冷启约 1 秒),串行就是
// N 秒起步;实测负载下 `/api/v1/sessions` 要 13.9 秒,而访客侧 15 秒就放弃 —— 差一点点,
// 表现成"会话偶尔打不开"。
//
// (#17 收的是**单次工具调用**那条路 —— 只拨提供该 tool 的那一个。会话打开这条要全部,
// 所以那次的办法在这里不适用,能省的只有等待方式。)
//
// **断言是结构性的,不掐秒表**:秒表随机器飘,而且"快了"不等于"并发了"。判据是
// **同时在飞的峰值**:串行恒为 1(一个进一个出),并发才等于 n。
//
// 第一版我拿"四个都到过屏障"当判据,结果它**绿了** —— 而装配明明是串行的:串行时最后一个
// 到达也让"四个都到过"成立。那是一条不会红的断言(见 [[assertion-that-cannot-fail]]),
// 而且我还顺手把耗时阈值也算错了(串行是 (n-1)×timeout,不是 n×)。留在这里当反面样本:
// **"都发生过"和"同时发生"是两回事**,而只有后者是并发。

package capreg_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// inFlight —— 记"同时在 VisitorBinding 里面的能力数"和它的峰值。
//
// **峰值才是判据**:串行恒为 1(一个进一个出),并发才会大于 1。第一版我拿"四个都到过屏障"
// 当判据,那是一条**不会红的断言** —— 串行时最后一个到达也满足它。
type inFlight struct {
	mu   sync.Mutex
	now  int
	peak int
}

func (f *inFlight) enter() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now++
	if f.now > f.peak {
		f.peak = f.now
	}
}

func (f *inFlight) leave() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now--
}

func (f *inFlight) max() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.peak
}

// barrierCap —— 进 VisitorBinding 就报到并停住,等所有人到齐(或超时)。
// 停住是为了让"同时在飞"这件事可观测:一进一出的话峰值永远是 1,并发也看不出来。
type barrierCap struct {
	flight  *inFlight
	arrived *sync.WaitGroup
	allHere chan struct{}
	once    *sync.Once
	id      string
	timeout time.Duration
}

func (c *barrierCap) ID() string        { return c.id }
func (*barrierCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (c *barrierCap) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	c.flight.enter()
	defer c.flight.leave()
	c.arrived.Done()
	c.once.Do(func() {
		go func() { c.arrived.Wait(); close(c.allHere) }()
	})
	select {
	case <-c.allHere: // 大家都在里面 —— 并发
	case <-time.After(c.timeout): // 串行:没人会跟上来,等到超时自己走
	}
	return &capreg.Binding{
		Tools: []capreg.BindingTool{capreg.NewTool(c.id+"_tool", c.id, "", nil, nil)},
		State: capreg.CapabilityState{ID: c.id, Enabled: true},
	}, nil
}

func (*barrierCap) OwnerMCPBindings() []*capreg.MCPBinding { return []*capreg.MCPBinding{} }
func (*barrierCap) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*barrierCap) SystemPromptFragmentID(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

const barrierWait = 300 * time.Millisecond

// 四个能力必须**同时**在飞。判据是在飞峰值:串行恒为 1,并发才是 4。
func TestAssembleVisitorBundle_DialsCapabilitiesConcurrently(t *testing.T) {
	t.Parallel()
	ids := []string{"cap.a", "cap.b", "cap.c", "cap.d"}
	reg, flight := barrierRegistry(ids)

	bundle := reg.AssembleVisitorBundle(context.Background(), &capreg.AssembleInput{
		OwnerID: "owner-1", Mode: "code",
	})

	require.Len(t, bundle.States, len(ids))
	require.Equal(t, len(ids), flight.max(),
		"capabilities were instantiated one at a time (peak in-flight 1) — "+
			"opening one session pays N sandbox cold starts back to back")
}

// barrierRegistry —— n 个互相等待的假能力 + 它们共用的在飞计数。
func barrierRegistry(ids []string) (*capreg.Registry, *inFlight) {
	reg := capreg.NewRegistry()
	flight := &inFlight{}
	var arrived sync.WaitGroup
	arrived.Add(len(ids))
	allHere := make(chan struct{})
	var once sync.Once
	for _, id := range ids {
		reg.MustRegister(&barrierCap{
			id: id, flight: flight, arrived: &arrived, allHere: allHere,
			once: &once, timeout: barrierWait,
		})
	}
	return reg, flight
}

// 顺序是契约的一部分:AssembleVisitor 的注释写着"返回顺序与 Register 顺序一致",
// 前端的能力列表、prompt part 的拼接顺序都靠它。并发化最容易弄丢的就是这个。
func TestAssembleVisitorBundle_KeepsRegistrationOrder(t *testing.T) {
	t.Parallel()
	ids := []string{"cap.a", "cap.b", "cap.c", "cap.d"}
	reg, _ := barrierRegistry(ids)

	bundle := reg.AssembleVisitorBundle(context.Background(), &capreg.AssembleInput{
		OwnerID: "owner-1", Mode: "code",
	})

	gotStates := make([]string, 0, len(ids))
	for i := range bundle.States {
		gotStates = append(gotStates, bundle.States[i].ID)
	}
	require.Equal(t, ids, gotStates, "states must come back in registration order")

	gotTools := make([]string, 0, len(ids))
	for i := range bundle.ToolSpecs {
		gotTools = append(gotTools, bundle.ToolSpecs[i].Name)
	}
	require.Equal(t,
		[]string{"cap.a_tool", "cap.b_tool", "cap.c_tool", "cap.d_tool"}, gotTools,
		"tool specs must come back in registration order too")
}
