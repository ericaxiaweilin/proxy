package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// COMP-AI-MINOR-001（聊天侧）的负向注入测试。
//
// 为什么这几条必须存在：companion_gate.go 是 fail-closed 的 —— 门禁没接、
// 账号 id 为空、门禁报错，三条路都返回 false。fail-closed 的代价是
// "没接线"和"故意关掉"在行为上完全一样，光看测试全绿分不出是哪一种。
// 所以这里既测拒绝方向，也测放行方向 —— 只有放行方向能证明门禁真的被接上了。

// companionStartView 是 StartConversation 返回的 payload 形状。
type companionStartView struct {
	ConversationID  string   `json:"conversationId"`
	AssistantStatus string   `json:"assistantStatus"`
	AIMessage       *Message `json:"aiMessage"`
}

// companionSendView 是 SendMessage 返回的 payload 形状。
type companionSendView struct {
	MessageID       string   `json:"messageId"`
	AssistantStatus string   `json:"assistantStatus"`
	AIMessage       *Message `json:"aiMessage"`
}

// startCompanionConversation 走"从 AI 账号主页进入"那条路：带 assistantMode
// 建会话，一条用户消息都不用发就该拿到开场白（除非被门禁拦下）。
func startCompanionConversation(t *testing.T, s *Service, actorID string) companionStartView {
	t.Helper()
	e := envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "PROFILE",
		"originId":         "ai_account_001",
		"participantId":    "ai_account_001",
		"firstMessage":     "",
		"assistantMode":    "AI_PERSONA:ai_001",
	}, "new")
	e.Actor.ID = actorID
	e.Principal.ID = actorID
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start companion conversation: got %s (%+v)", result.Outcome, result.Error)
	}
	var view companionStartView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	return view
}

// sendToCompanion 在同一会话里发一条普通文本，看 AI 那半有没有动。
func sendToCompanion(t *testing.T, s *Service, convID string) companionSendView {
	t.Helper()
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType":   "TEXT",
		"body":          "在吗",
		"assistantMode": "AI_PERSONA:ai_001",
	}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send to companion: got %s (%+v)", result.Outcome, result.Error)
	}
	var view companionSendView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	return view
}

// 门禁没接 = 对所有人关闭。这条钉的是"接线遗漏"，不是"产品决定关掉"：
// 一旦有人把 main.go 里的 SetCompanionGate 删掉，这里立刻红。
func TestCompanionGateUnwiredDeniesEveryone(t *testing.T) {
	s := New()
	if s.companionAllowedFor(context.Background(), "user_001") {
		t.Fatal("a nil companion gate must deny, not allow")
	}
	view := startCompanionConversation(t, s, "user_001")
	if view.AssistantStatus != "GATED" {
		t.Fatalf("unwired gate must report GATED, got %q", view.AssistantStatus)
	}
	if view.AIMessage != nil {
		t.Fatalf("unwired gate must not produce a welcome message: %+v", view.AIMessage)
	}
}

// 门禁报错 = 拒绝。不能把"查不到年龄"当成"允许"。
func TestCompanionGateDenialReportsGatedWithoutWelcome(t *testing.T) {
	s := New()
	s.SetCompanionGate(func(context.Context, string) error {
		return errors.New("no age evidence")
	})
	view := startCompanionConversation(t, s, "user_001")
	if view.AssistantStatus != "GATED" {
		t.Fatalf("denied account must report GATED, got %q", view.AssistantStatus)
	}
	if view.AIMessage != nil {
		t.Fatalf("denied account must not get a welcome: %+v", view.AIMessage)
	}
}

// 空账号 id = 拒绝。无从判断的人不能当成合格账号。
func TestCompanionGateRefusesBlankAccount(t *testing.T) {
	s := New()
	s.SetCompanionGate(func(context.Context, string) error { return nil })
	if s.companionAllowedFor(context.Background(), "   ") {
		t.Fatal("a blank account id must not be treated as an eligible account")
	}
}

// 放行方向：门禁允许时功能必须真的通 —— 否则"接线正确"和"接线遗漏"在测试里
// 长得一模一样，上面几条拒绝断言就变成了自证。
func TestCompanionGateApprovalKeepsTheCompanionAlive(t *testing.T) {
	s := New()
	s.SetCompanionGate(func(context.Context, string) error { return nil })
	view := startCompanionConversation(t, s, "user_001")
	if view.AssistantStatus != "RESPONDED" {
		t.Fatalf("an eligible account must get the welcome, got %q", view.AssistantStatus)
	}
	if view.AIMessage == nil {
		t.Fatal("an eligible account must receive the account-bound welcome message")
	}
}

