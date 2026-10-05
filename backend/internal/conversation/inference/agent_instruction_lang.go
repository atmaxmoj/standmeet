// agent_instruction_lang.go —— which language the visitor's page shows, and so which language
// the answer is written in (owner 2026-10-04: the language "要注入给agent的也要注入给sdk").

package inference

// pageLangNames —— the page languages a turn may name, as the model reads them. Only these codes
// reach the prompt: the code comes from the browser, so anything else adds nothing.
var pageLangNames = map[string]string{
	"en": "English", "zh": "Simplified Chinese", "zh-HK": "Traditional Chinese (Hong Kong)",
	"fr": "French", "hi": "Hindi", "de": "German", "ja": "Japanese", "ko": "Korean",
	"es": "Spanish",
}

// instructionWithPageLang —— appends the page's language as the fallback. A visitor is answered in
// the language they write in; a message in no language at all ("👋", "?", "MCP") is answered in
// the page's language. A one-word English message is English: the model reads it so, and telling
// it otherwise made it flip either way (eval page-lang). Unknown or empty → unchanged.
func instructionWithPageLang(system, lang string) string {
	name, ok := pageLangNames[lang]
	if !ok {
		return system
	}
	// The visitor's own language is the rule and the page's only the fallback, named once at
	// the end. Leading with "the visitor is reading this page in <page language>" let the page
	// win over a full English question in 1 of 12, then 1 of 18 answers (eval page-lang).
	return system + "\n\nLanguage of your answer: the language the visitor's message is written " +
		"in. A full sentence in English gets an English answer, " +
		"a full sentence in Chinese a Chinese " +
		"one, whatever the page shows. Only when the message is in no language at all (an emoji, " +
		"punctuation, a name or an acronym on its own) use the language of the page they are " +
		"reading, which is " + name + "."
}
