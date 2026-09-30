// Package ordernumber 是全平台「订单编号」的唯一规范（ORDER-NO-001）。
//
// 格式：纯数字 {类别编码3位}{YYMMDD}{HHMMSS}{序号6位}，例如 100260928143022000001（21 位）。
//   - 类别编码：3 位数字。活动报名按**场地类型**编码（咖啡 100 / 餐厅 101 / ……
//     用户定的口径）；新增类别必须在这里登记，不许各处自造。
//   - YYMMDD + HHMMSS：下单那一刻的越南本地时间（UTC+7，无夏令时）——日期按
//     本地切日（晚上 7 点以后不能记到第二天），时分秒精确到秒。
//   - 序号：同一类别编码、同一天内从 000001 起连续递增，至少 6 位，超过 999999
//     自然变宽（不截断、不回绕）。由数据库原子分配，不复用、不跳号补位。
//
// 编号在下单那一刻由服务端生成并落库，之后不变；客户端只展示，不拼接、不猜。
package ordernumber

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	// 活动报名的场地类别编码。
	CategoryCafe       = "100" // 咖啡店 CAFE
	CategoryRestaurant = "101" // 餐厅 RESTAURANT
	CategoryPark       = "102" // 公园 PARK
	CategoryLake       = "103" // 湖边 LAKE
	CategoryStreet     = "104" // 街区 STREET
	CategoryOtherVenue = "109" // 通用 OTHER（含未知类型，不猜，归通用）
	// CategoryService 履约服务单（fulfillment.Order，市场下单）预留 200 段，
	// 接入时在这里登记具体编码。当前无任何调用方，不许直接使用字母缩写。
	CategoryService = "200"
	// CategoryDemand 市场需求 / 定向邀约（marketplace.Opportunity.Number，发布成功页的「需求编号」）。
	CategoryDemand = "201"
	// CategoryActivity 活动本身的编号（activity.Activity.Code，发布成功页的「活动编号」；
	// 区别于报名订单编号，后者按场地类别 100~109 编）。
	CategoryActivity = "300"
)

// categories 是已登记的全部类别码。新增类别必须先登记在这里（Valid 只认登记过的）。
var categories = map[string]bool{
	CategoryCafe: true, CategoryRestaurant: true, CategoryPark: true, CategoryLake: true,
	CategoryStreet: true, CategoryOtherVenue: true, CategoryService: true, CategoryDemand: true, CategoryActivity: true,
}

// CategoryForVenueType 把活动场地类型折成订单类别编码。未知类型归通用，不猜店。
func CategoryForVenueType(venueType string) string {
	switch venueType {
	case "CAFE":
		return CategoryCafe
	case "RESTAURANT":
		return CategoryRestaurant
	case "PARK":
		return CategoryPark
	case "LAKE":
		return CategoryLake
	case "STREET":
		return CategoryStreet
	default:
		return CategoryOtherVenue
	}
}

// Location 是切日用的时区：越南 UTC+7，全年无夏令时，用固定时区不依赖系统 tzdata。
var Location = time.FixedZone("ICT", 7*60*60)

// Day 返回 t 在越南本地时间的那一天（零点）。
func Day(t time.Time) time.Time {
	local := t.In(Location)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, Location)
}

// Format 按规范拼出订单编号。moment 取下单那一刻（日期与时分秒都从它取），seq 从 1 开始。
func Format(category string, moment time.Time, seq int) string {
	local := moment.In(Location)
	return fmt.Sprintf("%s%s%s%06d", category, local.Format("060102"), local.Format("150405"), seq)
}

// Registered 说明类别码是否已登记。
func Registered(category string) bool { return categories[category] }

// Valid 校验一个编号的形状。**两种形状都放行**：
//
//   - 21 位起（现行规范，本包 Format 产出）：全数字 + 类别码已登记 + 日期时分秒真实存在；
//   - 16~20 位（main 时代已发出的号：yyMMdd + 全局序号 + Luhn 校验位，序号超过 9 位会
//     自然加宽到 17 位）：全数字 + Luhn 校验位正确。
//
// 为什么必须留 16~20 位这条：那些号**已经发到用户手上**（库里回填过、客服工单里抄过）。
// 收窄成只认 21 位，等于让已发出的号在客服反查（internal/numberlookup 会调本函数）
// 和 DB 守卫那里变成"非法"，历史数据就写不动、查不到 —— 而干净库跑测试全绿，
// 抓不到。
//
// 真伪（这个号存在吗、属于谁）永远问库，不靠这一层。
func Valid(number string) bool {
	if len(number) < 16 {
		return false
	}
	for _, r := range number {
		if r < '0' || r > '9' {
			return false
		}
	}
	if len(number) >= 3+6+6+6 {
		if !categories[number[:3]] {
			return false
		}
		_, err := time.Parse("060102150405", number[3:15])
		return err == nil
	}
	// main 的 Luhn：body = 除末位以外的全部数字，末位是校验位。
	body, check := number[:len(number)-1], int(number[len(number)-1]-'0')
	return luhnCheckDigit(body) == check
}

// luhnCheckDigit 计算 body 的 Luhn 校验位（从右往左，body 最右一位加倍）。
// 逐字照搬 main 的实现：历史 16 位号就是它生成的，算法改一个字都会让旧号校验不过。
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

// Allocator 分配下一个订单编号。category 是类别码（上面的常量 / CategoryForVenueType），
// 实现必须保证同类别同一天并发下不重复。
type Allocator interface {
	Next(ctx context.Context, category string) (string, error)
}

// ErrUnavailable：分配器没接上。调用方必须拒绝下单，不能退回生成一个假号。
var ErrUnavailable = errors.New("order number allocator unavailable")

// ErrUnknownCategory：类别码没登记。
var ErrUnknownCategory = errors.New("order number category is not registered")

// Memory 是进程内分配器（无库的开发服务 / 单测）。生产必须用 Postgres 的
// ordering.daily_sequences（platform/postgres/order_numbers.go）。
type Memory struct {
	mu      sync.Mutex
	daySeqs map[string]int
	now     func() time.Time
}

func NewMemory() *Memory { return &Memory{daySeqs: make(map[string]int), now: time.Now} }

func (m *Memory) Next(_ context.Context, category string) (string, error) {
	if !categories[category] {
		return "", ErrUnknownCategory
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	moment := m.now()
	key := category + Day(moment).Format("060102")
	m.daySeqs[key]++
	return Format(category, moment, m.daySeqs[key]), nil
}
