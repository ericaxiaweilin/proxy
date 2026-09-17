// Package conversation — Lotus v1 Dialog/Convo/Folder/Pin/ReadCursor
// Engineering Spec v1 §1/§3/§7/§8
package conversation

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

// Dialog 是 v1 的对话聚合，替代 v0 Conversation 的语义边界。
// 硬规则：邀约/活动/订单不是 Dialog 类型，进入聊天时为 Message.proxy_object。
type Dialog struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // dm | group | official
	Title     string    `json:"title"`
	AvatarRef string    `json:"avatarRef,omitempty"`
	MemberIDs []string  `json:"memberIds"`
	FolderIDs []string  `json:"folderIds,omitempty"`
	IsPinned  bool      `json:"isPinned"`
	IsMuted   bool      `json:"isMuted"`
	IsMacKe   bool      `json:"isMacKe"`
	LatestSeq int64     `json:"latestSeq"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Convo 是 Message Branch，不是第二套 Group。必须能找到 seedMessageId。
type Convo struct {
	ID                     string    `json:"id"`
	ParentDialogID         string    `json:"parentDialogId"`
	SeedMessageID          string    `json:"seedMessageId"`
	Title                  string    `json:"title"`
	ParticipantIDs         []string  `json:"participantIds"`
	ExternalParticipantIDs []string  `json:"externalParticipantIds,omitempty"`
	LatestSeq              int64     `json:"latestSeq"`
	CreatedAt              time.Time `json:"createdAt"`
}

// Folder 只做 Dialog 分类，不复制消息，不存 unread。
type Folder struct {
	ID          string    `json:"id"`
	OwnerUserID string    `json:"ownerUserId"`
	Name        string    `json:"name"`
	DialogIDs   []string  `json:"dialogIds"`
	Order       int       `json:"order"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Pin 支持 24h/7d/活动结束/永久
type Pin struct {
	ID        string     `json:"id"`
	DialogID  string     `json:"dialogId"`
	MessageID string     `json:"messageId"`
	PinnedBy  string     `json:"pinnedBy"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// ReadCursor 避免遍历 Message 表算 unread
type ReadCursor struct {
	UserID      string `json:"userId"`
	DialogID    string `json:"dialogId"`
	LastReadSeq int64  `json:"lastReadSeq"`
	// UNREAD-PIPELINE-001: 最后已读时间。Seq 在 PG 落库时不持久化（messages
	// 表没有 seq 列），全零 Seq 的消息只能按时间判定 —— 没有这个字段，
	// PG 上的未读数永远算不对。
	LastReadAt time.Time `json:"lastReadAt"`
}

type ConvoReadCursor struct {
	UserID      string `json:"userId"`
	ConvoID     string `json:"convoId"`
	LastReadSeq int64  `json:"lastReadSeq"`
}

var (
	ErrDialogNotFound = errors.New("dialog not found")
	ErrConvoNotFound  = errors.New("convo not found")
	ErrFolderNotFound = errors.New("folder not found")
	ErrPinNotFound    = errors.New("pin not found")
)

// DialogRepository — v1 持久化边界，内存与 PG 两套实现
type DialogRepository interface {
	CreateDialog(ctx context.Context, d Dialog) error
	GetDialog(ctx context.Context, id string) (Dialog, error)
	ListDialogs(ctx context.Context, userID string) ([]Dialog, error)
	UpdateDialog(ctx context.Context, d Dialog) error
	CreateConvo(ctx context.Context, c Convo) error
	GetConvo(ctx context.Context, id string) (Convo, error)
	ListConvosByDialog(ctx context.Context, dialogID string) ([]Convo, error)
	CreateFolder(ctx context.Context, f Folder) error
	ListFolders(ctx context.Context, ownerUserID string) ([]Folder, error)
	UpdateFolder(ctx context.Context, f Folder) error
	UpsertReadCursor(ctx context.Context, cur ReadCursor) error
	GetReadCursor(ctx context.Context, userID, dialogID string) (ReadCursor, error)
}

// MemoryDialogRepository
type MemoryDialogRepository struct {
	mu       sync.Mutex
	dialogs  map[string]Dialog
	convos   map[string]Convo
	folders  map[string]Folder
	cursors  map[string]ReadCursor // key: userID|dialogID
	pins     map[string]Pin
}

func NewMemoryDialogRepository() *MemoryDialogRepository {
	return &MemoryDialogRepository{
		dialogs: make(map[string]Dialog),
		convos:  make(map[string]Convo),
		folders: make(map[string]Folder),
		cursors: make(map[string]ReadCursor),
		pins:    make(map[string]Pin),
	}
}

func (r *MemoryDialogRepository) CreateDialog(_ context.Context, d Dialog) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.dialogs[d.ID]; ok {
		return errors.New("dialog exists")
	}
	r.dialogs[d.ID] = d
	return nil
}

func (r *MemoryDialogRepository) GetDialog(_ context.Context, id string) (Dialog, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.dialogs[id]
	if !ok {
		return Dialog{}, ErrDialogNotFound
	}
	return d, nil
}

func (r *MemoryDialogRepository) ListDialogs(_ context.Context, userID string) ([]Dialog, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Dialog
	for _, d := range r.dialogs {
		for _, m := range d.MemberIDs {
			if m == userID {
				out = append(out, d)
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (r *MemoryDialogRepository) UpdateDialog(_ context.Context, d Dialog) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.dialogs[d.ID]; !ok {
		return ErrDialogNotFound
	}
	r.dialogs[d.ID] = d
	return nil
}

func (r *MemoryDialogRepository) CreateConvo(_ context.Context, c Convo) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.convos[c.ID]; ok {
		return errors.New("convo exists")
	}
	r.convos[c.ID] = c
	return nil
}

func (r *MemoryDialogRepository) GetConvo(_ context.Context, id string) (Convo, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.convos[id]
	if !ok {
		return Convo{}, ErrConvoNotFound
	}
	return c, nil
}

func (r *MemoryDialogRepository) ListConvosByDialog(_ context.Context, dialogID string) ([]Convo, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Convo
	for _, c := range r.convos {
		if c.ParentDialogID == dialogID {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (r *MemoryDialogRepository) CreateFolder(_ context.Context, f Folder) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.folders[f.ID]; ok {
		return errors.New("folder exists")
	}
	r.folders[f.ID] = f
	return nil
}

func (r *MemoryDialogRepository) ListFolders(_ context.Context, ownerUserID string) ([]Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Folder
	for _, f := range r.folders {
		if f.OwnerUserID == ownerUserID {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Order < out[j].Order })
	return out, nil
}

func (r *MemoryDialogRepository) UpdateFolder(_ context.Context, f Folder) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.folders[f.ID]; !ok {
		return ErrFolderNotFound
	}
	r.folders[f.ID] = f
	return nil
}

func (r *MemoryDialogRepository) UpsertReadCursor(_ context.Context, cur ReadCursor) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cursors[cur.UserID+"|"+cur.DialogID] = cur
	return nil
}

func (r *MemoryDialogRepository) GetReadCursor(_ context.Context, userID, dialogID string) (ReadCursor, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.cursors[userID+"|"+dialogID]
	if !ok {
		return ReadCursor{UserID: userID, DialogID: dialogID, LastReadSeq: 0}, nil
	}
	return c, nil
}

var _ DialogRepository = (*MemoryDialogRepository)(nil)
