// buffer.go —— cappedBuffer 给 sandbox stdout/stderr 兜底，避免一个失控
// 脚本吐 GB 级输出把 backend 内存撑爆。超过 cap 后丢弃后续写入，stdout
// 末尾追"…[truncated]" 让 caller 知道。

package sandbox

import "sync"

const truncatedMark = "…[truncated]"

type cappedBuffer struct {
	buf  []byte
	mu   sync.Mutex
	cap  int
	done bool // 已经写过 truncated 标记
}

func newCappedBuffer(capBytes int) *cappedBuffer {
	return &cappedBuffer{cap: capBytes}
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.done {
		// 假装写了，让 exec 不阻塞 stdout pipe。
		return len(p), nil
	}
	room := b.cap - len(b.buf)
	if room <= 0 {
		b.markTruncated()
		return len(p), nil
	}
	if len(p) <= room {
		b.buf = append(b.buf, p...)
		return len(p), nil
	}
	b.buf = append(b.buf, p[:room]...)
	b.markTruncated()
	return len(p), nil
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.buf)
}

func (b *cappedBuffer) markTruncated() {
	if b.done {
		return
	}
	b.buf = append(b.buf, []byte(truncatedMark)...)
	b.done = true
}
