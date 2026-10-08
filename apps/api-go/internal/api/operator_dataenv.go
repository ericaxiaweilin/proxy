package api

import (
	"os"
	"strings"
)

// OPS-DATA-ENV-001（2026-10-08）：控制台连的是哪一套数据，必须由部署说出来，不能让读数猜。
//
// 起因是我自己在留存页上犯的一个错，值得留在代码里当反例。为了让复购率不落在测试残留行上，
// 我把分母换成「请求方能在 identity.user_accounts 里找到的订单」。这一步确实剔掉了 150 张
// 连账号都没有的行（Go 集成测试直接 INSERT 的），可剩下的 141 张也不是生意：它们的 need_id
// 是 e2e-need-* / e2e-p1e-need*，出自 scripts/*-e2e.sh —— 那批脚本走的是真 API、建的是真账号、
// 下的是真订单，只是下单的人是我写的循环。于是这页显示出 93.8% 的复购率，比原来那个 55.1%
// 更像真的，而它俩都不是任何人的行为。
//
// 结论：**经过 API 进来的合成流量在行里没有任何结构特征能和真实流量区分**。能区分它们的只有
// 「这个进程连的是哪套数据」，而这件事只有部署知道。所以它写进 env，没写就按「不是生产」处理。
//
// 只有一条值被当成生产：字符串 production（大小写敏感、去空格）。写 prod / Production / true
// 都不算 —— 拼错的环境名必须落在「不给数」那一侧，而不是落在「给数」那一侧。
const (
	// DataEnvVar 是部署声明「这套 API 连的是哪一套数据」的变量。
	DataEnvVar = "PROXY_OPERATOR_DATA_ENV"
	// DataEnvProduction 是唯一允许发布比率型指标的值。
	DataEnvProduction = "production"
)

// operatorDataEnv 返回当前进程声明的数据环境，未声明时为空串。
func operatorDataEnv() string {
	return strings.TrimSpace(os.Getenv(DataEnvVar))
}

// dataEnvOrUnset 是给说明文字用的：空串写在句子里读起来像漏了一个词。
func dataEnvOrUnset() string {
	if v := operatorDataEnv(); v != "" {
		return v
	}
	return "未声明"
}

// businessRatesPublished 决定这一页能不能给「比率」。
//
// 判据不是「数据干不干净」—— 那正是我上次以为自己在校验的东西，实际校验不了。判据是部署有没有
// 声明这套数据来自生产：计数（「窗口内 291 张单」）是对行的陈述，在哪个库上都成立；比率
// （「93.8% 的人会回来」）是对业务的推断，在装了脚本流量的库上就是把测试算成人。
func businessRatesPublished() bool {
	return operatorDataEnv() == DataEnvProduction
}

// businessRateRefusal 是关掉了比率时随响应带上去的那句说明，会被原样印在界面上。
//
// 它必须带上当场能核对的数：只说「比率未开放」既看不出差多少也看不出能不能补，
// 而「291 张单里 150 张连账号都没有、剩下 141 张出自脚本」是运营自己能验的事实。
//
// stats 为空时只说声明本身 —— 那条同样是事实，不能顺手编一个分母。
func businessRateRefusal(stats string) string {
	fact := "当前值：" + strings.TrimSpace(operatorDataEnv())
	if operatorDataEnv() == "" {
		fact = "当前没设这个变量（未声明 = 按非生产处理）"
	}
	out := "比率型指标（复购率、回访率）在没有声明数据环境的库上一律不给，" +
		"而 repeatRequesterRate 是 null 不是 0 —— 「没算」不等于「算出来是零」。" +
		"这台 API 读的是 " + DataEnvVar + "=" + fact + "。" +
		"库里经过 API 的脚本流量（e2e 用例建的账号和下单）和真实流量在行里长得很像，" +
		"引用完整性只能剔掉连账号都没有的行，剔不掉它们 —— 所以这里的比率是给测试数据算的指标。" +
		"把 " + DataEnvVar + "=" + DataEnvProduction + " 写进部署的 .env 并重启 api，这一页就改给比率。"
	if strings.TrimSpace(stats) != "" {
		out += " 这一轮查到的原始计数：" + stats
	}
	return out
}

// dataEnvStatus 是给 /v1/operator/access 看的那一段：声明了什么、据此发布了什么。
// 这一页是运营看「系统当前怎么配的」的地方，环境声明漏在这里就等于漏在整个后台里没人知道。
func dataEnvStatus() map[string]any {
	declared := operatorDataEnv()
	published := businessRatesPublished()
	note := "比率型指标停用：这一页只给原始计数。"
	if published {
		note = "比率型指标已发布。"
	} else if declared != "" {
		note = "已声明但不是 production（值拼错 = 按非生产处理，不会给比率）。比率型指标停用。"
	}
	return map[string]any{
		"variable":               DataEnvVar,
		"declared":               declared,
		"businessRatesPublished": published,
		"note":                   note,
	}
}
