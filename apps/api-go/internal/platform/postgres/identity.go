package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/identity"
)

type IdentityRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewIdentityRepository(pool *pgxpool.Pool) *IdentityRepository {
	return &IdentityRepository{pool: pool}
}

func NewIdentityRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *IdentityRepository {
	return &IdentityRepository{pool: pool, outbox: outboxRepository}
}

func (r *IdentityRepository) GetUser(ctx context.Context, id string) (identity.UserAccount, error) {
	var user identity.UserAccount
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT id, status FROM identity.user_accounts WHERE id = $1`, id).Scan(&user.ID, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.UserAccount{}, identity.ErrUserNotFound
	}
	return user, err
}

func (r *IdentityRepository) GetLoginIdentity(ctx context.Context, id string) (identity.LoginIdentity, error) {
	var loginIdentity identity.LoginIdentity
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, verified, status
		FROM identity.login_identities
		WHERE id = $1`, id).Scan(&loginIdentity.ID, &loginIdentity.UserAccountID, &loginIdentity.Verified, &loginIdentity.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.LoginIdentity{}, identity.ErrLoginIdentityNotFound
	}
	return loginIdentity, err
}

func (r *IdentityRepository) CreateLoginChallenge(ctx context.Context, challenge identity.LoginChallenge) error {
	return insertLoginChallenge(ctx, execerForContext(ctx, r.pool), challenge)
}

func insertLoginChallenge(ctx context.Context, execer sqlExecer, challenge identity.LoginChallenge) error {
	_, err := execer.Exec(ctx, `
		INSERT INTO identity.login_challenges (
			id, user_account_id, login_identity_id, device_id, channel, provider_ref,
			status, attempts, max_attempts, version, requested_at, expires_at, verified_at, consumed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		challenge.ID,
		challenge.UserAccountID,
		challenge.LoginIdentityID,
		challenge.DeviceID,
		challenge.Channel,
		challenge.ProviderRef,
		challenge.Status,
		challenge.Attempts,
		challenge.MaxAttempts,
		challenge.Version,
		challenge.RequestedAt,
		challenge.ExpiresAt,
		nullableTime(challenge.VerifiedAt),
		nullableTime(challenge.ConsumedAt),
	)
	return err
}

func (r *IdentityRepository) GetLoginChallenge(ctx context.Context, id string) (identity.LoginChallenge, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, login_identity_id, device_id, channel, provider_ref,
		       status, attempts, max_attempts, version, requested_at, expires_at, verified_at, consumed_at
		FROM identity.login_challenges
		WHERE id = $1`, id)
	challenge, err := scanLoginChallenge(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.LoginChallenge{}, identity.ErrLoginChallengeNotFound
	}
	return challenge, err
}

func (r *IdentityRepository) UpdateLoginChallenge(ctx context.Context, challenge identity.LoginChallenge, expectedVersion int) error {
	return updateLoginChallenge(ctx, execerForContext(ctx, r.pool), challenge, expectedVersion)
}

func updateLoginChallenge(ctx context.Context, execer sqlExecer, challenge identity.LoginChallenge, expectedVersion int) error {
	commandTag, err := execer.Exec(ctx, `
		UPDATE identity.login_challenges
		SET status = $1, attempts = $2, max_attempts = $3, version = $4,
		    requested_at = $5, expires_at = $6, verified_at = $7, consumed_at = $8,
		    updated_at = now()
		WHERE id = $9 AND version = $10`,
		challenge.Status,
		challenge.Attempts,
		challenge.MaxAttempts,
		challenge.Version,
		challenge.RequestedAt,
		challenge.ExpiresAt,
		nullableTime(challenge.VerifiedAt),
		nullableTime(challenge.ConsumedAt),
		challenge.ID,
		expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return identity.ErrLoginChallengeVersionConflict
	}
	return nil
}