// 聊天侧：门禁要拦在模型调用之前 —— 被拦的账号不该花掉一次模型请求。
// 拒绝方向同时看 assistantStatus 和模型调用次数，避免"拦了但照样调模型"。
func TestCompanionGateBlocksTheModelCallWhenDenied(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetCompanionGate(func(context.Context, string) error { return errors.New("minor") })

	opened := startCompanionConversation(t, s, "user_001")
	if opened.AssistantStatus != "GATED" {
		t.Fatalf("denied account must be GATED on open, got %q", opened.AssistantStatus)
	}
	sent := sendToCompanion(t, s, opened.ConversationID)
	if sent.AssistantStatus != "GATED" {
		t.Fatalf("denied account must be GATED on send, got %q", sent.AssistantStatus)
	}
	if sent.AIMessage != nil {
		t.Fatalf("denied account must not get an AI reply: %+v", sent.AIMessage)
	}
	if len(model.messages) != 0 {
		t.Fatalf("the gate must block before the model is called, got %d messages", len(model.messages))
	}
}

// 同一套构造下的正向对照：门禁允许时模型真的被调用。
// 没有这一条，上面的 len(model.messages)==0 可能只是因为模型根本接不上。
func TestCompanionGateApprovalReachesTheModel(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetCompanionGate(func(context.Context, string) error { return nil })

	opened := startCompanionConversation(t, s, "user_001")
	sent := sendToCompanion(t, s, opened.ConversationID)
	if sent.AssistantStatus != "RESPONDED" {
		t.Fatalf("an eligible account must get a reply, got %q", sent.AssistantStatus)
	}
	if len(model.messages) == 0 {
		t.Fatal("an eligible account must reach the model")
	}
}

// ---------------------------------------------------------------------------
// 会话自身决定人设 —— 不依赖调用方记得传 assistantMode
// ---------------------------------------------------------------------------

// 开场白和门禁必须是**同一个判断**。
//
// 缺陷：门禁改成认会话成员之后，开场白那条分支还在看 assistantMode ——
// 于是「不带 assistantMode 建伴侣会话」变成：门禁认了这是伴侣会话（合规没问题），
// 但一条问候都不生成，assistantStatus 整个字段缺席。用户进到一间空房间，
// 客户端连"为什么没消息"都拿不到 —— 沉默和"没有数据"长得一模一样。
//
// 客户端今天恰好总是带 assistantMode（conversation.tsx 的建会话路径），
// 所以这条不是今天能看见的症状；但 curl / 深链 / 下一个客户端照样走到这里，
// 而这一整轮修复的前提就是"不能指望调用方记得传参"。
func TestCompanionWelcomeDoesNotDependOnAssistantMode(t *testing.T) {
	s := New()
	s.SetCompanionGate(func(context.Context, string) error { return nil })

	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "PROFILE",
		"originId":         "ai_account_001",
		"participantId":    "ai_account_001",
		"firstMessage":     "",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start companion conversation without assistantMode: got %s (%+v)", result.Outcome, result.Error)
	}
	var view companionStartView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	if view.AssistantStatus != "RESPONDED" {
		t.Fatalf("a companion thread must still open with a greeting, got status %q", view.AssistantStatus)
	}
	if view.AIMessage == nil {
		t.Fatal("a companion thread must still open with a greeting")
	}
	if view.AIMessage.SenderID != "ai_account_001" {
		t.Fatalf("the greeting must come from the companion itself, got %q", view.AIMessage.SenderID)
	}
}

// sendToCompanionWithoutMode 复现客户端的真实行为：活动卡片、位置卡片那条路
// 压根不带 assistantMode。名片和语音曾经连回包都不看。
func sendToCompanionWithoutMode(t *testing.T, s *Service, convID, body string) companionSendView {
	t.Helper()
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT",
		"body":        body,
	}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send without assistantMode: got %s (%+v)", result.Outcome, result.Error)
	}
	var view companionSendView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	return view
}

// startHumanDirectMessage 开一个普通真人 DM（对面是 user_002，不是平台 AI 账号）。
func startHumanDirectMessage(t *testing.T, s *Service, actorID string) string {
	t.Helper()
	e := envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "PROFILE",
		"originId":         "user_002",
		"participantId":    "user_002",
		"firstMessage":     "",
	}, "new")
	e.Actor.ID = actorID
	e.Principal.ID = actorID
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start human dm: got %s (%+v)", result.Outcome, result.Error)
	}
	var view companionStartView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	return view.ConversationID
}

// systemPromptOf 取出送进模型的 system prompt。
//
// 注意 capturingModelStack 是**覆盖**式记录（每次 Complete 替换整个切片），
// 所以这里拿到的是最后一次调用的 prompt —— 正是我们要断言的那一次。
// 也不能拿 len(messages) 当"调用次数"用。
func systemPromptOf(t *testing.T, model *capturingModelStack) string {
	t.Helper()
	if len(model.messages) == 0 {
		t.Fatal("the model was never called — there is no prompt to inspect")
	}
	if model.messages[0].Role != "system" {
		t.Fatalf("the first message must be the system prompt, got role %q", model.messages[0].Role)
	}
	return model.messages[0].Content
}

