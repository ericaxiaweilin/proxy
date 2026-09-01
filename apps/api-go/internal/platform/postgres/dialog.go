package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/conversation"
)

type DialogRepository struct {
	pool *pgxpool.Pool
}

func NewDialogRepository(pool *pgxpool.Pool) *DialogRepository {
	return &DialogRepository{pool: pool}
}

func (r *DialogRepository) CreateDialog(ctx context.Context, d conversation.Dialog) error {
	memberIDs, _ := json.Marshal(d.MemberIDs)
	folderIDs, _ := json.Marshal(d.FolderIDs)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.dialogs (id, type, title, avatar_ref, member_ids, folder_ids, is_pinned, is_muted, is_macke, latest_seq, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		d.ID, d.Type, d.Title, d.AvatarRef, memberIDs, folderIDs, d.IsPinned, d.IsMuted, d.IsMacKe, d.LatestSeq, d.CreatedAt, d.UpdatedAt,
	)
	return err
}

func (r *DialogRepository) GetDialog(ctx context.Context, id string) (conversation.Dialog, error) {
	var d conversation.Dialog
	var memberIDs, folderIDs []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, type, title, avatar_ref, member_ids, folder_ids, is_pinned, is_muted, is_macke, latest_seq, created_at, updated_at
		FROM conversation.dialogs WHERE id=$1`, id).Scan(
		&d.ID, &d.Type, &d.Title, &d.AvatarRef, &memberIDs, &folderIDs, &d.IsPinned, &d.IsMuted, &d.IsMacKe, &d.LatestSeq, &d.CreatedAt, &d.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversation.Dialog{}, conversation.ErrDialogNotFound
	}
	if err != nil {
		return conversation.Dialog{}, err
	}
	_ = json.Unmarshal(memberIDs, &d.MemberIDs)
	_ = json.Unmarshal(folderIDs, &d.FolderIDs)
	return d, nil
}

func (r *DialogRepository) ListDialogs(ctx context.Context, userID string) ([]conversation.Dialog, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, type, title, avatar_ref, member_ids, folder_ids, is_pinned, is_muted, is_macke, latest_seq, created_at, updated_at
		FROM conversation.dialogs WHERE member_ids @> $1::jsonb ORDER BY updated_at DESC`, `["`+userID+`"]`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []conversation.Dialog
	for rows.Next() {
		var d conversation.Dialog
		var memberIDs, folderIDs []byte
		if err := rows.Scan(&d.ID, &d.Type, &d.Title, &d.AvatarRef, &memberIDs, &folderIDs, &d.IsPinned, &d.IsMuted, &d.IsMacKe, &d.LatestSeq, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(memberIDs, &d.MemberIDs)
		_ = json.Unmarshal(folderIDs, &d.FolderIDs)
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *DialogRepository) UpdateDialog(ctx context.Context, d conversation.Dialog) error {
	memberIDs, _ := json.Marshal(d.MemberIDs)
	folderIDs, _ := json.Marshal(d.FolderIDs)
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE conversation.dialogs SET type=$1, title=$2, avatar_ref=$3, member_ids=$4, folder_ids=$5, is_pinned=$6, is_muted=$7, is_macke=$8, latest_seq=$9, updated_at=$10 WHERE id=$11`,
		d.Type, d.Title, d.AvatarRef, memberIDs, folderIDs, d.IsPinned, d.IsMuted, d.IsMacKe, d.LatestSeq, d.UpdatedAt, d.ID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return conversation.ErrDialogNotFound
	}
	return nil
}

func (r *DialogRepository) CreateConvo(ctx context.Context, c conversation.Convo) error {
	pIDs, _ := json.Marshal(c.ParticipantIDs)
	ePIDs, _ := json.Marshal(c.ExternalParticipantIDs)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.convos (id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		c.ID, c.ParentDialogID, c.SeedMessageID, c.Title, pIDs, ePIDs, c.LatestSeq, c.CreatedAt,
	)
	return err
}

func (r *DialogRepository) GetConvo(ctx context.Context, id string) (conversation.Convo, error) {
	var c conversation.Convo
	var pIDs, ePIDs []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at
		FROM conversation.convos WHERE id=$1`, id).Scan(
		&c.ID, &c.ParentDialogID, &c.SeedMessageID, &c.Title, &pIDs, &ePIDs, &c.LatestSeq, &c.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversation.Convo{}, conversation.ErrConvoNotFound
	}
	if err != nil {
		return conversation.Convo{}, err
	}
	_ = json.Unmarshal(pIDs, &c.ParticipantIDs)
	_ = json.Unmarshal(ePIDs, &c.ExternalParticipantIDs)
	return c, nil
}

func (r *DialogRepository) ListConvosByDialog(ctx context.Context, dialogID string) ([]conversation.Convo, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at
		FROM conversation.convos WHERE parent_dialog_id=$1 ORDER BY created_at`, dialogID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []conversation.Convo
	for rows.Next() {
		var c conversation.Convo
		var pIDs, ePIDs []byte
		if err := rows.Scan(&c.ID, &c.ParentDialogID, &c.SeedMessageID, &c.Title, &pIDs, &ePIDs, &c.LatestSeq, &c.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(pIDs, &c.ParticipantIDs)
		_ = json.Unmarshal(ePIDs, &c.ExternalParticipantIDs)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *DialogRepository) CreateFolder(ctx context.Context, f conversation.Folder) error {
	ids, _ := json.Marshal(f.DialogIDs)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.folders (id, owner_user_id, name, dialog_ids, ord, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, f.ID, f.OwnerUserID, f.Name, ids, f.Order, f.CreatedAt,
	)
	return err
}

func (r *DialogRepository) ListFolders(ctx context.Context, ownerUserID string) ([]conversation.Folder, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, owner_user_id, name, dialog_ids, ord, created_at FROM conversation.folders WHERE owner_user_id=$1 ORDER BY ord`, ownerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []conversation.Folder
	for rows.Next() {
		var f conversation.Folder
		var ids []byte
		if err := rows.Scan(&f.ID, &f.OwnerUserID, &f.Name, &ids, &f.Order, &f.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(ids, &f.DialogIDs)
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *DialogRepository) UpdateFolder(ctx context.Context, f conversation.Folder) error {
	ids, _ := json.Marshal(f.DialogIDs)
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE conversation.folders SET name=$1, dialog_ids=$2, ord=$3 WHERE id=$4`, f.Name, ids, f.Order, f.ID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return conversation.ErrFolderNotFound
	}
	return nil
}

func (r *DialogRepository) UpsertReadCursor(ctx context.Context, cur conversation.ReadCursor) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.read_cursors (user_id, dialog_id, last_read_seq)
		VALUES ($1,$2,$3) ON CONFLICT (user_id, dialog_id) DO UPDATE SET last_read_seq=EXCLUDED.last_read_seq`,
		cur.UserID, cur.DialogID, cur.LastReadSeq,
	)
	return err
}

func (r *DialogRepository) GetReadCursor(ctx context.Context, userID, dialogID string) (conversation.ReadCursor, error) {
	var cur conversation.ReadCursor
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT user_id, dialog_id, last_read_seq FROM conversation.read_cursors WHERE user_id=$1 AND dialog_id=$2`, userID, dialogID).Scan(
		&cur.UserID, &cur.DialogID, &cur.LastReadSeq,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversation.ReadCursor{UserID: userID, DialogID: dialogID, LastReadSeq: 0}, nil
	}
	return cur, err
}

var _ conversation.DialogRepository = (*DialogRepository)(nil)
