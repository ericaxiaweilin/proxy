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

// Valid 校验一个编号的结构：全数字、至少 21 位、类别码已登记、日期与时分秒是真实存在的。
// 没有校验位（用户定的口径），所以抄错一位只有在碰巧让结构失效时才能识别；客服反查
// 靠「查得到 / 查不到」判断，见 internal/numberlookup。
func Valid(number string) bool {
	if len(number) < 3+6+6+6 {
		return false
	}
	for _, r := range number {
		if r < '0' || r > '9' {
			return false
		}
	}
	if !categories[number[:3]] {
		return false
	}
	if _, err := time.Parse("060102150405", number[3:15]); err != nil {
		return false
	}
	return true
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
