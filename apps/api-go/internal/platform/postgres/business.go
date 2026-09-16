package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/business"
)

func (r *BusinessRepository) UpsertAggregatedDemandSignal(ctx context.Context, s business.AggregatedDemandSignal) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO business.aggregated_demand_signals (business_id,total_matching_demand,confirmed_arrivals,high_probability_arrivals,confidence,recorded_at) VALUES ($1,$2,$3,$4,$5,$6)`, s.BusinessID, s.TotalMatchingDemand, s.ConfirmedArrivals, s.HighProbabilityArrivals, s.Confidence, s.RecordedAt)
	return err
}
func (r *BusinessRepository) LatestAggregatedDemandSignal(ctx context.Context, id string) (business.AggregatedDemandSignal, error) {
	var s business.AggregatedDemandSignal
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT business_id,total_matching_demand,confirmed_arrivals,high_probability_arrivals,confidence,recorded_at FROM business.aggregated_demand_signals WHERE business_id=$1 ORDER BY recorded_at DESC LIMIT 1`, id).Scan(&s.BusinessID, &s.TotalMatchingDemand, &s.ConfirmedArrivals, &s.HighProbabilityArrivals, &s.Confidence, &s.RecordedAt)
	return s, err
}
func (r *BusinessRepository) UpsertSceneSupplySnapshot(ctx context.Context, s business.SceneSupplySnapshot) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO business.scene_supply_snapshots (business_id,store_id,scene_id,current_capacity_pct,forecast_capacity_pct,accepting_traffic,confidence,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, s.BusinessID, s.StoreID, s.SceneID, s.CurrentCapacityPct, s.ForecastCapacityPct, s.AcceptingTraffic, s.Confidence, s.RecordedAt)
	return err
}
func (r *BusinessRepository) LatestSceneSupplySnapshot(ctx context.Context, id string) (business.SceneSupplySnapshot, error) {
	var s business.SceneSupplySnapshot
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT business_id,store_id,scene_id,current_capacity_pct,forecast_capacity_pct,accepting_traffic,confidence,recorded_at FROM business.scene_supply_snapshots WHERE business_id=$1 ORDER BY recorded_at DESC LIMIT 1`, id).Scan(&s.BusinessID, &s.StoreID, &s.SceneID, &s.CurrentCapacityPct, &s.ForecastCapacityPct, &s.AcceptingTraffic, &s.Confidence, &s.RecordedAt)
	return s, err
}

// BusinessRepository persists merchant accounts, memberships, stores and spend
// projections. Authorization remains in the domain service; repository queries
// are deliberately scoped by business/user identifiers supplied by that layer.
type BusinessRepository struct {
	pool *pgxpool.Pool
}

func NewBusinessRepository(pool *pgxpool.Pool) *BusinessRepository {
	return &BusinessRepository{pool: pool}
}

func (r *BusinessRepository) CreateAccount(ctx context.Context, account business.Account) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		if _, err := queryerForContext(txCtx, r.pool).Exec(txCtx, `
			INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
			VALUES ($1,$2,$3,$4,$5)`,
			account.ID, account.OwnerUserID, account.Name, account.Status, account.CreatedAt); err != nil {
			return err
		}
		_, err := queryerForContext(txCtx, r.pool).Exec(txCtx, `
			INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
			VALUES ($1,$2,'OWNER','ACTIVE',$3)`, account.ID, account.OwnerUserID, account.CreatedAt)
		return err
	})
}

func (r *BusinessRepository) GetAccount(ctx context.Context, id string) (business.Account, error) {
	var account business.Account
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_user_id, name, status, created_at
		FROM business.accounts WHERE id=$1`, id).Scan(
		&account.ID, &account.OwnerUserID, &account.Name, &account.Status, &account.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.Account{}, errors.New("account not found")
	}
	return account, err
}

func (r *BusinessRepository) GetMembership(ctx context.Context, businessID, userID string) (business.Membership, error) {
	var membership business.Membership
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT business_id, user_id, role, status, created_at
		FROM business.memberships WHERE business_id=$1 AND user_id=$2`, businessID, userID).Scan(
		&membership.BusinessID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.Membership{}, errors.New("membership not found")
	}
	return membership, err
}

func (r *BusinessRepository) ListAccountsForUser(ctx context.Context, userID string) ([]business.Account, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT a.id, a.owner_user_id, a.name, a.status, a.created_at,
			COALESCE(p.avatar_path, '')
		FROM business.accounts a
		JOIN business.memberships m ON m.business_id=a.id
		LEFT JOIN identity.profiles p ON p.user_account_id=a.owner_user_id
		WHERE m.user_id=$1 AND m.status='ACTIVE' AND a.status='ACTIVE'
		ORDER BY a.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Account{}
	for rows.Next() {
		var account business.Account
		if err := rows.Scan(&account.ID, &account.OwnerUserID, &account.Name, &account.Status, &account.CreatedAt, &account.AvatarPath); err != nil {
			return nil, err
		}
		result = append(result, account)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) CreateMembership(ctx context.Context, membership business.Membership) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (business_id, user_id) DO UPDATE
		SET role=EXCLUDED.role, status=EXCLUDED.status`,
		membership.BusinessID, membership.UserID, membership.Role, membership.Status, membership.CreatedAt)
	return err
}

