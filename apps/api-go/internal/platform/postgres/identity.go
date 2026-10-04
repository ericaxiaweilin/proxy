package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
		SELECT id, user_account_id, verified, status, COALESCE(channel, ''), COALESCE(identifier, '')
		FROM identity.login_identities
		WHERE id = $1`, id).Scan(&loginIdentity.ID, &loginIdentity.UserAccountID, &loginIdentity.Verified, &loginIdentity.Status, &loginIdentity.Channel, &loginIdentity.Identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.LoginIdentity{}, identity.ErrLoginIdentityNotFound
	}
	return loginIdentity, err
}

func (r *IdentityRepository) FindLoginIdentity(ctx context.Context, channel, identifier string) (identity.LoginIdentity, error) {
	var loginIdentity identity.LoginIdentity
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, verified, status, COALESCE(channel, ''), COALESCE(identifier, '')
		FROM identity.login_identities
		WHERE channel = $1 AND identifier = $2`, channel, identifier).Scan(&loginIdentity.ID, &loginIdentity.UserAccountID, &loginIdentity.Verified, &loginIdentity.Status, &loginIdentity.Channel, &loginIdentity.Identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.LoginIdentity{}, identity.ErrLoginIdentityNotFound
	}
	return loginIdentity, err
}

func (r *IdentityRepository) EnsurePasswordlessIdentity(ctx context.Context, channel, identifier, deviceID, platform, upgradingUserAccountID string) (identity.LoginIdentity, identity.DeviceRegistration, bool, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var login identity.LoginIdentity
	err = transaction.QueryRow(ctx, `
		SELECT id, user_account_id, verified, status, COALESCE(channel, ''), COALESCE(identifier, '')
		FROM identity.login_identities WHERE channel = $1 AND identifier = $2 FOR UPDATE`, channel, identifier,
	).Scan(&login.ID, &login.UserAccountID, &login.Verified, &login.Status, &login.Channel, &login.Identifier)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		userID, loginID := postgresIdentityID("user_"), postgresIdentityID("login_")
		if upgradingUserAccountID != "" {
			userID = upgradingUserAccountID
			if _, err = transaction.Exec(ctx, `UPDATE identity.user_accounts SET status = 'REGISTERED', updated_at = now() WHERE id = $1`, userID); err != nil {
				return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
			}
		} else if _, err = transaction.Exec(ctx, `INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'REGISTERED')`, userID); err != nil {
			return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
		}
		if _, err = transaction.Exec(ctx, `INSERT INTO identity.login_identities (id, user_account_id, verified, status, channel, identifier) VALUES ($1, $2, TRUE, 'ACTIVE', $3, $4)`, loginID, userID, channel, identifier); err != nil {
			return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
		}
		if upgradingUserAccountID == "" {
			if _, err = transaction.Exec(ctx, `INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status) VALUES ('INDIVIDUAL', $1, $1, 'ACTIVE')`, userID); err != nil {
				return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
			}
		}
		// AGENT-CLAIM-NUMBER-001: 注册同事务分配接单编号。升级路径（账户已存在）
		// 若缺号也补，函数内部按“已有号不动”处理。
		if err = allocateAgentClaimNumber(ctx, transaction, userID); err != nil {
			return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
		}
		login = identity.LoginIdentity{ID: loginID, UserAccountID: userID, Channel: channel, Identifier: identifier, Verified: true, Status: "ACTIVE"}
		created = true
	} else if err != nil {
		return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
	}
	device := identity.DeviceRegistration{ID: deviceID, UserAccountID: login.UserAccountID, Platform: platform, Status: "ACTIVE"}
	if upgradingUserAccountID != "" {
		err = reassignDevice(ctx, transaction, device)
	} else {
		err = upsertDevice(ctx, transaction, device)
		if err != nil {
			// ACCOUNT-SWITCH-001 takeover: a fresh login of a different
			// account may claim the device when the device currently has
			// NO ACTIVE session on it (previous owner logged out or the
			// session expired/revoked). One-active-account-per-device
			// stays intact: upsertDevice keeps rejecting while the owner
			// still holds a live session on this device.
			takeover, takeoverErr := deviceHasNoActiveSession(ctx, transaction, deviceID)
			if takeoverErr == nil && takeover {
				err = reassignDevice(ctx, transaction, device)
			}
		}
	}
	if err != nil {
		return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
	}
	if err = transaction.Commit(ctx); err != nil {
		return identity.LoginIdentity{}, identity.DeviceRegistration{}, false, err
	}
	return login, device, created, nil
}

// AgentClaimNumber 按 user id 查接单编号（技师号）。
// ORDER-AGENT-CLAIM-NO-001：履约下单时把接单方的这个号冻进订单快照。
//
// **查不到返回 0 + nil error**，不是 ErrUserNotFound：0 = 未分配（内存仓注册、老数据、
// 号未轮到这个账户）是正常状态，调用方按「隐藏这一行」处理。只有真正的查询故障才
// 返回 error —— 上层同样 fail-open（不挡成交），但不会静默把一次故障当成「没编号」。
func (r *IdentityRepository) AgentClaimNumber(ctx context.Context, userAccountID string) (int, error) {
	if userAccountID == "" {
		return 0, nil
	}
	var claimNumber int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx,
		`SELECT claim_number FROM identity.agent_claim_numbers WHERE user_account_id = $1`, userAccountID).Scan(&claimNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if claimNumber < 1 || claimNumber > 10000000 {
		return 0, nil
	}
	return claimNumber, nil
}