// 缺陷：伴侣会话里，一次**不带 assistantMode** 的发送会让模型拿到需求助手的
// system prompt，回复还署名 proxy_ai —— 客户端按 sender 回退把它渲染出来，
// 用户看到"AI 虚拟女孩"用需求助手的口吻说话（"有没有预算范围？"）。
//
// 断言必须分两层，缺一不可：
//  1. 署名 —— 回复来自伴侣账号，不是 proxy_ai；
//  2. 人设 —— 送进模型的 prompt 是伴侣人设，不是需求助手那条。
//
// 只钉署名是不够的：署名对了但 prompt 还是需求助手，等于换了名字的同一个 bug。
// 只钉 prompt 也不够：署名错了，客户端会把这条回复画在错误的头像下面。
func TestCompanionVoiceSurvivesAMissingAssistantMode(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetCompanionGate(func(context.Context, string) error { return nil })

	opened := startCompanionConversation(t, s, "user_001")
	sent := sendToCompanionWithoutMode(t, s, opened.ConversationID, "今天有点累，陪我说说话")

	if sent.AIMessage == nil {
		t.Fatalf("a companion thread must still get an answer without assistantMode, status=%q", sent.AssistantStatus)
	}
	if sent.AIMessage.SenderID != "ai_account_001" {
		t.Fatalf("the companion must answer as itself, not as %q", sent.AIMessage.SenderID)
	}
	prompt := systemPromptOf(t, model)
	if !strings.Contains(prompt, "AI 虚拟女孩") {
		t.Fatalf("the companion persona prompt must reach the model, got: %s", prompt)
	}
	if strings.Contains(prompt, "智能需求构建助手") {
		t.Fatal("a companion thread must never be answered with the requirement-assistant prompt")
	}
	if !strings.Contains(prompt, CompanionSafetyDirective) {
		t.Fatal("the companion persona prompt must carry the hard refusal line")
	}
}

// 负向对照：真人 DM 不能被"兜底"误伤成伴侣人设。
//
// 没有这一条，上面的测试可能只是因为**所有**会话都拿到了伴侣 prompt ——
// 那样 proxy_ai 的首页/需求助手就全废了，而测试还是绿的。
func TestHumanDirectMessageGetsTheStandInNotTheCompanion(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetCompanionGate(func(context.Context, string) error { return nil })

	convID := startHumanDirectMessage(t, s, "user_001")
	sent := sendToCompanionWithoutMode(t, s, convID, "今天有点累，陪我说说话")

	if sent.AIMessage == nil {
		t.Fatalf("a human DM with content must still get an assistant reply, status=%q", sent.AssistantStatus)
	}
	// AI-MANAGE-008：真人私信的回复以那个真人本人的身份发出（代回复），不是 proxy_ai。
	if sent.AIMessage.SenderID == "proxy_ai" || sent.AIMessage.AuthoredBy != "ai_stand_in" {
		t.Fatalf("a human DM is answered as the represented person, got sender=%q authoredBy=%q", sent.AIMessage.SenderID, sent.AIMessage.AuthoredBy)
	}
	prompt := systemPromptOf(t, model)
	// AI-MANAGE-003：真人私信的回复是「替对面那个真人代回复」，用代回复人设（见 ai_engine_gate.go），
	// 不再是需求助手；这条负向对照的本意不变 —— 绝不能落到伴侣人设上。
	if !strings.Contains(prompt, "本人") {
		t.Fatalf("a human DM must be answered with the stand-in prompt, got: %s", prompt)
	}
	if strings.Contains(prompt, "AI 虚拟女孩") {
		t.Fatal("a human DM must never be answered with the companion persona")
	}
}

// 门禁不能因为"少传一个参数"就被绕开。
//
// 这是上一条缺陷的合规后果，比口吻错更严重：门禁原来只看 assistantMode，
// 所以被 CreatePersona 拦掉的未成年人，只要发送时不带 assistantMode
//（活动卡片 / 位置卡片就是这么发的），就完全不受门禁约束。
// 判定改成认会话本身之后，这条必须红转绿。
func TestCompanionGateHoldsWhenTheSendOmitsAssistantMode(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetCompanionGate(func(context.Context, string) error { return errors.New("minor") })

	opened := startCompanionConversation(t, s, "user_001")
	sent := sendToCompanionWithoutMode(t, s, opened.ConversationID, "今天有点累，陪我说说话")

	if sent.AssistantStatus != "GATED" {
		t.Fatalf("a denied account must stay GATED without assistantMode, got %q", sent.AssistantStatus)
	}
	if sent.AIMessage != nil {
		t.Fatalf("a denied account must not get an AI reply: %+v", sent.AIMessage)
	}
	if len(model.messages) != 0 {
		t.Fatal("the gate must block before the model is called, even without assistantMode")
	}
}
