// telegram.go —— a stand-in for the Telegram Bot API, so the dev stack's im-bridge runs its real
// Telegram adapter end to end (TELEGRAM_API_BASE_URL=http://external-mock:9000/tg).
//
//   - POST /tg/bot<token>/<method> —— the Bot API surface the adapter uses: getMe, deleteWebhook,
//     getUpdates (long poll, held up to 2 s), sendMessage (recorded); any other method answers ok.
//   - POST /__mock/tg/updates {chat_id, text} —— a person types to the bot in a private chat.
//   - GET  /__mock/tg/sent?chat_id= —— what the bot sent to that chat: text and button URLs.
//   - POST /__mock/tg/reset —— forget both.

package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// tgPollHold —— how long an empty getUpdates is held before answering [] (a real server holds up
// to the client's timeout; a short hold keeps the adapter from spinning without slowing tests).
const tgPollHold = 2 * time.Second

type tgSent struct {
	ChatID  string   `json:"chat_id"`
	Text    string   `json:"text"`
	Buttons []string `json:"buttons"`
}

type tgState struct {
	updates []map[string]any
	sent    []tgSent
	mu      sync.Mutex
	nextID  int
}

var tg = &tgState{}

func telegramRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /tg/{bot}/{method}", tg.serveBotAPI)
	mux.HandleFunc("POST /__mock/tg/updates", tg.servePushUpdate)
	mux.HandleFunc("GET /__mock/tg/sent", tg.serveSent)
	mux.HandleFunc("POST /__mock/tg/reset", tg.serveReset)
}

func tgOK(w http.ResponseWriter, result any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result}); err != nil {
		return
	}
}

func (t *tgState) serveBotAPI(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		body = map[string]any{}
	}
	switch r.PathValue("method") {
	case "getMe":
		tgOK(w, map[string]any{"id": 999, "is_bot": true, "first_name": "StandMeet",
			"username": "standmeet_mock_bot"})
	case "getUpdates":
		tgOK(w, t.awaitUpdates(r, body))
	case "sendMessage":
		tgOK(w, t.record(body))
	case "sendRichMessage", "sendRichMessageDraft":
		// Not part of the Bot API this stand-in speaks: answer as Telegram answers a method it
		// does not have, so the adapter falls back to sendMessage (answering ok:true with no
		// message made it read result.chat.id off `true` and drop every reply).
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"ok":false,"error_code":404,"description":"Not Found"}`))
	default:
		tgOK(w, true)
	}
}

// awaitUpdates —— updates at or after the offset; holds an empty answer up to tgPollHold.
func (t *tgState) awaitUpdates(r *http.Request, body map[string]any) []map[string]any {
	offset := 0
	if f, ok := body["offset"].(float64); ok {
		offset = int(f)
	}
	deadline := time.Now().Add(tgPollHold)
	for {
		if out := t.updatesFrom(offset); len(out) > 0 || time.Now().After(deadline) {
			return out
		}
		select {
		case <-r.Context().Done():
			return []map[string]any{}
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (t *tgState) updatesFrom(offset int) []map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := []map[string]any{}
	for _, u := range t.updates {
		if id, _ := u["update_id"].(int); id >= offset {
			out = append(out, u)
		}
	}
	return out
}

// tgEscaped —— a MarkdownV2 escape: Telegram shows the character, not the backslash.
var tgEscaped = regexp.MustCompile(`\\([_*\[\]()~` + "`" + `>#+\-=|{}.!\\])`)

// record —— what the person in the chat sees: MarkdownV2 escapes removed, as Telegram renders them.
func (t *tgState) record(body map[string]any) map[string]any {
	chat := tgChatID(body["chat_id"])
	text, _ := body["text"].(string)
	if mode, _ := body["parse_mode"].(string); mode == "MarkdownV2" {
		text = tgEscaped.ReplaceAllString(text, "$1")
	}
	t.mu.Lock()
	t.nextID++
	id := t.nextID
	t.sent = append(t.sent, tgSent{ChatID: chat, Text: text, Buttons: tgButtons(body["reply_markup"])})
	t.mu.Unlock()
	n, _ := strconv.Atoi(chat)
	return map[string]any{"message_id": id, "date": time.Now().Unix(), "text": text,
		"chat": map[string]any{"id": n, "type": "private"}}
}

// tgButtons —— the URL of every inline-keyboard button (reply_markup may arrive as an object or
// as its JSON text).
func tgButtons(markup any) []string {
	if s, ok := markup.(string); ok {
		var m any
		if json.Unmarshal([]byte(s), &m) == nil {
			markup = m
		}
	}
	out := []string{}
	m, _ := markup.(map[string]any)
	rows, _ := m["inline_keyboard"].([]any)
	for _, row := range rows {
		buttons, _ := row.([]any)
		for _, b := range buttons {
			if bm, ok := b.(map[string]any); ok {
				if u, ok := bm["url"].(string); ok {
					out = append(out, u)
				}
			}
		}
	}
	return out
}

func tgChatID(v any) string {
	switch c := v.(type) {
	case float64:
		return strconv.FormatInt(int64(c), 10)
	case string:
		return c
	}
	return ""
}

func (t *tgState) servePushUpdate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text   string `json:"text"`
		ChatID int64  `json:"chat_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ChatID == 0 {
		http.Error(w, "need chat_id and text", http.StatusBadRequest)
		return
	}
	t.mu.Lock()
	t.nextID++
	id := t.nextID
	person := map[string]any{"id": in.ChatID, "is_bot": false, "first_name": "Owner"}
	t.updates = append(t.updates, map[string]any{"update_id": id, "message": map[string]any{
		"message_id": id, "date": time.Now().Unix(), "text": in.Text, "from": person,
		"chat": map[string]any{"id": in.ChatID, "type": "private", "first_name": "Owner"},
	}})
	t.mu.Unlock()
	tgOK(w, true)
}

func (t *tgState) serveSent(w http.ResponseWriter, r *http.Request) {
	chat := r.URL.Query().Get("chat_id")
	t.mu.Lock()
	out := []tgSent{}
	for _, m := range t.sent {
		if chat == "" || m.ChatID == chat {
			out = append(out, m)
		}
	}
	t.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string][]tgSent{"messages": out}); err != nil {
		return
	}
}

func (t *tgState) serveReset(w http.ResponseWriter, _ *http.Request) {
	t.mu.Lock()
	t.updates, t.sent = nil, nil
	t.mu.Unlock()
	tgOK(w, true)
}
