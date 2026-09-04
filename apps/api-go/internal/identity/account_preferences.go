package identity

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/proxy-app/proxy-api/internal/command"
)

var ErrAccountPreferencesNotFound = errors.New("account preferences not found")

type AccountPreferences struct {
	UserAccountID        string   `json:"userAccountId"`
	SocialAccounts       []any    `json:"socialAccounts"`
	ShowOnMerchant       bool     `json:"showOnMerchant"`
	ShowOnProfile        bool     `json:"showOnProfile"`
	ShowInfluence        bool     `json:"showInfluence"`
	CollaborationEnabled bool     `json:"collaborationEnabled"`
	CollaborationTypes   []string `json:"collaborationTypes"`
	CollaborationRate    string   `json:"collaborationRate"`
	CollaborationContact string   `json:"collaborationContact"`
	Version              int      `json:"version"`
}

type AccountPreferencesRepository interface {
	GetAccountPreferences(context.Context, string) (AccountPreferences, error)
	UpsertAccountPreferences(context.Context, AccountPreferences) (AccountPreferences, error)
}

func (s *Service) preferencesRepo() AccountPreferencesRepository {
	return s.repository.(AccountPreferencesRepository)
}

func (s *Service) getAccountPreferences(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.account_preferences_forbidden", nil)
	}
	prefs, err := s.preferencesRepo().GetAccountPreferences(ctx, e.Actor.ID)
	if errors.Is(err, ErrAccountPreferencesNotFound) {
		prefs = AccountPreferences{UserAccountID: e.Actor.ID, SocialAccounts: []any{}, CollaborationTypes: []string{}, Version: 0}
	} else if err != nil {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.account_preferences_read_failed", nil)
	}
	payload, _ := json.Marshal(map[string]any{"preferences": prefs})
	result := command.Accepted(e, "AccountPreferences", e.Actor.ID, prefs.Version, "READ", nil)
	result.OperationRef = string(payload)
	return result
}

func (s *Service) updateAccountPreferences(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.account_preferences_forbidden", nil)
	}
	var prefs AccountPreferences
	if !decode(e.Payload, &prefs) {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_INVALID", "VALIDATION", "AFTER_USER_ACTION", "identity.account_preferences_invalid", nil)
	}
	prefs.UserAccountID = e.Actor.ID
	if prefs.SocialAccounts == nil {
		prefs.SocialAccounts = []any{}
	}
	if prefs.CollaborationTypes == nil {
		prefs.CollaborationTypes = []string{}
	}
	if len(prefs.SocialAccounts) > 20 || len(prefs.CollaborationTypes) > 20 || len(prefs.CollaborationRate) > 200 || len(prefs.CollaborationContact) > 200 {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_INVALID", "VALIDATION", "AFTER_USER_ACTION", "identity.account_preferences_invalid", nil)
	}
	saved, err := s.preferencesRepo().UpsertAccountPreferences(ctx, prefs)
	if err != nil {
		return command.Rejected(e, "ACCOUNT_PREFERENCES_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.account_preferences_write_failed", nil)
	}
	payload, _ := json.Marshal(map[string]any{"preferences": saved})
	result := command.Accepted(e, "AccountPreferences", e.Actor.ID, saved.Version, "UPDATED", nil)
	result.OperationRef = string(payload)
	return result
}
