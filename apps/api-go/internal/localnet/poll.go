package localnet

import "time"

// POLL-VOTE-001 — 帖内投票。
//
// 为什么要有这个文件：投票的 UI 早就做完了（ComposerV2Screen 的「添加投票」、
// 增删选项、选时长），发布时客户端也老老实实把 `payload.poll` 发上来了，
// 但服务端**一个 poll 字段都没有**，整件事停在「正文里躺着一段看起来像投票的
// 文本」。投票跟 24h 动态（GHOST-24H-001）是同一种缺陷：写出来像有，实际没有 ——
// 只是它更尴尬，因为「投票」这个词本身就承诺了两件事：能投、有结果。
//
// 口径（迁移 091 里有完整论证，这里只留结论）：
//   - 投票是帖子的附属物，1:1，随帖子级联删除。
//   - 一人一票；再投 = 改票（UPSERT），仍然只算一票。
//   - 票数永远 COUNT(*) 现算，不落计数字段 —— 计数列一定会跟 votes 表慢慢
//     对不上，而对不上时你无法判断谁是对的。
//   - 到期只关闭投票、不隐藏结果。
//   - multiSelect 明确不支持且显式拒绝，绝不静默降级成单选。

const (
	minPollOptions   = 2
	maxPollOptions   = 8
	maxPollLabelRune = 80
)

// PostPoll 是投票的**写**模型：只有结构，没有票数。
// 票数在读时聚合（见 PostPollView）。
type PostPoll struct {
	PostID    string
	ExpiresAt *time.Time
	Options   []PostPollOption
}

// PostPollOption 是一个选项。OptionID 由客户端生成（opt_<ts>_<idx>）以保证
// 「同一条帖子的选项」在多次发布之间有稳定标识；服务端在缺失时补一个。
type PostPollOption struct {
	OptionID  string
	Label     string
	SortOrder int
}

// PostPollView 是投票的**读**模型：结构 + 票数 + 我投了哪个 + 是否已关闭。
//
// 三个字段是刻意这么切的：
//   - VoteCount 让客户端能直接画出百分比条，不必自己再聚合一遍；
//   - VotedOptionID 只对当前浏览者有意义（每人看到的"我投了哪个"不同），
//     所以它是 per-viewer 的，不能缓存进帖子本身；
//   - Closed 是服务端按时钟算的，客户端不该自己判 —— 客户端时钟可以对不上，
//     而"到底还能不能投"必须以服务端为准。
type PostPollView struct {
	Options       []PostPollOptionView `json:"options"`
	TotalVotes    int                  `json:"totalVotes"`
	VotedOptionID string               `json:"votedOptionId,omitempty"`
	ExpiresAt     *time.Time           `json:"expiresAt,omitempty"`
	Closed        bool                 `json:"closed"`
}

// PostPollOptionView 是带票数的选项。
type PostPollOptionView struct {
	OptionID  string `json:"optionId"`
	Label     string `json:"label"`
	SortOrder int    `json:"sortOrder"`
	VoteCount int    `json:"voteCount"`
}

// pollIsClosed 报告投票是否已经截止。ExpiresAt 为 nil = 永不截止。
//
// 注意是 `!After` 而不是 `Before`：到期时刻**本身**就算截止，跟
// postIsExpired 保持同一套边界口径，避免出现"两个功能对'刚好到期'给出
// 不同答案"这种最难排查的不一致。
func pollIsClosed(expiresAt *time.Time, now time.Time) bool {
	if expiresAt == nil {
		return false
	}
	return !expiresAt.After(now)
}

// newPostPollView 把写模型 + 票数 + 浏览者的票拼成读模型。
//
// counts 的 key 是 optionID；没有票的选项也要出现在结果里（0 票），否则
// 用户会看到"选项不见了"。选项一律按 sortOrder 升序输出，保证服务端顺序
// 稳定 —— 客户端不应该自己排序，否则同一条投票在不同端顺序不同。
func newPostPollView(poll PostPoll, counts map[string]int, votedOptionID string, now time.Time) PostPollView {
	options := make([]PostPollOptionView, 0, len(poll.Options))
	total := 0
	for _, opt := range poll.Options {
		n := counts[opt.OptionID]
		total += n
		options = append(options, PostPollOptionView{
			OptionID:  opt.OptionID,
			Label:     opt.Label,
			SortOrder: opt.SortOrder,
			VoteCount: n,
		})
	}
	sortPollOptionViews(options)
	return PostPollView{
		Options:       options,
		TotalVotes:    total,
		VotedOptionID: votedOptionID,
		ExpiresAt:     poll.ExpiresAt,
		Closed:        pollIsClosed(poll.ExpiresAt, now),
	}
}

// sortPollOptionViews 按 sortOrder 升序；sortOrder 相同时按 optionID，
// 保证顺序完全确定（map 遍历顺序是不稳定的，不补这个 tie-break 会让同一条
// 投票在两次请求里顺序不同，客户端 diff 出幽灵重排）。
func sortPollOptionViews(options []PostPollOptionView) {
	for i := 1; i < len(options); i++ {
		for j := i; j > 0; j-- {
			a, b := options[j-1], options[j]
			if a.SortOrder < b.SortOrder {
				break
			}
			if a.SortOrder == b.SortOrder && a.OptionID <= b.OptionID {
				break
			}
			options[j-1], options[j] = b, a
		}
	}
}

// PostPollTally 是仓储层返回的**原始**聚合结果。
//
// 为什么不让仓储层直接返回 PostPollView：Closed 依赖"现在几点"，而测试用的是
// 假时钟（service 自己的 clock）。如果仓储层用 SQL 的 now() 自己判截止，
// 那么"把时钟拨到到期之后"这类用例就永远测不到 —— 服务端判截止必须用
// service 的时钟，这是唯一能把时间注入进来的地方。
type PostPollTally struct {
	Poll          PostPoll
	Counts        map[string]int
	VotedOptionID string
}

// pollTotalVotes 汇总票数。
func pollTotalVotes(counts map[string]int) int {
	total := 0
	for _, n := range counts {
		total += n
	}
	return total
}