func (r *IdentityRepository) GetDevice(ctx context.Context, id string) (identity.DeviceRegistration, error) {
	var device identity.DeviceRegistration
	var pushTokenRef *string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, platform, status, push_token_ref
		FROM identity.device_registrations
		WHERE id = $1`, id).Scan(&device.ID, &device.UserAccountID, &device.Platform, &device.Status, &pushTokenRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.DeviceRegistration{}, identity.ErrDeviceNotFound
	}
	if err != nil {
		return identity.DeviceRegistration{}, err
	}
	if pushTokenRef != nil {
		device.PushTokenRef = *pushTokenRef
	}
	return device, nil
}

func (r *IdentityRepository) UpsertDevice(ctx context.Context, device identity.DeviceRegistration) error {
	return upsertDevice(ctx, execerForContext(ctx, r.pool), device)
}

func upsertDevice(ctx context.Context, execer sqlExecer, device identity.DeviceRegistration) error {
	commandTag, err := execer.Exec(ctx, `
		INSERT INTO identity.device_registrations (id, user_account_id, platform, status, push_token_ref)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			platform = EXCLUDED.platform,
			status = EXCLUDED.status,
			push_token_ref = EXCLUDED.push_token_ref,
			updated_at = now()
		WHERE identity.device_registrations.user_account_id = EXCLUDED.user_account_id`,
		device.ID, device.UserAccountID, device.Platform, device.Status, nullableText(device.PushTokenRef))
	if err == nil && commandTag.RowsAffected() != 1 {
		return errors.New("device belongs to another user")
	}
	return err
}

func (r *IdentityRepository) UpsertDeviceAndPublish(ctx context.Context, device identity.DeviceRegistration, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := upsertDevice(transactionContext, transaction, device); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) HasActiveMembership(ctx context.Context, userID string, principal command.Principal) (bool, error) {
	var allowed bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM identity.memberships
			WHERE user_account_id = $1 AND principal_type = $2 AND principal_id = $3 AND status = 'ACTIVE'
		)`, userID, principal.Type, principal.ID).Scan(&allowed)
	return allowed, err
}

func (r *IdentityRepository) CreateSession(ctx context.Context, session identity.Session) error {
	return insertSession(ctx, execerForContext(ctx, r.pool), session)
}

func insertSession(ctx context.Context, execer sqlExecer, session identity.Session) error {
	_, err := execer.Exec(ctx, `
		INSERT INTO identity.sessions (
			id, user_account_id, device_id, status, principal_type, principal_id,
			issued_at, expires_at, version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		session.ID,
		session.UserAccountID,
		session.DeviceID,
		session.Status,
		session.Principal.Type,
		session.Principal.ID,
		session.IssuedAt,
		session.ExpiresAt,
		session.Version,
	)
	return err
}

func insertSessionTokens(ctx context.Context, execer sqlExecer, tokens identity.SessionToken) error {
	_, err := execer.Exec(ctx, `
		INSERT INTO identity.session_tokens (
			session_id, access_token_hash, refresh_token_hash,
			access_expires_at, refresh_expires_at, rotation
		) VALUES ($1, $2, $3, $4, $5, $6)`,
		tokens.SessionID,
		tokens.AccessTokenHash,
		tokens.RefreshTokenHash,
		tokens.AccessExpiresAt,
		tokens.RefreshExpiresAt,
		tokens.Rotation,
	)
	return err
}

func (r *IdentityRepository) CreateSessionAndPublish(ctx context.Context, session identity.Session, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := insertSession(transactionContext, transaction, session); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) CreateSessionWithTokensAndPublish(ctx context.Context, session identity.Session, tokens identity.SessionToken, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := insertSession(transactionContext, transaction, session); err != nil {
			return err
		}
		if err := insertSessionTokens(transactionContext, transaction, tokens); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) CreateLoginChallengeAndPublish(ctx context.Context, challenge identity.LoginChallenge, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := insertLoginChallenge(transactionContext, transaction, challenge); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) UpdateLoginChallengeAndPublish(ctx context.Context, challenge identity.LoginChallenge, expectedVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := updateLoginChallenge(transactionContext, transaction, challenge, expectedVersion); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func consumeLoginChallenge(ctx context.Context, execer sqlExecer, challenge identity.LoginChallenge, expectedVersion int) error {
	commandTag, err := execer.Exec(ctx, `
		UPDATE identity.login_challenges
		SET status = 'CONSUMED', version = $1, consumed_at = $2, updated_at = now()
		WHERE id = $3 AND version = $4 AND status = 'VERIFIED'`,
		challenge.Version,
		nullableTime(challenge.ConsumedAt),
		challenge.ID,
		expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return identity.ErrLoginChallengeNotUsable
	}
	return nil
}

func (r *IdentityRepository) CreateSessionWithTokensAndChallengeAndPublish(ctx context.Context, session identity.Session, tokens identity.SessionToken, challenge identity.LoginChallenge, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := consumeLoginChallenge(transactionContext, transaction, challenge, challenge.Version-1); err != nil {
			return err
		}
		if err := insertSession(transactionContext, transaction, session); err != nil {
			return err
		}
		if err := insertSessionTokens(transactionContext, transaction, tokens); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) SaveSessionTokens(ctx context.Context, tokens identity.SessionToken) error {
	return insertSessionTokens(ctx, execerForContext(ctx, r.pool), tokens)
}

func (r *IdentityRepository) GetByAccessTokenHash(ctx context.Context, accessTokenHash string) (identity.SessionToken, error) {
	return r.getSessionToken(ctx, `WHERE access_token_hash = $1`, accessTokenHash)
}

func (r *IdentityRepository) GetByRefreshTokenHash(ctx context.Context, refreshTokenHash string) (identity.SessionToken, error) {
	return r.getSessionToken(ctx, `WHERE refresh_token_hash = $1`, refreshTokenHash)
}

func (r *IdentityRepository) getSessionToken(ctx context.Context, predicate string, value string) (identity.SessionToken, error) {
	var tokens identity.SessionToken
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT session_id, access_token_hash, refresh_token_hash,
		       access_expires_at, refresh_expires_at, rotation
		FROM identity.session_tokens `+predicate, value).Scan(
		&tokens.SessionID,
		&tokens.AccessTokenHash,
		&tokens.RefreshTokenHash,
		&tokens.AccessExpiresAt,
		&tokens.RefreshExpiresAt,
		&tokens.Rotation,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.SessionToken{}, identity.ErrTokenNotFound
	}
	return tokens, err
}