// AGENT-CLAIM-NUMBER-001: 注册同事务分配接单编号（1 起、无跳号）。
// 计数器行 SELECT … FOR UPDATE，同事务回滚则号码一并作废——不存在“占了号但
// 账户没建成”的空洞。已有号（升级/重试）直接返回，不消耗新号。
func allocateAgentClaimNumber(ctx context.Context, tx pgx.Tx, userAccountID string) error {
	var existing int
	err := tx.QueryRow(ctx, `SELECT claim_number FROM identity.agent_claim_numbers WHERE user_account_id = $1`, userAccountID).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var next int
	if err := tx.QueryRow(ctx, `SELECT next_number FROM identity.agent_claim_number_counter WHERE id = 1 FOR UPDATE`).Scan(&next); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO identity.agent_claim_numbers (user_account_id, claim_number) VALUES ($1, $2) ON CONFLICT (user_account_id) DO NOTHING`, userAccountID, next); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE identity.agent_claim_number_counter SET next_number = next_number + 1 WHERE id = 1`)
	return err
}

func reassignDevice(ctx context.Context, execer sqlExecer, device identity.DeviceRegistration) error {
	_, err := execer.Exec(ctx, `INSERT INTO identity.device_registrations (id, user_account_id, platform, status, push_token_ref)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET user_account_id = EXCLUDED.user_account_id, platform = EXCLUDED.platform, status = EXCLUDED.status, push_token_ref = EXCLUDED.push_token_ref, updated_at = now()`,
		device.ID, device.UserAccountID, device.Platform, device.Status, nullableText(device.PushTokenRef))
	return err
}

func (r *IdentityRepository) EnsureAnonymousIdentity(ctx context.Context, deviceID, platform string) (identity.UserAccount, identity.DeviceRegistration, bool, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var device identity.DeviceRegistration
	err = transaction.QueryRow(ctx, `SELECT id, user_account_id, platform, status, COALESCE(push_token_ref, '') FROM identity.device_registrations WHERE id = $1 FOR UPDATE`, deviceID).
		Scan(&device.ID, &device.UserAccountID, &device.Platform, &device.Status, &device.PushTokenRef)
	if err == nil {
		var user identity.UserAccount
		if err = transaction.QueryRow(ctx, `SELECT id, status FROM identity.user_accounts WHERE id = $1`, device.UserAccountID).Scan(&user.ID, &user.Status); err != nil {
			return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
		}
		if err = transaction.Commit(ctx); err != nil {
			return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
		}
		return user, device, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	user := identity.UserAccount{ID: postgresIdentityID("user_"), Status: "ANONYMOUS"}
	device = identity.DeviceRegistration{ID: deviceID, UserAccountID: user.ID, Platform: platform, Status: "ACTIVE"}
	if _, err = transaction.Exec(ctx, `INSERT INTO identity.user_accounts (id, status) VALUES ($1, $2)`, user.ID, user.Status); err != nil {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	if _, err = transaction.Exec(ctx, `INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status) VALUES ('INDIVIDUAL', $1, $1, 'ACTIVE')`, user.ID); err != nil {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	if err = upsertDevice(ctx, transaction, device); err != nil {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	if err = transaction.Commit(ctx); err != nil {
		return identity.UserAccount{}, identity.DeviceRegistration{}, false, err
	}
	return user, device, true, nil
}

func postgresIdentityID(prefix string) string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return prefix + time.Now().UTC().Format("20060102150405.000000000")
	}
	return prefix + hex.EncodeToString(bytes[:])
}

func (r *IdentityRepository) CreateLoginChallenge(ctx context.Context, challenge identity.LoginChallenge) error {
	return insertLoginChallenge(ctx, execerForContext(ctx, r.pool), challenge)
}

// RevokePendingChallengesForIdentity supersedes every PENDING challenge
// of a login identity (OTP-SINGLE-CODE-001). One atomic UPDATE flips
// status to LOCKED and stamps consumed_at; RETURNING hands back the
// affected rows (id + prior version) so the service can emit a
// LoginChallengeSuperseded domain event per revoked code.
func (r *IdentityRepository) RevokePendingChallengesForIdentity(ctx context.Context, loginIdentityID string) ([]identity.LoginChallenge, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		UPDATE identity.login_challenges
		SET status = 'LOCKED', version = version + 1, updated_at = now()
		WHERE login_identity_id = $1 AND status = 'PENDING'
		RETURNING id, user_account_id, login_identity_id, device_id, channel, provider_ref,
		         status, attempts, max_attempts, version, requested_at, expires_at, verified_at, consumed_at`,
		loginIdentityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	revoked := make([]identity.LoginChallenge, 0, 2)
	for rows.Next() {
		c, err := scanLoginChallenge(rows)
		if err != nil {
			return nil, err
		}
		revoked = append(revoked, c)
	}
	return revoked, rows.Err()
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

func (r *IdentityRepository) BindDeviceCredential(ctx context.Context, deviceID, userAccountID, credentialHash string) error {
	tag, err := execerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE identity.device_registrations
		SET credential_hash = $1, updated_at = now()
		WHERE id = $2 AND user_account_id = $3 AND status = 'ACTIVE'`, credentialHash, deviceID, userAccountID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return identity.ErrDeviceNotFound
	}
	return nil
}

func (r *IdentityRepository) GetTrustedDevice(ctx context.Context, deviceID, credentialHash string) (identity.DeviceRegistration, error) {
	var device identity.DeviceRegistration
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, platform, status, COALESCE(push_token_ref, ''), COALESCE(credential_hash, '')
		FROM identity.device_registrations
		WHERE id = $1 AND credential_hash = $2 AND status = 'ACTIVE'`, deviceID, credentialHash).Scan(
		&device.ID, &device.UserAccountID, &device.Platform, &device.Status, &device.PushTokenRef, &device.CredentialHash,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.DeviceRegistration{}, identity.ErrDeviceNotFound
	}
	return device, err
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

// deviceHasNoActiveSession reports whether the device's owning account
// currently has no ACTIVE session bound to this device. It gates the
// ACCOUNT-SWITCH-001 takeover: once the previous owner logged out (or
// their session expired / was revoked), the phone is free for a new
// account; while a live session exists the device stays exclusive.
func deviceHasNoActiveSession(ctx context.Context, queryer sqlQueryer, deviceID string) (bool, error) {
	var n int
	if err := queryer.QueryRow(ctx, `
		SELECT count(*) FROM identity.sessions
		WHERE device_id = $1 AND status = 'ACTIVE'`, deviceID).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
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
			access_expires_at, refresh_expires_at, rotation, device_credential_hash
		) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tokens.SessionID,
		tokens.AccessTokenHash,
		tokens.RefreshTokenHash,
		tokens.AccessExpiresAt,
		tokens.RefreshExpiresAt,
		tokens.Rotation,
		tokens.DeviceCredentialHash,
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

// CreateLoginChallengeSupersedingPending atomically (1) flips every PENDING
// challenge of the identity to LOCKED, (2) inserts the fresh challenge,
// (3) publishes the superseded + requested events — one transaction.
// OTP-SINGLE-CODE-001.
func (r *IdentityRepository) CreateLoginChallengeSupersedingPending(ctx context.Context, challenge identity.LoginChallenge, buildEvents func(superseded []identity.LoginChallenge) []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("identity transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		rows, err := transaction.Query(transactionContext, `
			UPDATE identity.login_challenges
			SET status = 'LOCKED', version = version + 1, updated_at = now()
			WHERE login_identity_id = $1 AND status = 'PENDING'
			RETURNING id, user_account_id, login_identity_id, device_id, channel, provider_ref,
			         status, attempts, max_attempts, version, requested_at, expires_at, verified_at, consumed_at`,
			challenge.LoginIdentityID)
		if err != nil {
			return err
		}
		superseded := make([]identity.LoginChallenge, 0, 2)
		for rows.Next() {
			c, err := scanLoginChallenge(rows)
			if err != nil {
				rows.Close()
				return err
			}
			superseded = append(superseded, c)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if err := insertLoginChallenge(transactionContext, transaction, challenge); err != nil {
			return err
		}
		for _, domainEvent := range buildEvents(superseded) {
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
		       access_expires_at, refresh_expires_at, rotation, device_credential_hash
		FROM identity.session_tokens `+predicate, value).Scan(
		&tokens.SessionID,
		&tokens.AccessTokenHash,
		&tokens.RefreshTokenHash,
		&tokens.AccessExpiresAt,
		&tokens.RefreshExpiresAt,
		&tokens.Rotation,
		&tokens.DeviceCredentialHash,
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
		    device_credential_hash = $6,
		    updated_at = now()
		WHERE session_id = $7 AND rotation = $8`,
		replacement.AccessTokenHash,
		replacement.RefreshTokenHash,
		replacement.AccessExpiresAt,
		replacement.RefreshExpiresAt,
		replacement.Rotation,
		replacement.DeviceCredentialHash,
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
	if _, err := tx.Exec(ctx, `DELETE FROM identity.session_tokens WHERE session_id = ANY($1)`, sessionIDs(sessions)); err != nil {
		return nil, err
	}
	return sessions, nil
}

func sessionIDs(sessions []identity.Session) []string {
	ids := make([]string, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	return ids
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
		if session.Status == "REVOKED" {
			if _, err := transaction.Exec(transactionContext, `DELETE FROM identity.session_tokens WHERE session_id = $1`, session.ID); err != nil {
				return err
			}
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

// R16.7-P0-C: persist a Terms / Privacy acceptance record. Idempotent on
// (user_id, doc_kind, doc_version) — a re-consent on the same version
// hits the UNIQUE constraint and is silently ignored (the audit row from
// the first acceptance stands).
func (r *IdentityRepository) RecordLegalConsent(ctx context.Context, userID, docKind, docVersion, ip, userAgent string) error {
	id := "consent_" + userID + "_" + docKind + "_" + docVersion + "_" + time.Now().UTC().Format("20060102150405.000000")
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO privacy.legal_consent_records (id, user_id, doc_kind, doc_version, accepted_at, required, ip, user_agent)
		VALUES ($1, $2, $3, $4, now(), TRUE, NULLIF($5, '')::inet, NULLIF($6, ''))
		ON CONFLICT (user_id, doc_kind, doc_version) DO NOTHING
	`, id, userID, docKind, docVersion, ip, userAgent)
	return err
}

