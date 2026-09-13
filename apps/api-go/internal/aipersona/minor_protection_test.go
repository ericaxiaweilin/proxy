package aipersona

import (
	"context"
	"errors"
	"testing"
	"time"
)

// COMP-AI-MINOR-001 — AI 伴侣 / 数字分身不对未成年人开放。
//
// 越南 AI 法 134/2025/QH15（2026-03-01 生效）要求对未成年人采取保护措施。
// 陪伴型 AI（数字分身、平台 AI 角色）是点名场景：未成年人可以全天候和一个
// 不会拒绝、还带着真人 likeness 的对象建立情感依赖。
//
// 前置条件 COMP-AGE-001（出生日期落库）已具备，这里钉的是「守卫」本身。
// fail-closed 三个方向都要钉，因为任何一个方向漏了都等于没有保护。

var fixedNow = time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)

func TestCompanionRefusedWhenAgeLookupUnwired(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), nil, "u_1", fixedNow)
	if ok || !errors.Is(err, ErrAgeLookupUnavailable) {
		t.Fatalf("no lookup must refuse, got ok=%v err=%v", ok, err)
	}
}

func TestCompanionRefusedWhenNoAgeEvidence(t *testing.T) {
	// AgeAt 返回 0 = 查不到年龄证据（历史账号、非匿名注册路径）。
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 0}, "u_1", fixedNow)
	if ok || !errors.Is(err, ErrNoAgeEvidence) {
		t.Fatalf("missing age evidence must refuse, got ok=%v err=%v", ok, err)
	}
}

func TestCompanionRefusedForConfirmedMinor(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 17}, "u_1", fixedNow)
	if ok || !errors.Is(err, ErrMinorForbidden) {
		t.Fatalf("a 17-year-old must be refused, got ok=%v err=%v", ok, err)
	}
}

func TestCompanionRefusedWhenAgeLookupErrors(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 30, err: errors.New("age store down")}, "u_1", fixedNow)
	if ok || err == nil {
		t.Fatalf("a failing age lookup must not become 'adult', got ok=%v err=%v", ok, err)
	}
}

func TestCompanionRefusedForEmptyOwner(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 30}, "  ", fixedNow)
	if ok || !errors.Is(err, ErrOwnerRequired) {
		t.Fatalf("an empty owner must refuse, got ok=%v err=%v", ok, err)
	}
}

// 18 岁生日当天就该能用 —— 边界必须和注册时的 18+ 判定一致，
// 否则会出现「能注册但不能建分身」的自相矛盾。
func TestCompanionAllowedExactlyOnEighteenthBirthday(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 18}, "u_1", fixedNow)
	if !ok || err != nil {
		t.Fatalf("exactly 18 must be allowed, got ok=%v err=%v", ok, err)
	}
}

func TestCompanionAllowedForAdult(t *testing.T) {
	ok, err := CompanionAllowedFor(context.Background(), fixedAgeLookup{age: 30}, "u_1", fixedNow)
	if !ok || err != nil {
		t.Fatalf("an adult must be allowed, got ok=%v err=%v", ok, err)
	}
}

// 端到端：CreatePersona 必须真的把未成年人挡在「建」之前 ——
// 建了再删没用，未成年人已经和它说过话了。
func TestCreatePersonaBlockedForMinor(t *testing.T) {
	svc := NewService(NewMemoryRepository(), "terms-1.1")
	svc.SetAgeLookup(fixedAgeLookup{age: 16})

	_, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID: "u_minor", DisplayName: "小美 (Twin)", PersonaType: PersonaTypeUserTwin,
	})
	if !errors.Is(err, ErrMinorForbidden) {
		t.Fatalf("a minor must not be able to create a persona, got %v", err)
	}
}

// 没接年龄查询时，谁都建不了 —— 功能宁可关闭，也不能对未成年人开放。
func TestCreatePersonaBlockedWhenAgeLookupUnwired(t *testing.T) {
	svc := NewService(NewMemoryRepository(), "terms-1.1") // 故意不 SetAgeLookup
	_, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID: "u_adult", DisplayName: "小美", PersonaType: PersonaTypeUserTwin,
	})
	if err == nil {
		t.Fatal("without an age lookup nobody may create a persona (fail-closed)")
	}
}

// 反向：成年人放行后必须真的能建，否则守卫就退化成一刀切关闭。
func TestCreatePersonaAllowedForAdult(t *testing.T) {
	svc := newAdultService(NewMemoryRepository(), "terms-1.1")
	p, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID: "u_adult", DisplayName: "小美 (Twin)", PersonaType: PersonaTypeUserTwin,
	})
	if err != nil || p == nil || p.ID == "" {
		t.Fatalf("an adult must still be able to create a persona, got %v", err)
	}
}