func (r *IdentityRepository) RotateSessionTokens(ctx context.Context, sessionID string, expectedRotation int, replacement identity.SessionToken) error {
	commandTag, err := execerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE identity.session_tokens
		SET access_token_hash = $1,
		    refresh_token_hash = $2,
		    access_expires_at = $3,
		    refresh_expires_at = $4,
		    rotation = $5,
		    updated_at = now()
		WHERE session_id = $6 AND rotation = $7`,
		replacement.AccessTokenHash,
		replacement.RefreshTokenHash,
		replacement.AccessExpiresAt,
		replacement.RefreshExpiresAt,
		replacement.Rotation,
		sessionID,
		expectedRotation,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return identity.ErrTokenRotationConflict
	}
	return nil
}

func (r *IdentityRepository) RevokeSessionTokens(ctx context.Context, sessionID string) error {
	_, err := execerForContext(ctx, r.pool).Exec(ctx, `DELETE FROM identity.session_tokens WHERE session_id = $1`, sessionID)
	return err
}

func (r *IdentityRepository) GetSession(ctx context.Context, id string) (identity.Session, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, device_id, status, principal_type, principal_id,
		       issued_at, expires_at, version
		FROM identity.sessions
		WHERE id = $1`, id)
	session, err := scanSession(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.Session{}, identity.ErrSessionNotFound
	}
	return session, err
}

func (r *IdentityRepository) ListSessionsByUser(ctx context.Context, userID string) ([]identity.Session, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, user_account_id, device_id, status, principal_type, principal_id,
		       issued_at, expires_at, version
		FROM identity.sessions
		WHERE user_account_id = $1
		ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []identity.Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, session)
	}
	return result, rows.Err()
}

func (r *IdentityRepository) RevokeAllSessions(ctx context.Context, userID string) ([]identity.Session, error) {
	var sessions []identity.Session
	err := runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		var err error
		sessions, err = revokeAllSessionsTx(transactionContext, transaction, userID)
		return err
	})
	return sessions, err
}