// COMP-AGE-001: 把注册时通过 18+ 判定的出生日期写进年龄断言流水
// （migrations/085）。Append-only —— 每次重新断言追加一行，不覆盖历史，
// 这样「改年龄」会留下痕迹而不是被抹掉。取当前年龄按 asserted_at 取最新一行。
func (r *IdentityRepository) RecordAgeAssertion(ctx context.Context, userID, dateOfBirth, source, ip, userAgent string) error {
	if source == "" {
		source = "SELF_DECLARED_AT_SIGNUP"
	}
	// 日期必须是 YYYY-MM-DD：createAnonymousSession 已经用同样的布局解析过
	// 一次，这里再确认一遍，避免把无法比较的字符串写进 DATE 列。
	if _, err := time.Parse("2006-01-02", dateOfBirth); err != nil {
		return fmt.Errorf("age assertion has an unparseable date of birth: %w", err)
	}
	id := "age_" + userID + "_" + time.Now().UTC().Format("20060102150405.000000")
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO identity.user_age_assertions
		(id, user_account_id, date_of_birth, source, asserted_at, ip, user_agent)
		VALUES ($1, $2, $3::date, $4, now(), NULLIF($5, '')::inet, NULLIF($6, ''))
	`, id, userID, dateOfBirth, source, ip, userAgent)
	return err
}

// AgeAt 计算某账号「当前年龄」：按 asserted_at 取最新一条断言。
// 查不到返回 0 —— 调用方必须把「查不到」当成「没有年龄证据」处理，
// 不能当成成年（fail-closed）。
func (r *IdentityRepository) AgeAt(ctx context.Context, userID string, at time.Time) (int, error) {
	var dob time.Time
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT date_of_birth
		FROM identity.user_age_assertions
		WHERE user_account_id = $1
		ORDER BY asserted_at DESC
		LIMIT 1
	`, userID).Scan(&dob)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return calendarAge(dob.UTC(), at.UTC()), nil
}

