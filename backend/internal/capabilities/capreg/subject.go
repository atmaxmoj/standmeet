// subject.go —— 一场会话**以谁的身份**在跑。
//
// 凡是「每个 X 多少次」的规则(能力配额)都挂在它上面。以前装配输入里只有 `CodeID` —— 一个只
// 认得邀请码的名字。于是对外 API key 那条路上没有主体可数,一把 key 订会一次都不闸,真日历上
// 想塞多少塞多少(F-B-11)。
//
// 这个类型只说「是谁」。「上限存在哪」是 capconfig 的事(它有自己的 Scope),两个包互不认识,
// 由组装根把这句话翻过去 —— 见 axiscap 的 quotaScope。

package capreg

// SubjectKind —— 主体的种类。目前两种:一张邀请码,或一把对外 API key。
type SubjectKind string

const (
	// SubjectCode —— 访客拿着一张邀请码进来的那条路。
	SubjectCode SubjectKind = "code"
	// SubjectAPIKey —— 别人的程序拿着一把 smk_ key 调进来的那条路。
	SubjectAPIKey SubjectKind = "api_key"
)

// Subject —— 主体的种类 + 它的 id。两者一起走:光有 id 认不出该去哪儿读上限,而两类 id
// 长得一模一样(都是 UUID)。
type Subject struct {
	Kind SubjectKind
	ID   string
}

// Anonymous —— 没有主体(public / byoai 这类既没有码也没有 key 的会话)。这类会话不闸用量:
// 它们连"这一位是谁"都答不出来,更谈不上"这一位用了几次"。
func (s Subject) Anonymous() bool { return s.ID == "" }