func (r *BusinessRepository) ListMembers(ctx context.Context, businessID string) ([]business.Membership, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT business_id, user_id, role, status, created_at
		FROM business.memberships WHERE business_id=$1 ORDER BY created_at`, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Membership{}
	for rows.Next() {
		var membership business.Membership
		if err := rows.Scan(&membership.BusinessID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, membership)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) CreateStore(ctx context.Context, store business.Store) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.stores (id, business_id, name, address, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, store.ID, store.BusinessID, store.Name, store.Address, store.Status, store.CreatedAt)
	return err
}

func (r *BusinessRepository) ListStores(ctx context.Context, businessID string) ([]business.Store, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, business_id, name, address, status, created_at
		FROM business.stores WHERE business_id=$1 ORDER BY created_at`, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Store{}
	for rows.Next() {
		var store business.Store
		if err := rows.Scan(&store.ID, &store.BusinessID, &store.Name, &store.Address, &store.Status, &store.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, store)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) GetStore(ctx context.Context, storeID string) (business.Store, error) {
	var store business.Store
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, business_id, name, address, status, created_at
		FROM business.stores WHERE id=$1`, storeID).Scan(
		&store.ID, &store.BusinessID, &store.Name, &store.Address, &store.Status, &store.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.Store{}, errors.New("store not found")
	}
	return store, err
}

func (r *BusinessRepository) AddStorePhoto(ctx context.Context, p business.StorePhoto) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.store_photos (id, store_id, business_id, uploaded_by, asset_path, caption, sort_order, media_asset_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		p.ID, p.StoreID, p.BusinessID, p.UploadedBy, p.AssetPath, p.Caption, p.SortOrder, p.MediaAssetID, p.CreatedAt)
	return err
}

func (r *BusinessRepository) ListStorePhotos(ctx context.Context, storeID string) ([]business.StorePhoto, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, store_id, business_id, uploaded_by, asset_path, caption, sort_order, media_asset_id, created_at
		FROM business.store_photos WHERE store_id=$1 ORDER BY sort_order, created_at DESC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.StorePhoto{}
	for rows.Next() {
		var p business.StorePhoto
		if err := rows.Scan(&p.ID, &p.StoreID, &p.BusinessID, &p.UploadedBy, &p.AssetPath, &p.Caption, &p.SortOrder, &p.MediaAssetID, &p.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) DeleteStorePhoto(ctx context.Context, storeID, photoID, requesterID string) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		DELETE FROM business.store_photos
		WHERE store_id=$1 AND id=$2 AND uploaded_by=$3`, storeID, photoID, requesterID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("photo not found or not owned by requester")
	}
	return nil
}

func (r *BusinessRepository) GetStorePhoto(ctx context.Context, storeID, photoID string) (business.StorePhoto, error) {
	var p business.StorePhoto
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, store_id, business_id, uploaded_by, asset_path, caption, sort_order, media_asset_id, created_at
		FROM business.store_photos WHERE store_id=$1 AND id=$2`, storeID, photoID).Scan(
		&p.ID, &p.StoreID, &p.BusinessID, &p.UploadedBy, &p.AssetPath, &p.Caption, &p.SortOrder, &p.MediaAssetID, &p.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.StorePhoto{}, errors.New("photo not found")
	}
	return p, err
}

func (r *BusinessRepository) UpsertStoreLines(ctx context.Context, l business.StoreLines) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.store_lines (store_id, business_id, logo_asset_path, description, hours_json, contact_phone, contact_email, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (store_id) DO UPDATE SET
			logo_asset_path=EXCLUDED.logo_asset_path,
			description=EXCLUDED.description,
			hours_json=EXCLUDED.hours_json,
			contact_phone=EXCLUDED.contact_phone,
			contact_email=EXCLUDED.contact_email,
			updated_by=EXCLUDED.updated_by,
			updated_at=EXCLUDED.updated_at`,
		l.StoreID, l.BusinessID, l.LogoAssetPath, l.Description, l.HoursJSON, l.ContactPhone, l.ContactEmail, l.UpdatedBy, l.UpdatedAt)
	return err
}

func (r *BusinessRepository) GetStoreLines(ctx context.Context, storeID string) (business.StoreLines, error) {
	var l business.StoreLines
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT store_id, business_id, logo_asset_path, description, hours_json, contact_phone, contact_email, updated_by, updated_at
		FROM business.store_lines WHERE store_id=$1`, storeID).Scan(
		&l.StoreID, &l.BusinessID, &l.LogoAssetPath, &l.Description, &l.HoursJSON, &l.ContactPhone, &l.ContactEmail, &l.UpdatedBy, &l.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.StoreLines{StoreID: storeID}, nil
	}
	return l, err
}

func (r *BusinessRepository) UpsertMemberDirectory(ctx context.Context, m business.MemberDirectory) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.member_directory (business_id, user_id, display_name, role, status, joined_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (business_id, user_id) DO UPDATE SET
			display_name=EXCLUDED.display_name,
			role=EXCLUDED.role,
			status=EXCLUDED.status`,
		m.BusinessID, m.UserID, m.DisplayName, m.Role, m.Status, m.JoinedAt)
	return err
}

