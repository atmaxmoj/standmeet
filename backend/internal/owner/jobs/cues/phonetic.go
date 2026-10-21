// phonetic.go —— how a word sounds, roughly: its consonant skeleton. The rewrite layer may put
// one of the owner's names in place of what speech recognition heard only when the two sound
// alike ("BRAP" → bwrap, "doctor" → Docker); a name that sounds like nothing in the line is noise
// made into a name ("Coopatavi" → Kubernetes) and is refused.

package cues

import (
	"slices"
	"strings"
)

// soundOf —— letters that sound alike map to one ("b" and "p", "d" and "t", …); vowels, "h", "w"
// and "y" carry no consonant and are dropped.
var soundOf = map[rune]rune{
	'b': 'p', 'p': 'p', 'f': 'f', 'v': 'f', 'd': 't', 't': 't', 'g': 'k', 'k': 'k', 'c': 'k',
	'q': 'k', 'x': 'k', 's': 's', 'z': 's', 'j': 'j', 'l': 'l', 'r': 'r', 'm': 'm', 'n': 'n',
}

// skeleton —— the word's consonants, alike sounds merged, a doubled one kept once.
func skeleton(word string) string {
	var b strings.Builder
	var last rune
	for _, r := range strings.ToLower(word) {
		s, ok := soundOf[r]
		if !ok || s == last {
			continue
		}
		b.WriteRune(s)
		last = s
	}
	return b.String()
}

// editDistance —— Levenshtein over bytes (skeletons are ASCII).
func editDistance(a, b string) int {
	prev := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur := make([]int, len(b)+1)
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(b)]
}

// soundsLike —— whether some word of heard, or two neighbouring words glued ("post grey"),
// sounds like name: skeletons at most one sound apart, and the name has at least two sounds.
func soundsLike(heard []string, name string) bool {
	want := skeleton(name)
	if len(want) < 2 {
		return false
	}
	grams := append([]string{}, heard...)
	for i := 1; i < len(heard); i++ {
		grams = append(grams, heard[i-1]+heard[i])
	}
	return slices.ContainsFunc(grams, func(g string) bool {
		return editDistance(skeleton(g), want) <= 1
	})
}
