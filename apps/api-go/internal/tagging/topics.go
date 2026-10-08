package tagging

import (
	"regexp"
	"strings"
)

// 话题词表（tag-factory 的内容侧）：从帖子正文抽「这篇在讲什么」，是细粒度兴趣标签的原料。
//
// 刻意是**受控词表 + 关键词**，不是自由文本：值必须来自下面这张表，所以不会出现每个人一个怪词的
// 长尾；以后要更细，在这里加一行就行，推导逻辑不动。中 / 越 / 英三语。
//
// 刻意**没有**的话题：夜生活、按摩、KTV、陪酒这一类。不是漏了——陪同业务在越南有被认定为色情中介的
// 法律风险（见 docs/legal 的律师清单第 7 条），平台不该给用户贴「爱夜生活」这种标签，再拿去做推荐 / 撮合。
// 这类内容走举报与审核，不进画像。
type topicRule struct {
	topic    string
	keywords []string
}

var topicRules = []topicRule{
	{"咖啡", []string{"咖啡", "coffee", "cafe", "café", "cà phê", "ca phe", "拿铁", "latte"}},
	{"美食", []string{"美食", "好吃", "餐厅", "吃饭", "food", "phở", "pho", "bún chả", "bun cha", "quán ăn", "米其林", "michelin"}},
	{"夜市", []string{"夜市", "night market", "chợ đêm"}},
	{"徒步", []string{"徒步", "爬山", "登山", "hiking", "trek", "leo núi"}},
	{"骑行", []string{"骑行", "单车", "自行车", "cycling", "bike", "xe đạp"}},
	{"摄影", []string{"摄影", "拍照", "出片", "胶片", "photo", "camera", "chụp ảnh"}},
	{"展览", []string{"展览", "看展", "美术馆", "画廊", "museum", "gallery", "bảo tàng", "triển lãm"}},
	{"羽毛球", []string{"羽毛球", "cầu lông", "badminton"}},
	{"网球", []string{"网球", "tennis"}},
	{"匹克球", []string{"匹克球", "pickleball"}},
	{"跑步", []string{"跑步", "夜跑", "马拉松", "running", "marathon", "chạy bộ"}},
	{"瑜伽", []string{"瑜伽", "普拉提", "yoga", "pilates"}},
	{"健身", []string{"健身", "力量训练", "gym", "workout", "tập gym"}},
	{"篮球", []string{"篮球", "basketball", "bóng rổ"}},
	{"足球", []string{"足球", "football", "soccer", "bóng đá"}},
	{"游泳", []string{"游泳", "swimming", "bơi"}},
	{"音乐", []string{"音乐", "演出", "现场演奏", "live music", "concert", "âm nhạc"}},
	{"亲子", []string{"亲子", "带娃", "孩子", "family", "trẻ em"}},
	{"宠物", []string{"宠物", "遛狗", "pet", "thú cưng", "chó", "mèo"}},
	{"湖边", []string{"湖边", "环湖", "hồ tây", "hoàn kiếm lake", "lakeside", "hồ gươm"}},
	{"老城", []string{"老城", "phố cổ", "old quarter", "old town"}},
	{"日落", []string{"日落", "夕阳", "黄昏", "sunset", "hoàng hôn"}},
	{"海边", []string{"海边", "沙滩", "beach", "biển"}},
	{"购物", []string{"逛街", "商场", "购物", "shopping", "mall", "mua sắm"}},
	{"市集", []string{"市集", "跳蚤市场", "market", "chợ"}},
	{"手作", []string{"手作", "手工", "陶艺", "diy", "workshop", "thủ công"}},
	{"语言交换", []string{"语言交换", "练口语", "language exchange", "học tiếng"}},
	{"学习", []string{"学习", "自习", "读书", "study", "coworking", "共享办公"}},
	{"城市漫步", []string{"city walk", "citywalk", "城市漫步", "散步", "đi dạo"}},
	{"寺庙古迹", []string{"寺庙", "古迹", "寺", "temple", "pagoda", "chùa", "đền"}},
	{"露营", []string{"露营", "camping", "cắm trại"}},
	{"桌游", []string{"桌游", "剧本杀", "board game"}},
	{"电影", []string{"电影", "观影", "cinema", "movie", "phim"}},
}

type compiledTopic struct {
	topic string
	subs  []string         // 非 ASCII 关键词：子串匹配
	words []*regexp.Regexp // ASCII 关键词：词边界匹配（避免 pet 命中 carpet）
}

var compiledTopics = func() []compiledTopic {
	out := make([]compiledTopic, 0, len(topicRules))
	for _, r := range topicRules {
		c := compiledTopic{topic: r.topic}
		for _, k := range r.keywords {
			lk := strings.ToLower(k)
			if isASCII(lk) {
				c.words = append(c.words, regexp.MustCompile(`\b`+regexp.QuoteMeta(lk)+`\b`))
			} else {
				c.subs = append(c.subs, lk)
			}
		}
		out = append(out, c)
	}
	return out
}()

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

// ExtractTopics 返回正文命中的话题（去重、按词表顺序，稳定）。正文为空返回 nil。
func ExtractTopics(body string) []string {
	text := strings.ToLower(strings.TrimSpace(body))
	if text == "" {
		return nil
	}
	var out []string
	for _, c := range compiledTopics {
		hit := false
		for _, s := range c.subs {
			if strings.Contains(text, s) {
				hit = true
				break
			}
		}
		for _, w := range c.words {
			if hit {
				break
			}
			hit = w.MatchString(text)
		}
		if hit {
			out = append(out, c.topic)
		}
	}
	return out
}

// Topics 返回整张话题表（运营页展示词表规模用）。
func Topics() []string {
	out := make([]string, 0, len(topicRules))
	for _, r := range topicRules {
		out = append(out, r.topic)
	}
	return out
}
