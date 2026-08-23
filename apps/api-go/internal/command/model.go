package command

import "time"

type Actor struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Principal struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Target struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Envelope struct {
	CommandID                string         `json:"commandId"`
	CommandType              string         `json:"commandType"`
	CommandVersion           int            `json:"commandVersion"`
	Actor                    Actor          `json:"actor"`
	Principal                Principal      `json:"principal"`
	Target                   Target         `json:"target"`
	IdempotencyKey           string         `json:"idempotencyKey"`
	ExpectedAggregateVersion *int           `json:"expectedAggregateVersion,omitempty"`
	PolicySnapshot           map[string]any `json:"policySnapshot,omitempty"`
	AuthContext              map[string]any `json:"authContext"`
	Purpose                  string         `json:"purpose"`
	CorrelationID            string         `json:"correlationId"`
	CausationID              string         `json:"causationId,omitempty"`
	RequestedAt              string         `json:"requestedAt"`
	Payload                  map[string]any `json:"payload"`
}

type Aggregate struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Version int    `json:"version"`
	State   string `json:"state,omitempty"`
}

type ErrorEnvelope struct {
	ErrorCode      string         `json:"errorCode"`
	Category       string         `json:"category"`
	Retryability   string         `json:"retryability"`
	MessageKey     string         `json:"messageKey"`
	SafeDetails    map[string]any `json:"safeDetails"`
	RequiredAction string         `json:"requiredAction,omitempty"`
	CorrelationID  string         `json:"correlationId"`
	SupportCaseRef string         `json:"supportCaseRef,omitempty"`
}

type Result struct {
	CommandID     string         `json:"commandId"`
	Outcome       string         `json:"outcome"`
	Aggregate     *Aggregate     `json:"aggregate,omitempty"`
	EventRefs     []string       `json:"eventRefs"`
	OperationRef  string         `json:"operationRef,omitempty"`
	Auth          *AuthTokens    `json:"auth,omitempty"`
	Error         *ErrorEnvelope `json:"error,omitempty"`
	CorrelationID string         `json:"correlationId"`
}

type AuthTokens struct {
	SessionID        string    `json:"sessionId"`
	UserAccountID    string    `json:"userAccountId"`
	Principal        Principal `json:"principal"`
	AccessToken      string    `json:"accessToken"`
	RefreshToken     string    `json:"refreshToken"`
	AccessExpiresAt  time.Time `json:"accessExpiresAt"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
	Rotation         int       `json:"rotation"`
}

func Accepted(envelope Envelope, aggregateType, aggregateID string, version int, state string, eventRefs []string) Result {
	// eventRefs 永远序列化为 [] 而非 null（客户端 fail-closed 解析要求数组）
	if eventRefs == nil {
		eventRefs = []string{}
	}
	return Result{
		CommandID:     envelope.CommandID,
		Outcome:       "ACCEPTED",
		Aggregate:     &Aggregate{Type: aggregateType, ID: aggregateID, Version: version, State: state},
		EventRefs:     eventRefs,
		CorrelationID: envelope.CorrelationID,
	}
}

func Rejected(envelope Envelope, code, category, retryability, messageKey string, details map[string]any) Result {
	if details == nil {
		details = map[string]any{}
	}
	return Result{
		CommandID:     envelope.CommandID,
		Outcome:       "REJECTED",
		EventRefs:     []string{},
		CorrelationID: envelope.CorrelationID,
		Error: &ErrorEnvelope{
			ErrorCode:     code,
			Category:      category,
			Retryability:  retryability,
			MessageKey:    messageKey,
			SafeDetails:   details,
			CorrelationID: envelope.CorrelationID,
		},
	}
}

func Pending(envelope Envelope, operationRef, code, category, messageKey string, details map[string]any) Result {
	if details == nil {
		details = map[string]any{}
	}
	return Result{
		CommandID:     envelope.CommandID,
		Outcome:       "PENDING",
		EventRefs:     []string{},
		OperationRef:  operationRef,
		CorrelationID: envelope.CorrelationID,
		Error: &ErrorEnvelope{
			ErrorCode:     code,
			Category:      category,
			Retryability:  "ASYNC_PENDING",
			MessageKey:    messageKey,
			SafeDetails:   details,
			CorrelationID: envelope.CorrelationID,
		},
	}
}
