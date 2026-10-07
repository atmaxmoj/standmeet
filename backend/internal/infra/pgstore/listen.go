// listen.go — one shared LISTEN connection per channel per process, fanning notifications out to
// in-process waiters by key.
//
// Used where a request waits briefly for background work (an event fanned out, a job finished).
// One connection serves every waiter, instead of each request polling on its own connection; and
// the number of waiters is capped, so a burst returns receipts at once instead of queueing.

package pgstore

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/sqltext"
	"github.com/jackc/pgx/v5/pgxpool"
)

const listenRetry = time.Second

// Listener — waiters keyed by string, woken by NOTIFY payloads on one channel. A payload is a
// comma-separated list of keys.
type Listener struct {
	byKey   map[string][]chan struct{}
	pool    *Pool
	log     *slog.Logger
	channel string
	mu      sync.Mutex
	n       int
	max     int
}

// Waiter — one registered waiter: Wake fires on a NOTIFY of its key; call Release when done.
type Waiter struct {
	Wake    <-chan struct{}
	Release func()
}

// NewListener — maxWaiters caps concurrent waiters.
func NewListener(pool *Pool, channel string, maxWaiters int, log *slog.Logger) *Listener {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Listener{
		pool: pool, channel: channel, max: maxWaiters, log: log,
		byKey: map[string][]chan struct{}{},
	}
}

// Run — holds the LISTEN connection until ctx ends, reconnecting on failure.
func (l *Listener) Run(ctx context.Context) {
	for ctx.Err() == nil {
		err := l.listenOnce(ctx)
		if err == nil || ctx.Err() != nil {
			continue
		}
		l.log.Warn("pgstore: listener", "channel", l.channel, "err", err)
		pause(ctx, listenRetry)
	}
}

// Register — adds a waiter for key. ok=false when the cap is reached: the caller must not wait.
// Call Release when done. Register before reading the state being waited on, so a change between
// the read and the wait cannot be missed.
func (l *Listener) Register(key string) (Waiter, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.n >= l.max {
		// a channel that never fires
		return Waiter{Wake: make(chan struct{}), Release: func() {}}, false
	}
	l.n++
	ch := make(chan struct{}, 1)
	l.byKey[key] = append(l.byKey[key], ch)
	return Waiter{Wake: ch, Release: func() { l.release(key, ch) }}, true
}

// Await — true on a wake-up; false when timeout fires or ctx ends first.
func (w Waiter) Await(ctx context.Context, timeout <-chan time.Time) bool {
	select {
	case <-w.Wake:
		return true
	case <-timeout:
		return false
	case <-ctx.Done():
		return false
	}
}

// Wake — wakes every waiter of key (without blocking).
func (l *Listener) Wake(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, ch := range l.byKey[key] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Waiting —— how many waiters are registered now.
func (l *Listener) Waiting() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.n
}

func (l *Listener) listenOnce(ctx context.Context) error {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire: %w", err)
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, sqltext.Format("LISTEN %s", l.channel)); err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	// A NOTIFY sent before this point (startup, or while reconnecting) is lost by Postgres. Every
	// waiter re-checks its state on a wake-up, so wake them all once listening has started.
	l.wakeAll()
	return l.dispatch(ctx, conn)
}

// wakeAll —— wakes every registered waiter (without blocking).
func (l *Listener) wakeAll() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, chs := range l.byKey {
		for _, ch := range chs {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	}
}

// dispatch — wakes the waiters of every key in each notification, until an error.
func (l *Listener) dispatch(ctx context.Context, conn *pgxpool.Conn) error {
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return fmt.Errorf("wait: %w", err)
		}
		for key := range strings.SplitSeq(n.Payload, ",") {
			l.Wake(key)
		}
	}
}

func (l *Listener) release(key string, ch chan struct{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.n--
	l.byKey[key] = slices.DeleteFunc(l.byKey[key], func(c chan struct{}) bool { return c == ch })
	if len(l.byKey[key]) == 0 {
		delete(l.byKey, key)
	}
}

// pause — sleeps d, or less when ctx ends first.
func pause(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// Notify — sends keys on the channel (after the caller's commit, when q is the pool).
func Notify(ctx context.Context, q DBTX, channel string, keys ...string) error {
	payload := strings.Join(keys, ",")
	if _, err := q.Exec(ctx, `SELECT pg_notify($1, $2)`, channel, payload); err != nil {
		return fmt.Errorf("notify %s: %w", channel, err)
	}
	return nil
}
