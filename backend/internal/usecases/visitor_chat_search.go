// visitor_chat_search.go —— mock-friendly substring search helpers shared by
// the retrieval tools。stopwords 走 github.com/bbalet/stopwords (mature 英文
// stopword list)，把 "tell me about lucerna" 之类的招呼词砍掉，AI 才能挑到
// "lucerna" 这种有信息量的 token。

package usecases

import (
	"strings"

	"github.com/bbalet/stopwords"
)

// textMatchesQuery —— token-based 子串匹配。query 拆 token，任意 token
// 在 title/body/tags 里 substring 命中即算 match。query 为空 → 全部 match
// (list-like behavior)。
func textMatchesQuery(q, title, body string, tags []string) bool {
	tokens := queryTokens(q)
	if len(tokens) == 0 {
		return true
	}
	hay := strings.ToLower(title + " " + body)
	for _, tok := range tokens {
		if strings.Contains(hay, tok) || anyTagMatches(tok, tags) {
			return true
		}
	}
	return false
}

// queryTokens —— bbalet/stopwords 过英文常用词 (the/me/your/about/tell …)
// 再 split + ≥3 字符门限。避免 visitor 的招呼语把 about-me 这种 token-rich
// title 误匹上。
func queryTokens(q string) []string {
	cleaned := stopwords.CleanString(q, "en", false)
	raw := strings.Fields(cleaned)
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		if len(t) >= 3 {
			out = append(out, t)
		}
	}
	return out
}

func anyTagMatches(q string, tags []string) bool {
	for _, t := range tags {
		if strings.Contains(strings.ToLower(t), q) {
			return true
		}
	}
	return false
}
