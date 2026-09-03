package relationship

// P1 REL-01: Friendship 双向 Truth vs CRM 私有 metadata 分离 — Master §9.3
type Friendship struct {
	UserA string `json:"userA"`
	UserB string `json:"userB"`
	State string `json:"state"` // PENDING, FRIEND, BLOCKED
}
type CRMMetadata struct {
	OwnerID string `json:"ownerId"`
	TargetID string `json:"targetId"`
	Segment string `json:"segment"` // core, follow-up
	Tags []string `json:"tags"`
	Note string `json:"note"`
	Source string `json:"source"`
}
func IsFriendship(f Friendship) bool { return f.State=="FRIEND" }
func CanCRMModifyFriendship(c CRMMetadata) bool { return false } // CRM 永不反向改好友状态