func revokeAllSessionsTx(ctx context.Context, tx pgx.Tx, userID string) ([]identity.Session, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, user_account_id, device_id, status, principal_type, principal_id,
		       issued_at, expires_at, version
		FROM identity.sessions
		WHERE user_account_id = $1 AND status = 'ACTIVE'
		FOR UPDATE`, userID)
	if err != nil {
		return nil, err
	}
	sessions := []identity.Session{}
	for rows.Next() {
		session, scanErr := scanSession(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for index := range sessions {
		session := &sessions[index]
		newVersion := session.Version + 1
		commandTag, updateErr := tx.Exec(ctx, `
			UPDATE identity.sessions
			SET status = 'REVOKED', version = $1, updated_at = now()
			WHERE id = $2 AND version = $3 AND status = 'ACTIVE'`, newVersion, session.ID, session.Version)
		if updateErr != nil {
			return nil, updateErr
		}
		if commandTag.RowsAffected() != 1 {
			return nil, identity.ErrSessionVersionConflict
		}
		session.Status = "REVOKED"
		session.Version = newVersion
	}
	return sessions, nil
}

func (r *IdentityRepository) UpdateSession(ctx context.Context, session identity.Session, expectedVersion int) error {
	return updateSession(ctx, execerForContext(ctx, r.pool), session, expectedVersion)
}

func updateSession(ctx context.Context, execer sqlExecer, session identity.Session, expectedVersion int) error {
	commandTag, err := execer.Exec(ctx, `
		UPDATE identity.sessions
		SET status = $1, principal_type = $2, principal_id = $3, version = $4, updated_at = now()
		WHERE id = $5 AND version = $6`,
		session.Status,
		session.Principal.Type,
		session.Principal.ID,
		session.Version,
		session.ID,
		expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return identity.ErrSessionVersionConflict
	}
	return nil
}

func (r *IdentityRepository) UpdateSessionAndPublish(ctx context.Context, session identity.Session, expectedVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := updateSession(transactionContext, transaction, session, expectedVersion); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *IdentityRepository) RevokeAllSessionsAndPublish(ctx context.Context, userID string, buildEvents func([]identity.Session) []event.DomainEvent) ([]identity.Session, error) {
	if r.outbox == nil {
		return nil, errors.New("identity transactional outbox is not configured")
	}
	var sessions []identity.Session
	err := runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		var err error
		sessions, err = revokeAllSessionsTx(transactionContext, transaction, userID)
		if err != nil {
			return err
		}
		for _, domainEvent := range buildEvents(sessions) {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
	return sessions, err
}

func (r *IdentityRepository) Snapshot(ctx context.Context) ([]identity.Session, []identity.DeviceRegistration, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, user_account_id, device_id, status, principal_type, principal_id,
		       issued_at, expires_at, version
		FROM identity.sessions ORDER BY id`)
	if err != nil {
		return nil, nil, err
	}
	allSessions := []identity.Session{}
	for rows.Next() {
		session, scanErr := scanSession(rows)
		if scanErr != nil {
			rows.Close()
			return nil, nil, scanErr
		}
		allSessions = append(allSessions, session)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	rows.Close()

	deviceRows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, user_account_id, platform, status, push_token_ref
		FROM identity.device_registrations ORDER BY id`)
	if err != nil {
		return nil, nil, err
	}
	devices := []identity.DeviceRegistration{}
	for deviceRows.Next() {
		var device identity.DeviceRegistration
		if err := deviceRows.Scan(&device.ID, &device.UserAccountID, &device.Platform, &device.Status, &device.PushTokenRef); err != nil {
			deviceRows.Close()
			return nil, nil, err
		}
		devices = append(devices, device)
	}
	if err := deviceRows.Err(); err != nil {
		deviceRows.Close()
		return nil, nil, err
	}
	deviceRows.Close()
	return allSessions, devices, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(row rowScanner) (identity.Session, error) {
	var session identity.Session
	var principalType, principalID string
	err := row.Scan(
		&session.ID,
		&session.UserAccountID,
		&session.DeviceID,
		&session.Status,
		&principalType,
		&principalID,
		&session.IssuedAt,
		&session.ExpiresAt,
		&session.Version,
	)
	session.Principal = command.Principal{Type: principalType, ID: principalID}
	return session, err
}

func scanLoginChallenge(row rowScanner) (identity.LoginChallenge, error) {
	var challenge identity.LoginChallenge
	var verifiedAt, consumedAt *time.Time
	err := row.Scan(
		&challenge.ID,
		&challenge.UserAccountID,
		&challenge.LoginIdentityID,
		&challenge.DeviceID,
		&challenge.Channel,
		&challenge.ProviderRef,
		&challenge.Status,
		&challenge.Attempts,
		&challenge.MaxAttempts,
		&challenge.Version,
		&challenge.RequestedAt,
		&challenge.ExpiresAt,
		&verifiedAt,
		&consumedAt,
	)
	if verifiedAt != nil {
		challenge.VerifiedAt = verifiedAt.UTC()
	}
	if consumedAt != nil {
		challenge.ConsumedAt = consumedAt.UTC()
	}
	return challenge, err
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

var _ identity.Repository = (*IdentityRepository)(nil)
var _ identity.TransactionalRepository = (*IdentityRepository)(nil)
var _ identity.TokenRepository = (*IdentityRepository)(nil)
