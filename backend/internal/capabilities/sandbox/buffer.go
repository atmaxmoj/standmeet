// buffer.go —— cappedBuffer backstops sandbox stdout/stderr so a runaway
// script dumping GB-scale output can't blow up the backend's memory. Past
// the cap, further writes are dropped, and "…[truncated]" is appended to
// stdout so the caller knows.

package sandbox

import "sync"

const truncatedMark = "…[truncated]"

type cappedBuffer struct {
	buf  []byte
	mu   sync.Mutex
	cap  int
	done bool // truncated mark already written
}

func newCappedBuffer(capBytes int) *cappedBuffer {
	return &cappedBuffer{cap: capBytes}
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.done {
		// Pretend the write succeeded so exec doesn't block on the stdout pipe.
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
