// Package ordernumber 生成面向人的全数字订单编号（ORDER-NO-001）。
//
// 格式：16 位纯数字 = yyMMdd（越南时间，UTC+7）+ 9 位全局序号 + 1 位 Luhn 校验位。
//
//		260929 000001234 7
//		└日期┘ └─ 序号 ─┘ └校验
//
//	  - 唯一性只靠序号：序号来自一个**全局、永不重置**的计数器（生产是 Postgres
//	    序列 fulfillment.order_number_seq），所以跨日、跨订单类型（履约订单 /
//	    活动报名）都不会撞号。日期段只是给人看的，不参与唯一性。
//	  - 校验位：客服、结算、争议时用户会念 / 抄这个号，Luhn 能挡住单个数字抄错
//	    和绝大多数相邻数字对调。
//	  - 权威主键仍是内部 id（ord_… / 活动 id + 用户）；编号是展示与查询用的
//	    第二标识，一经分配不可改（数据库守卫触发器兜底）。
//	  - 序号超过 9 位时自动加宽（总长度随之 +1），不会截断或回绕。
package ordernumber

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// vietnam 是编号日期段所用时区。越南不实行夏令时，固定 UTC+7，不依赖 tzdata。
var vietnam = time.FixedZone("ICT", 7*3600)

const sequenceWidth = 9

// Allocator 分配下一个订单编号。实现必须保证并发下不重复。
type Allocator interface {
	Next(ctx context.Context) (string, error)
}

// Format 用序号和时间拼出完整编号（含校验位）。
func Format(sequence int64, at time.Time) string {
	body := at.In(vietnam).Format("060102") + fmt.Sprintf("%0*d", sequenceWidth, sequence)
	return body + strconv.Itoa(luhnCheckDigit(body))
}

// Valid 校验一个编号：全数字、至少 16 位、Luhn 校验位正确。
func Valid(number string) bool {
	if len(number) < 6+sequenceWidth+1 {
		return false
	}
	for _, r := range number {
		if r < '0' || r > '9' {
			return false
		}
	}
	body, check := number[:len(number)-1], int(number[len(number)-1]-'0')
	return luhnCheckDigit(body) == check
}

// luhnCheckDigit 计算 body 的 Luhn 校验位（从右往左，body 最右一位加倍）。
func luhnCheckDigit(body string) int {
	sum := 0
	double := true
	for i := len(body) - 1; i >= 0; i-- {
		digit := int(body[i] - '0')
		if double {
			digit *= 2
			if digit > 9 {
				digit -= 9
			}
		}
		sum += digit
		double = !double
	}
	return (10 - sum%10) % 10
}

// Memory 是进程内分配器（无库的开发服务 / 单测）。生产必须用 Postgres 序列。
type Memory struct {
	mu   sync.Mutex
	next int64
	now  func() time.Time
}

func NewMemory() *Memory { return &Memory{next: 1, now: time.Now} }

func (m *Memory) Next(context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sequence := m.next
	m.next++
	return Format(sequence, m.now()), nil
}

// ErrUnavailable：分配器没接上。调用方必须拒绝下单，不能退回生成一个假号。
var ErrUnavailable = errors.New("order number allocator unavailable")