// calendarAge 用日历日比较，不用天数除法 —— 18 岁生日当天就该算成年
// （与 createAnonymousSession 里的 18+ 判定保持一致）。
func calendarAge(dob, at time.Time) int {
	age := at.Year() - dob.Year()
	if at.YearDay() < dob.YearDay() {
		age--
	}
	return age
}

// ListLegalConsents returns the consent rows the user has on file, in
// reverse chronological order. Used by GeneratePrivacyExportData to
// include the consent history in the data export payload (PRD v1.4
// LC-15 — the export must include the legal texts the user accepted
// and the timestamps of acceptance).
func (r *IdentityRepository) ListLegalConsents(ctx context.Context, userID string) ([]identity.LegalConsentSnapshot, error) {
	q := queryerForContext(ctx, r.pool)
	rows, err := q.Query(ctx, `
		SELECT doc_kind, doc_version, accepted_at, required
		FROM privacy.legal_consent_records
		WHERE user_id = $1
		ORDER BY accepted_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]identity.LegalConsentSnapshot, 0)
	for rows.Next() {
		var snap identity.LegalConsentSnapshot
		var kind string
		if err := rows.Scan(&kind, &snap.DocVersion, &snap.AcceptedAt, &snap.Required); err != nil {
			return nil, err
		}
		snap.DocKind = kind
		out = append(out, snap)
	}
	return out, rows.Err()
}

// --- R16.10-P1-F: privacy request center persistence ---

// CreatePrivacyRequest inserts a new privacy request. The service
// layer is expected to have already checked that no active request of
// the same (user, kind) exists; the partial unique index
// uq_privacy_requests_user_kind_active is the database-level safety net
// for the rare race where two requests are submitted in parallel.
func (r *IdentityRepository) CreatePrivacyRequest(ctx context.Context, req identity.PrivacyRequest) error {
	q := queryerForContext(ctx, r.pool)
	_, err := q.Exec(ctx, `
		INSERT INTO privacy.privacy_requests (
			id, user_id, kind, status, requested_at, completed_at, erased_at,
			export_snapshot_url, export_sha256, export_retention_until,
			legal_basis, client_ip, user_agent, rejection_reason
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, '')::inet, NULLIF($13, ''), NULLIF($14, '')
		)
	`,
		req.ID, req.UserID, string(req.Kind), string(req.Status), req.RequestedAt,
		derefTime(req.CompletedAt), derefTime(req.ErasedAt),
		req.ExportSnapshotURL, req.ExportSHA256, derefTime(req.ExportRetentionUntil),
		req.LegalBasis, req.ClientIP, req.UserAgent, req.RejectionReason,
	)
	if err != nil {
		// Map the partial unique violation to ErrPrivacyRequestActive
		// so the service layer can return the same error code as the
		// in-memory repository.
		if strings.Contains(err.Error(), "uq_privacy_requests_user_kind_active") {
			return identity.ErrPrivacyRequestActive
		}
		return err
	}
	return nil
}

// GetActivePrivacyRequest returns the user's currently active request
// of the given kind, or ErrPrivacyRequestNotFound.
func (r *IdentityRepository) GetActivePrivacyRequest(ctx context.Context, userID string, kind identity.PrivacyRequestKind) (identity.PrivacyRequest, error) {
	q := queryerForContext(ctx, r.pool)
	row := q.QueryRow(ctx, `
		SELECT id, user_id, kind, status, requested_at, completed_at, erased_at,
			export_snapshot_url, export_sha256, export_retention_until,
			legal_basis, COALESCE(host(client_ip), ''), COALESCE(user_agent, ''), COALESCE(rejection_reason, ''),
			version
		FROM privacy.privacy_requests
		WHERE user_id = $1 AND kind = $2 AND status IN ('received','in_progress')
		ORDER BY requested_at DESC
		LIMIT 1
	`, userID, string(kind))
	return scanPrivacyRequest(row)
}

// GetPrivacyRequest fetches a request by id.
func (r *IdentityRepository) GetPrivacyRequest(ctx context.Context, id string) (identity.PrivacyRequest, error) {
	q := queryerForContext(ctx, r.pool)
	row := q.QueryRow(ctx, `
		SELECT id, user_id, kind, status, requested_at, completed_at, erased_at,
			export_snapshot_url, export_sha256, export_retention_until,
			legal_basis, COALESCE(host(client_ip), ''), COALESCE(user_agent, ''), COALESCE(rejection_reason, ''),
			version
		FROM privacy.privacy_requests
		WHERE id = $1
	`, id)
	return scanPrivacyRequest(row)
}

// ListPrivacyRequestsByUser returns every request the user has
// submitted, newest first.
func (r *IdentityRepository) ListPrivacyRequestsByUser(ctx context.Context, userID string) ([]identity.PrivacyRequest, error) {
	q := queryerForContext(ctx, r.pool)
	rows, err := q.Query(ctx, `
		SELECT id, user_id, kind, status, requested_at, completed_at, erased_at,
			export_snapshot_url, export_sha256, export_retention_until,
			legal_basis, COALESCE(host(client_ip), ''), COALESCE(user_agent, ''), COALESCE(rejection_reason, ''),
			version
		FROM privacy.privacy_requests
		WHERE user_id = $1
		ORDER BY requested_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]identity.PrivacyRequest, 0)
	for rows.Next() {
		req, err := scanPrivacyRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// UpdatePrivacyRequest applies a status transition with optimistic
// concurrency. The version column is the source of truth; if a
// concurrent writer beat us, the WHERE clause matches no rows and we
// return ErrSessionVersionConflict (the same error the in-memory
// repository uses, so the service layer can stay neutral).
func (r *IdentityRepository) UpdatePrivacyRequest(ctx context.Context, req identity.PrivacyRequest, expectedVersion int) error {
	q := queryerForContext(ctx, r.pool)
	tag, err := q.Exec(ctx, `
		UPDATE privacy.privacy_requests
		SET status = $2,
			completed_at = $3,
			erased_at = $4,
			export_snapshot_url = NULLIF($5, ''),
			export_sha256 = NULLIF($6, ''),
			export_retention_until = $7,
			rejection_reason = NULLIF($8, ''),
			version = version + 1
		WHERE id = $1 AND status IN ('received','in_progress') AND version = $9
	`, req.ID, string(req.Status),
		derefTime(req.CompletedAt), derefTime(req.ErasedAt),
		req.ExportSnapshotURL, req.ExportSHA256, derefTime(req.ExportRetentionUntil),
		req.RejectionReason, expectedVersion,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either the row is gone or the previous transition already
		// happened. We map both to ErrSessionVersionConflict so the
		// service layer retries-or-rejects consistently with the
		// in-memory repository.
		return identity.ErrSessionVersionConflict
	}
	return nil
}

// AppendPrivacyRequestEvent records a status transition in the audit
// log. The privacy center never deletes from this log; the schema's
// ON DELETE CASCADE only fires if a parent row is hard-deleted, which
// the service layer never does.
func (r *IdentityRepository) AppendPrivacyRequestEvent(ctx context.Context, evt identity.PrivacyRequestEvent) error {
	q := queryerForContext(ctx, r.pool)
	_, err := q.Exec(ctx, `
		INSERT INTO privacy.privacy_request_events
			(request_id, from_status, to_status, occurred_at, actor, notes)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, NULLIF($6, ''))
	`, evt.RequestID, evt.FromStatus, evt.ToStatus, evt.OccurredAt, evt.Actor, evt.Notes)
	return err
}

// scanPrivacyRequest reads a single privacy_requests row from either a
// QueryRow or a Rows iterator. The two surfaces accept the same Scan
// signature, so the same scan helper works for both.
//
// The version column is read for real (it used to be a literal 1 in
// every SELECT, which capped each request at exactly one transition:
// the second UPDATE would pass expectedVersion=1 against a row already
// at 2 and match nothing). The LC-15 erasure executor needs two
// transitions per request — received -> in_progress -> completed — so
// the literal had to go. migration 061 added the column for exactly
// this reason; it was the reads that never caught up.
func scanPrivacyRequest(scanner interface {
	Scan(dest ...any) error
}) (identity.PrivacyRequest, error) {
	var (
		req            identity.PrivacyRequest
		kind           string
		status         string
		completedAt    *time.Time
		erasedAt       *time.Time
		snapshotURL    *string
		snapshotSHA    *string
		retentionUntil *time.Time
		clientIP       string
		userAgent      string
		rejection      string
		version        int
	)
	if err := scanner.Scan(
		&req.ID, &req.UserID, &kind, &status, &req.RequestedAt,
		&completedAt, &erasedAt, &snapshotURL, &snapshotSHA, &retentionUntil,
		&req.LegalBasis, &clientIP, &userAgent, &rejection, &version,
	); err != nil {
		if err.Error() == "no rows in result set" {
			return identity.PrivacyRequest{}, identity.ErrPrivacyRequestNotFound
		}
		return identity.PrivacyRequest{}, err
	}
	req.Kind = identity.PrivacyRequestKind(kind)
	req.Status = identity.PrivacyRequestStatus(status)
	req.CompletedAt = completedAt
	req.ErasedAt = erasedAt
	if snapshotURL != nil {
		req.ExportSnapshotURL = *snapshotURL
	}
	if snapshotSHA != nil {
		req.ExportSHA256 = *snapshotSHA
	}
	req.ExportRetentionUntil = retentionUntil
	req.ClientIP = clientIP
	req.UserAgent = userAgent
	req.RejectionReason = rejection
	req.Version = version
	return req, nil
}

// nullableTime and nullableString convert Go values to the nullable
// shapes pgx expects. They are tiny helpers rather than a generic
// library because the privacy surface only ever needs these two.
func derefTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

// ListDuePrivacyDeletions returns the delete requests the LC-15
// erasure executor still has to act on. 'kind = delete' is compared
// as a literal rather than a parameter because the CHECK constraint
// pins the value to the same closed set the Go enum uses.
func (r *IdentityRepository) ListDuePrivacyDeletions(ctx context.Context, receivedBefore time.Time) ([]identity.PrivacyRequest, error) {
	q := queryerForContext(ctx, r.pool)
	rows, err := q.Query(ctx, `
		SELECT id, user_id, kind, status, requested_at, completed_at, erased_at,
			export_snapshot_url, export_sha256, export_retention_until,
			legal_basis, COALESCE(host(client_ip), ''), COALESCE(user_agent, ''), COALESCE(rejection_reason, ''),
			version
		FROM privacy.privacy_requests
		WHERE kind = 'delete'
			AND status IN ('received','in_progress')
			AND requested_at <= $1
		ORDER BY requested_at
	`, receivedBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]identity.PrivacyRequest, 0)
	for rows.Next() {
		req, err := scanPrivacyRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// ErasePersonalData carries out the destructive half of LC-15
// (Vietnam PDP 91/2025/QH15 Art. 32) for one user.
//
// Everything runs in ONE transaction, so a partial erasure is not a
// reachable state: either the user's directly-identifying rows are
// gone and the account is marked ERASED, or nothing changed and the
// sweeper retries on the next pass.
//
// Two ordering constraints come from migration 049's foreign keys and
// are load-bearing:
//
//   - identity_sessions_device_fk is ON DELETE RESTRICT, so sessions
//     must go before the devices they point at.
//   - business_owner_user_fk (business.accounts.owner_user_id) is also
//     ON DELETE RESTRICT, which is the reason the user_accounts row is
//     anonymised instead of deleted. Hard-deleting it would either
//     fail outright or, worse, cascade away financial records the
//     platform is required to keep.
//
// What is NOT touched is listed in identity.RetainedOnErasure; the
// short version is that ledgers, consent records, the agent claim
// number and the privacy audit trail survive, and the age assertion
// keeps its date_of_birth (COMP-AGE-001 minor-protection evidence)
// while losing the ip / user_agent that identify the client.
func (r *IdentityRepository) ErasePersonalData(ctx context.Context, userID string) (identity.ErasedPersonalData, error) {
	var receipt identity.ErasedPersonalData
	if userID == "" {
		return receipt, errors.New("erase personal data: empty user id")
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return receipt, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Each statement is its own count: the receipt has to be able to
	// answer "which table did you actually empty?".
	exec := func(query string, args ...any) (int64, error) {
		tag, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return 0, err
		}
		return tag.RowsAffected(), nil
	}
	step := func(dest *int, query string, args ...any) error {
		n, err := exec(query, args...)
		if err != nil {
			return err
		}
		*dest += int(n)
		return nil
	}

	// 1. Sessions before devices (identity_sessions_device_fk RESTRICT).
	//    session_tokens is keyed by session_id, not user_account_id.
	if err := step(&receipt.SessionTokens, `
		DELETE FROM identity.session_tokens
		WHERE session_id IN (SELECT id FROM identity.sessions WHERE user_account_id = $1)
	`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.Sessions, `DELETE FROM identity.sessions WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.Devices, `DELETE FROM identity.device_registrations WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}

	// 2. Login surface. Challenges are matched by user id OR by the
	//    identity they belong to, because login_challenges.user_account_id
	//    is nullable (an anonymous-device challenge has no account yet).
	if err := step(&receipt.LoginChallenges, `
		DELETE FROM identity.login_challenges
		WHERE user_account_id = $1
		   OR login_identity_id IN (SELECT id FROM identity.login_identities WHERE user_account_id = $1)
	`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.LoginIdentities, `DELETE FROM identity.login_identities WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}

	// 3. Profile-shaped data: name / handle / bio / city / avatar, the
	//    social accounts and collaboration contact, the display
	//    identities (alias + display name), the membership edges, and
	//    the coarse jurisdiction inference.
	if err := step(&receipt.Profiles, `DELETE FROM identity.profiles WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.AccountPreferences, `DELETE FROM identity.account_preferences WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.AiEngineSettings, `DELETE FROM identity.ai_engine_settings WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.AiTokenUsage, `DELETE FROM identity.ai_token_usage WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.DisplayIdentities, `DELETE FROM identity.display_identities WHERE owner_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.Memberships, `DELETE FROM identity.memberships WHERE user_account_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	if err := step(&receipt.Jurisdictions, `DELETE FROM identity.user_jurisdiction WHERE user_id = $1`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}

	// 4. Age assertions: keep the DOB (it is the evidence that the 18+
	//    gate was applied — COMP-AGE-001), drop the client metadata.
	if err := step(&receipt.AgeAssertionsWiped, `
		UPDATE identity.user_age_assertions
		SET ip = NULL, user_agent = NULL
		WHERE user_account_id = $1 AND (ip IS NOT NULL OR user_agent IS NOT NULL)
	`, userID); err != nil {
		return identity.ErasedPersonalData{}, err
	}

	// 5. Anonymise the account row. Kept: see identity.RetainedOnErasure.
	//    Flipping the status is what makes the account unable to
	//    authenticate (identity.canHoldSession excludes ERASED).
	tag, err := tx.Exec(ctx, `
		UPDATE identity.user_accounts SET status = $2, updated_at = now() WHERE id = $1
	`, userID, identity.AccountStatusErased)
	if err != nil {
		return identity.ErasedPersonalData{}, err
	}
	receipt.AccountAnonymised = tag.RowsAffected() > 0

	if err := tx.Commit(ctx); err != nil {
		return identity.ErasedPersonalData{}, err
	}
	return receipt, nil
}

var _ identity.Repository = (*IdentityRepository)(nil)
var _ identity.PrivacyRequestRepository = (*IdentityRepository)(nil)
var _ identity.PersonalDataEraser = (*IdentityRepository)(nil)
var _ identity.TransactionalRepository = (*IdentityRepository)(nil)
var _ identity.TokenRepository = (*IdentityRepository)(nil)
var _ identity.ProfileRepository = (*IdentityRepository)(nil)

// GetProfile fetches the row keyed by user_account_id. If no row
// exists, returns identity.ErrProfileNotFound.
func (r *IdentityRepository) GetProfile(ctx context.Context, userAccountID string) (identity.Profile, error) {
	var p identity.Profile
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT p.user_account_id, p.name, p.handle, p.bio, p.city, p.avatar_path, p.version, p.updated_at,
			COALESCE(c.claim_number, 0)
		FROM identity.profiles p
		LEFT JOIN identity.agent_claim_numbers c ON c.user_account_id = p.user_account_id
		WHERE p.user_account_id=$1`, userAccountID).Scan(
		&p.UserAccountID, &p.Name, &p.Handle, &p.Bio, &p.City, &p.AvatarPath, &p.Version, &p.UpdatedAt,
		&p.ClaimNumber,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.Profile{}, identity.ErrProfileNotFound
	}
	return p, err
}

// GetProfileByHandle resolves a profile by handle. HANDLE-UNIQUE-001: the
// comparison uses the same normalized form as the unique index
// (lower(ltrim(handle,'@'))), so "@Linh", "linh" and "@linh" all resolve to
// one row — which is what a proxy.app/@linh QR code means. Without this the
// index would be an unused artefact, which is exactly how the handle
// uniqueness invariant rotted into a comment in the first place.
func (r *IdentityRepository) GetProfileByHandle(ctx context.Context, handle string) (identity.Profile, error) {
	want := identity.NormalizeHandle(handle)
	if want == "" {
		return identity.Profile{}, identity.ErrProfileNotFound
	}
	var p identity.Profile
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT p.user_account_id, p.name, p.handle, p.bio, p.city, p.avatar_path, p.version, p.updated_at,
			COALESCE(c.claim_number, 0)
		FROM identity.profiles p
		LEFT JOIN identity.agent_claim_numbers c ON c.user_account_id = p.user_account_id
		WHERE lower(ltrim(p.handle, '@')) = $1`, want).Scan(
		&p.UserAccountID, &p.Name, &p.Handle, &p.Bio, &p.City, &p.AvatarPath, &p.Version, &p.UpdatedAt,
		&p.ClaimNumber,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.Profile{}, identity.ErrProfileNotFound
	}
	return p, err
}

// SearchProfiles finds profiles by normalized handle or display name
// (PROFILE-SEARCH-001). Mirrors MemoryProfileRepository.SearchProfiles:
// same predicate, same ordering, same limit.
//
// strpos() rather than LIKE, deliberately. LIKE gives the caller wildcard
// semantics, so a query of "%" or "_" would match every row — a two-character
// request that dumps the entire user table, and one that no amount of input
// validation on length would catch. strpos is a literal substring test, which
// is exactly what the in-memory store does with strings.Contains, so the two
// cannot drift.
//
// Ordered by the normalized handle so the result set is stable and matches the
// in-memory order.
// ListProfilesNearby answers the home rail (HOME-RAIL-SERVER-001).
//
// Distance is computed here, in SQL, with the same haversine the in-memory
// repository uses. The client cannot do this: it never receives a server user's
// coordinates through any profile read, which is exactly why
// PERSON-DISTANCE-ZERO-001 excluded every server user from the rail's
// "distance is a real radius" filter and left the 7 fixture people on screen.
//
// Coordinates come from supply.agent_profiles (the map layer already kept them
// there). A profile without an agent_profile row — or with NULL lat/lng — is
// NOT returned: "no coordinates" must never read as "0 metres away".
func (r *IdentityRepository) ListProfilesNearby(ctx context.Context, latitude, longitude, maxDistanceM float64, slotStart, slotEnd *time.Time, limit int) ([]identity.Profile, error) {
	if limit <= 0 {
		return []identity.Profile{}, nil
	}
	// maxDistanceM <= 0 means no cap, expressed as a negative sentinel the SQL
	// treats as "no limit" — interpolating SQL text for that would be worse.
	radius := -1.0
	if maxDistanceM > 0 {
		radius = maxDistanceM
	}
	//
	// 占位符必须**连续**：第一版这里是 $1/$2/$4（跳过了 $3），Postgres 直接报
	// there is no parameter $3，而那条错误在事务里被后续语句盖成
	// "current transaction is aborted (25P02)" —— 真正的错因一行日志都没留下，
	// 只看到 PROFILE_SEARCH_FAILED。现在占位符连号，并把半径过滤下推到 SQL，
	// 省掉把超半径的行取回来再在 Go 里丢弃。
	// HOME-FORYOU-FREE-001：同时取"这个人有没有一段 AVAILABLE 的空档盖住了请求时段"。
	//
	// 用 LEFT JOIN + 一个把 NULL 折成三态之一的表达式，而不是 WHERE 里过滤 ——
	// 过滤会把"没有排期的人"直接删掉，调用方就分不清「没空」和「根本不知道」，
	// 而推荐位必须能把两者分开（未知不能当"有空"，否则又是一个假承诺）。
	//
	// w.start_at/end_at 取**最宽**的那一段（max(end_at)），够不够覆盖请求时段由
	// free_at 判定；FreeFrom/FreeUntil 就是那一段，供界面如实显示。
	// FOR-YOU-CANDIDATES-001（2026-10-04）：不再要求先开通接单资料（默认人人可接单）。
	// 位置优先取本人上报的实时位置（identity.profiles.lat/lng），没有再退到接单资料的
	// 服务坐标；两边都没有的人不进「附近」（距离未知 ≠ 很近）。接单资料按人只取一行
	// （LATERAL LIMIT 1），避免同一个人有多行接单资料时被扇出成多个候选。
	const query = `
		WITH located AS (
			SELECT p.user_account_id, p.name, p.handle, p.bio, p.city, p.avatar_path, p.version, p.updated_at,
				COALESCE(p.lat, ag.lat) AS lat, COALESCE(p.lng, ag.lng) AS lng, ag.agent_id
			FROM identity.profiles p
			LEFT JOIN LATERAL (
				SELECT a.lat, a.lng, a.agent_id
				  FROM supply.agent_profiles a
				 WHERE a.user_account_id = p.user_account_id
				 ORDER BY (a.lat IS NULL), a.updated_at DESC
				 LIMIT 1
			) ag ON TRUE
		),
		measured AS (
			SELECT l.*, 6371000.0 * 2 * asin(sqrt(
				power(sin(radians(l.lat - $1) / 2), 2) +
				cos(radians($1)) * cos(radians(l.lat)) *
				power(sin(radians(l.lng - $2) / 2), 2)
			)) AS meters
			FROM located l
			WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL
		)
		SELECT m.user_account_id, m.name, m.handle, m.bio, m.city, m.avatar_path, m.version, m.updated_at,
			COALESCE(c.claim_number, 0), m.lat, m.lng,
			w.start_at, w.end_at,
			CASE
				WHEN $5::timestamptz IS NULL OR $6::timestamptz IS NULL THEN NULL
				WHEN w.id IS NULL THEN NULL
				WHEN w.start_at <= $5 AND w.end_at >= $6 THEN TRUE
				ELSE FALSE
			END AS free_at,
			m.meters
		FROM measured m
		LEFT JOIN identity.agent_claim_numbers c ON c.user_account_id = m.user_account_id
		-- ⚠️ 时段条件**不能**放进 JOIN 的 WHERE（见 HOME-FORYOU-FREE-001 的三态）：
		--   w.id IS NULL ⇒ 没有排期（未知）；w 覆盖 ⇒ 有空；不覆盖 ⇒ 没空。
		LEFT JOIN LATERAL (
			SELECT aw.id, aw.start_at, aw.end_at
			  FROM supply.availability_windows aw
			 WHERE aw.agent_id = m.agent_id AND aw.status = 'AVAILABLE'
			   AND aw.end_at > now()
			 ORDER BY aw.end_at DESC
			 LIMIT 1
		) w ON TRUE
		WHERE ($3 < 0 OR m.meters < $3)
		ORDER BY m.meters ASC
		LIMIT $4`
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, latitude, longitude, radius, limit, slotStart, slotEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]identity.Profile, 0, limit)
	for rows.Next() {
		var p identity.Profile
		var lat, lng, meters *float64
		// HOME-FORYOU-FREE-001：free_at 三态（NULL / true / false）—— 没有排期的人
		// 是 NULL（未知），不是 false。扫进 **bool 得 nil，正好把三态保住。
		var freeAt *bool
		var freeFrom, freeUntil *time.Time
		if err := rows.Scan(&p.UserAccountID, &p.Name, &p.Handle, &p.Bio, &p.City,
			&p.AvatarPath, &p.Version, &p.UpdatedAt, &p.ClaimNumber, &lat, &lng,
			&freeFrom, &freeUntil, &freeAt, &meters); err != nil {
			return nil, err
		}
		p.FreeAt, p.FreeFrom, p.FreeUntil = freeAt, freeFrom, freeUntil
		p.Latitude, p.Longitude = lat, lng
		// No radius cap requested ⇒ only rows within the cap, when a cap was
		// given. Applied here (not in SQL) so the two stores share one rule.
		if radius > 0 && meters != nil && *meters >= radius {
			continue
		}
		if meters != nil {
			m := *meters
			p.DistanceM = &m
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *IdentityRepository) SearchProfiles(ctx context.Context, query string, limit int) ([]identity.Profile, error) {
	needle := strings.ToLower(strings.TrimSpace(query))
	handleNeedle := identity.NormalizeHandle(query)
	if needle == "" || limit <= 0 {
		return []identity.Profile{}, nil
	}
	// The `$1 <> ''` guard is load-bearing: strpos(x, '') returns 1, i.e.
	// "matches everything", so an empty handle needle (a query of just "@")
	// would return the whole user table. The guard has to live in SQL — a
	// sentinel value cannot work here, because Postgres text parameters cannot
	// carry a NUL byte at all (SQLSTATE 22021, invalid byte sequence for
	// encoding "UTF8").
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT p.user_account_id, p.name, p.handle, p.bio, p.city, p.avatar_path, p.version, p.updated_at,
			COALESCE(c.claim_number, 0)
		FROM identity.profiles p
		LEFT JOIN identity.agent_claim_numbers c ON c.user_account_id = p.user_account_id
		WHERE ($1 <> '' AND strpos(lower(ltrim(p.handle, '@')), $1) > 0)
		   OR strpos(lower(p.name), $2) > 0
		ORDER BY lower(ltrim(p.handle, '@'))
		LIMIT $3`, handleNeedle, needle, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]identity.Profile, 0, limit)
	for rows.Next() {
		var p identity.Profile
		if err := rows.Scan(
			&p.UserAccountID, &p.Name, &p.Handle, &p.Bio, &p.City, &p.AvatarPath, &p.Version, &p.UpdatedAt,
			&p.ClaimNumber,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpsertProfile atomically increments the version and updates
// updated_at on conflict, so concurrent updates from the same
// actor (rare but possible on slow networks) see monotonically
// increasing versions.
// UpdateProfileLocation（FOR-YOU-CANDIDATES-001）：本人上报的实时位置。
func (r *IdentityRepository) UpdateProfileLocation(ctx context.Context, userAccountID string, latitude, longitude float64) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE identity.profiles SET lat = $2, lng = $3, location_updated_at = now()
		 WHERE user_account_id = $1`, userAccountID, latitude, longitude)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return identity.ErrProfileNotFound
	}
	return nil
}

func (r *IdentityRepository) UpsertProfile(ctx context.Context, p identity.Profile) (identity.Profile, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		WITH up AS (
			INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,1,$7)
			ON CONFLICT (user_account_id) DO UPDATE SET
				name=EXCLUDED.name,
				handle=EXCLUDED.handle,
				bio=EXCLUDED.bio,
				city=EXCLUDED.city,
				avatar_path=EXCLUDED.avatar_path,
				version=identity.profiles.version + 1,
				updated_at=EXCLUDED.updated_at
			RETURNING user_account_id, name, handle, bio, city, avatar_path, version, updated_at
		)
		SELECT up.user_account_id, up.name, up.handle, up.bio, up.city, up.avatar_path, up.version, up.updated_at,
			COALESCE(c.claim_number, 0)
		FROM up
		LEFT JOIN identity.agent_claim_numbers c ON c.user_account_id = up.user_account_id`,
		p.UserAccountID, p.Name, p.Handle, p.Bio, p.City, p.AvatarPath, p.UpdatedAt)
	var out identity.Profile
	if err := row.Scan(&out.UserAccountID, &out.Name, &out.Handle, &out.Bio, &out.City, &out.AvatarPath, &out.Version, &out.UpdatedAt, &out.ClaimNumber); err != nil {
		// HANDLE-UNIQUE-001: the ON CONFLICT clause above only covers
		// user_account_id. A collision on the handle unique index arrives
		// here as a 23505, and it must be reported as "that handle is taken"
		// rather than as a generic failure — otherwise the user is told
		// their profile is invalid while the one field they could actually
		// change goes unnamed.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && strings.Contains(pgErr.ConstraintName, "handle") {
			return identity.Profile{}, identity.ErrProfileHandleTaken
		}
		return identity.Profile{}, err
	}
	return out, nil
}
