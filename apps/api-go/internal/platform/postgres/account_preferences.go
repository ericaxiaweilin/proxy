package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/identity"
)

func (r *IdentityRepository) GetAccountPreferences(ctx context.Context, userID string) (identity.AccountPreferences, error) {
	var p identity.AccountPreferences
	var accounts, types []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT user_account_id, social_accounts, show_on_merchant, show_on_profile, show_influence, collaboration_enabled, collaboration_types, collaboration_rate, collaboration_contact, version FROM identity.account_preferences WHERE user_account_id=$1`, userID).Scan(&p.UserAccountID, &accounts, &p.ShowOnMerchant, &p.ShowOnProfile, &p.ShowInfluence, &p.CollaborationEnabled, &types, &p.CollaborationRate, &p.CollaborationContact, &p.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.AccountPreferences{}, identity.ErrAccountPreferencesNotFound
	}
	if err != nil {
		return identity.AccountPreferences{}, err
	}
	if err = json.Unmarshal(accounts, &p.SocialAccounts); err != nil {
		return identity.AccountPreferences{}, err
	}
	if err = json.Unmarshal(types, &p.CollaborationTypes); err != nil {
		return identity.AccountPreferences{}, err
	}
	return p, nil
}

func (r *IdentityRepository) UpsertAccountPreferences(ctx context.Context, p identity.AccountPreferences) (identity.AccountPreferences, error) {
	accounts, err := json.Marshal(p.SocialAccounts)
	if err != nil {
		return identity.AccountPreferences{}, err
	}
	types, err := json.Marshal(p.CollaborationTypes)
	if err != nil {
		return identity.AccountPreferences{}, err
	}
	err = queryerForContext(ctx, r.pool).QueryRow(ctx, `INSERT INTO identity.account_preferences (user_account_id, social_accounts, show_on_merchant, show_on_profile, show_influence, collaboration_enabled, collaboration_types, collaboration_rate, collaboration_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_account_id) DO UPDATE SET social_accounts=EXCLUDED.social_accounts, show_on_merchant=EXCLUDED.show_on_merchant, show_on_profile=EXCLUDED.show_on_profile, show_influence=EXCLUDED.show_influence, collaboration_enabled=EXCLUDED.collaboration_enabled, collaboration_types=EXCLUDED.collaboration_types, collaboration_rate=EXCLUDED.collaboration_rate, collaboration_contact=EXCLUDED.collaboration_contact, version=identity.account_preferences.version+1, updated_at=now() RETURNING version`, p.UserAccountID, accounts, p.ShowOnMerchant, p.ShowOnProfile, p.ShowInfluence, p.CollaborationEnabled, types, p.CollaborationRate, p.CollaborationContact).Scan(&p.Version)
	return p, err
}

var _ identity.AccountPreferencesRepository = (*IdentityRepository)(nil)
