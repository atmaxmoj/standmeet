// Package snowflake generates globally-unique, time-ordered 63-bit ids with no central
// coordination, and encodes them base62 into short URL-safe slugs. It backs the default
// access_codes.slug (a code whose owner didn't choose a path gets one from here). Snowflakes beat a
// DB sequence for a future multi-node cloud product: each node stamps its own ids from
// (time, node, sequence), and they never collide or go backwards — no shared counter.
//
// Layout (high→low): 41 bits ms since EPOCH · 10 bits node · 12 bits sequence = 63 bits (a positive
// int64). ~69 years from EPOCH; 1024 nodes; 4096 ids per node per millisecond.
package snowflake

import (
	"fmt"
	"sync"
	"time"
)

const (
	// EPOCH — 2026-01-01Z in ms; ids are the offset from here (keeps the timestamp small).
	epochMs      = 1767225600000
	base62Radix  = 62
	nodeBits     = 10
	seqBits      = 12
	maxNode      = (1 << nodeBits) - 1 // 1023
	maxSeq       = (1 << seqBits) - 1  // 4095
	nodeShift    = seqBits
	timeShift    = seqBits + nodeBits
	maxBase62Len = 11 // a 63-bit id is at most 11 base62 digits
)

// Node stamps ids for one logical node. Safe for concurrent use.
type Node struct {
	// now is an injectable ms clock (tests); first field so the GC pointer scan is one word.
	now    func() int64
	mu     sync.Mutex
	nodeID int64
	lastMs int64
	seq    int64
}

// New builds a Node. nodeID must be in [0, 1023].
func New(nodeID int64) (*Node, error) {
	if nodeID < 0 || nodeID > maxNode {
		return nil, fmt.Errorf("snowflake: node id %d out of range [0,%d]", nodeID, maxNode)
	}
	return &Node{nodeID: nodeID, now: nowMs}, nil
}

func nowMs() int64 { return time.Now().UnixMilli() }

// Next returns the next id: monotonically increasing, unique for this node. If the millisecond's
// sequence is exhausted it spins to the next millisecond, so ids never collide or go backwards.
func (n *Node) Next() int64 {
	n.mu.Lock()
	defer n.mu.Unlock()
	ms := n.now()
	if ms == n.lastMs {
		n.seq = (n.seq + 1) & maxSeq
		if n.seq == 0 {
			for ms <= n.lastMs {
				ms = n.now()
			}
		}
	} else {
		n.seq = 0
	}
	n.lastMs = ms
	return ((ms - epochMs) << timeShift) | (n.nodeID << nodeShift) | n.seq
}

// Slug returns the next id base62-encoded — a short, URL-safe, time-ordered string.
func (n *Node) Slug() string { return base62(n.Next()) }

const base62Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// base62 encodes a non-negative int64. 0 → "0".
func base62(v int64) string {
	if v <= 0 {
		return "0"
	}
	buf := make([]byte, 0, maxBase62Len)
	for v > 0 {
		buf = append(buf, base62Alphabet[v%base62Radix])
		v /= base62Radix
	}
	// reverse (most-significant first, so ids sort lexically close to numerically)
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}
