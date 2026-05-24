// visitor_chat_collector.go —— readCollector：AI 实际通过 read_corpus_entry
// 拿到的 entry 列表。show_as_source=false 拿到 body 但不进 collector
// （"读不挂"，让 meta/persona 这种 entry 可用但不曝光给访客 cited footer）。

package usecases

import (
	"sync"

	"github.com/wangsijie/standmeet/internal/domain"
)

type readCollector struct {
	seenWiki   map[string]bool
	seenOutput map[string]bool
	wikis      []domain.WikiEntry
	outputs    []domain.OutputEntry
	mu         sync.Mutex
}

func newReadCollector() *readCollector {
	return &readCollector{
		seenWiki:   map[string]bool{},
		seenOutput: map[string]bool{},
	}
}

func (c *readCollector) addWiki(w *domain.WikiEntry) {
	if !w.ShowAsSource {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seenWiki[w.ID] {
		return
	}
	c.seenWiki[w.ID] = true
	c.wikis = append(c.wikis, *w)
}

func (c *readCollector) addOutput(o *domain.OutputEntry) {
	if !o.ShowAsSource {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seenOutput[o.ID] {
		return
	}
	c.seenOutput[o.ID] = true
	c.outputs = append(c.outputs, *o)
}

// snapshot —— 返 collector 累计的 wiki + output 副本（去 sync 暴露原 slice 危险）。
func (c *readCollector) snapshot() ([]domain.WikiEntry, []domain.OutputEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w := make([]domain.WikiEntry, len(c.wikis))
	copy(w, c.wikis)
	o := make([]domain.OutputEntry, len(c.outputs))
	copy(o, c.outputs)
	return w, o
}
