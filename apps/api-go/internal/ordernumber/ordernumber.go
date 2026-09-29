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
	"fmt"
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
)

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