func (r *BusinessRepository) ListMemberDirectory(ctx context.Context, businessID string) ([]business.MemberDirectory, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT business_id, user_id, display_name, role, status, joined_at
		FROM business.member_directory WHERE business_id=$1 ORDER BY joined_at`, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.MemberDirectory{}
	for rows.Next() {
		var m business.MemberDirectory
		if err := rows.Scan(&m.BusinessID, &m.UserID, &m.DisplayName, &m.Role, &m.Status, &m.JoinedAt); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) UpsertSpendDaily(ctx context.Context, s business.SpendDaily) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.spend_daily (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (business_id, bucket_date) DO UPDATE SET
			order_count=EXCLUDED.order_count,
			gross_minor=EXCLUDED.gross_minor,
			new_customer_count=EXCLUDED.new_customer_count,
			returning_customer_count=EXCLUDED.returning_customer_count`,
		s.BusinessID, s.BucketDate, s.OrderCount, s.GrossMinor, s.NewCustomerCount, s.ReturningCustomerCount)
	return err
}

func (r *BusinessRepository) ListSpendDaily(ctx context.Context, businessID string, sinceDays int) ([]business.SpendDaily, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT business_id, bucket_date::TEXT, order_count, gross_minor, new_customer_count, returning_customer_count
		FROM business.spend_daily
		WHERE business_id=$1
		  AND bucket_date >= (CURRENT_DATE - $2::int)
		ORDER BY bucket_date DESC`, businessID, sinceDays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.SpendDaily{}
	for rows.Next() {
		var s business.SpendDaily
		if err := rows.Scan(&s.BusinessID, &s.BucketDate, &s.OrderCount, &s.GrossMinor, &s.NewCustomerCount, &s.ReturningCustomerCount); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) AddSpend(ctx context.Context, businessID, orderID string, amount int64) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.spend_records (id, business_id, order_id, amount_minor, currency, created_at)
		VALUES ('spend_' || md5(random()::text || clock_timestamp()::text || $2), $1,$2,$3,'VND',NOW())`, businessID, orderID, amount)
	return err
}

func (r *BusinessRepository) SpendSummary(ctx context.Context, businessID string) (int64, error) {
	var total int64
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor),0) FROM business.spend_records WHERE business_id=$1`, businessID).Scan(&total)
	return total, err
}

func (r *BusinessRepository) CreateProduct(ctx context.Context, p business.StoreProduct) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.store_products (id, store_id, business_id, name, description, price_minor, currency, category, scene, photo_asset_path, media_asset_id, available, sort_order, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		p.ID, p.StoreID, p.BusinessID, p.Name, p.Description, p.PriceMinor, p.Currency, p.Category, p.Scene, p.PhotoAssetPath, p.MediaAssetID, p.Available, p.SortOrder, p.CreatedAt, p.UpdatedAt)
	return err
}

func (r *BusinessRepository) GetProduct(ctx context.Context, productID string) (business.StoreProduct, error) {
	var p business.StoreProduct
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, store_id, business_id, name, description, price_minor, currency, category, scene, photo_asset_path, media_asset_id, available, sort_order, created_at, updated_at
		FROM business.store_products WHERE id=$1`, productID).Scan(
		&p.ID, &p.StoreID, &p.BusinessID, &p.Name, &p.Description, &p.PriceMinor, &p.Currency, &p.Category, &p.Scene, &p.PhotoAssetPath, &p.MediaAssetID, &p.Available, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.StoreProduct{}, errors.New("product not found")
	}
	return p, err
}

func (r *BusinessRepository) UpdateProduct(ctx context.Context, p business.StoreProduct) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE business.store_products SET
			name=$2, description=$3, price_minor=$4, currency=$5, category=$6, scene=$7, photo_asset_path=$8,
			media_asset_id=$9, available=$10, sort_order=$11, updated_at=$12
		WHERE id=$1`,
		p.ID, p.Name, p.Description, p.PriceMinor, p.Currency, p.Category, p.Scene, p.PhotoAssetPath, p.MediaAssetID, p.Available, p.SortOrder, p.UpdatedAt)
	return err
}

func (r *BusinessRepository) ListProducts(ctx context.Context, storeID string) ([]business.StoreProduct, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, store_id, business_id, name, description, price_minor, currency, category, scene, photo_asset_path, media_asset_id, available, sort_order, created_at, updated_at
		FROM business.store_products WHERE store_id=$1 ORDER BY sort_order, created_at`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.StoreProduct{}
	for rows.Next() {
		var p business.StoreProduct
		if err := rows.Scan(
			&p.ID, &p.StoreID, &p.BusinessID, &p.Name, &p.Description, &p.PriceMinor, &p.Currency, &p.Category, &p.Scene, &p.PhotoAssetPath, &p.MediaAssetID, &p.Available, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

var _ business.Repository = (*BusinessRepository)(nil)
