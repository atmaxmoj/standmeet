// calls.go —— one call's state: the conversation so far (what the model sees before the newest
// line, as the desktop app kept it) and the applied job the call locked onto. Kept in Redis by
// call id, expiring with the feed, so any driver of the same call — the desktop app, a mock-
// interview agent — continues the same conversation.

package cues

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// historyTurns —— the app kept the last 20 messages after adding the newest line.
const historyTurns = 20

// Message —— one turn of a call: role user (the other side's line) or assistant (the card). A user
// turn also carries the metadata the follow-up classifier reads off the chain (spec A §1/§2): a
// stable turn id and the owner-project slugs that turn named. Both are omitempty and absent on
// turns written before this field existed, so an old call simply inherits nothing (fail closed).
type Message struct {
	Role    string   `json:"role"`
	Content string   `json:"content"`
	TurnID  string   `json:"id,omitempty"`
	Named   []string `json:"named,omitempty"`
}

func historyKey(ownerID, callID string) string { return "cues:" + ownerID + ":call:" + callID }
func lockKey(ownerID, callID string) string    { return historyKey(ownerID, callID) + ":job" }

// addLine —— the newest line onto the call, trimmed to the last historyTurns; the history to send.
func (s *Store) addLine(ctx context.Context, ownerID, callID string, m Message) ([]Message, error) {
	raw, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("cues call marshal: %w", err)
	}
	key := historyKey(ownerID, callID)
	var rows *redis.StringSliceCmd
	_, err = s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.RPush(ctx, key, raw)
		p.LTrim(ctx, key, -historyTurns, -1)
		p.Expire(ctx, key, ttl)
		rows = p.LRange(ctx, key, 0, -1)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("cues call history: %w", err)
	}
	out := make([]Message, 0, len(rows.Val()))
	for _, r := range rows.Val() {
		var msg Message
		if json.Unmarshal([]byte(r), &msg) == nil {
			out = append(out, msg)
		}
	}
	return out, nil
}

// callLines —— the other side's last n lines in this call, oldest first.
func (s *Store) callLines(ctx context.Context, ownerID, callID string, n int) ([]string, error) {
	rows, err := s.rdb.LRange(ctx, historyKey(ownerID, callID), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("cues call history: %w", err)
	}
	lines := userLines(rows)
	return lines[max(0, len(lines)-n):], nil
}

func userLines(rows []string) []string {
	lines := []string{}
	for _, r := range rows {
		var msg Message
		if json.Unmarshal([]byte(r), &msg) == nil && msg.Role == "user" {
			lines = append(lines, msg.Content)
		}
	}
	return lines
}

// callChain —— the call's user turns so far as the classifier sees them (id, text, named
// projects), oldest first. The caller drops the last turn (the line just added) before classifying.
func (s *Store) callChain(ctx context.Context, ownerID, callID string) ([]ChainTurn, error) {
	rows, err := s.rdb.LRange(ctx, historyKey(ownerID, callID), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("cues call chain: %w", err)
	}
	turns := make([]ChainTurn, 0, len(rows))
	for _, r := range rows {
		var msg Message
		if json.Unmarshal([]byte(r), &msg) == nil && msg.Role == "user" {
			turns = append(turns,
				ChainTurn{ID: msg.TurnID, Text: msg.Content, NamedProjects: msg.Named})
		}
	}
	return turns, nil
}

// addCard —— the finished card, after the line it answered.
func (s *Store) addCard(ctx context.Context, ownerID, callID, card string) error {
	raw, err := json.Marshal(Message{Role: "assistant", Content: card})
	if err != nil {
		return fmt.Errorf("cues call marshal: %w", err)
	}
	if err = s.rdb.RPush(ctx, historyKey(ownerID, callID), raw).Err(); err != nil {
		return fmt.Errorf("cues call card: %w", err)
	}
	return nil
}

// lockedJob —— the job the call locked onto; a zero Job (no company) when it has none yet.
func (s *Store) lockedJob(ctx context.Context, ownerID, callID string) (Job, error) {
	var j Job
	raw, err := s.rdb.Get(ctx, lockKey(ownerID, callID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return j, nil
	}
	if err != nil {
		return j, fmt.Errorf("cues call lock: %w", err)
	}
	if err = json.Unmarshal(raw, &j); err != nil {
		return Job{}, fmt.Errorf("cues call lock: %w", err)
	}
	return j, nil
}

func (s *Store) lockJob(ctx context.Context, ownerID, callID string, j *Job) error {
	raw, err := json.Marshal(j)
	if err != nil {
		return fmt.Errorf("cues call lock: %w", err)
	}
	if err = s.rdb.Set(ctx, lockKey(ownerID, callID), raw, ttl).Err(); err != nil {
		return fmt.Errorf("cues call lock: %w", err)
	}
	return nil
}
