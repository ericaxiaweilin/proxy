package activity

import "sync"

// P1 ACT-01: Participation state — Master §13
type ParticipationState string
const (
	PartRequested   ParticipationState = "REQUESTED"
	PartConfirmed   ParticipationState = "CONFIRMED"
	PartWaitlisted  ParticipationState = "WAITLISTED"
	PartCancelled   ParticipationState = "CANCELLED"
	PartAttended    ParticipationState = "ATTENDED"
	PartNoShow      ParticipationState = "NO_SHOW"
)

type Participation struct {
	ActivityID string `json:"activityId"`
	UserID     string `json:"userId"`
	State      ParticipationState `json:"state"`
}

type ParticipationStore struct {
	mu   sync.Mutex
	data map[string]map[string]*Participation // activityID -> userID -> Participation
}

func NewParticipationStore() *ParticipationStore { return &ParticipationStore{data: make(map[string]map[string]*Participation)} }

func (s *ParticipationStore) Ensure(activityID, userID string, state ParticipationState) *Participation {
	s.mu.Lock(); defer s.mu.Unlock()
	if s.data[activityID]==nil { s.data[activityID]=make(map[string]*Participation)}
	p := &Participation{ActivityID: activityID, UserID: userID, State: state}
	s.data[activityID][userID]=p
	return p
}
func (s *ParticipationStore) Get(activityID, userID string) (*Participation, bool) {
	s.mu.Lock(); defer s.mu.Unlock()
	if m:=s.data[activityID]; m!=nil { p,ok:=m[userID]; return p,ok }
	return nil,false
}
func (s *ParticipationStore) UpdateState(activityID, userID string, state ParticipationState) bool {
	s.mu.Lock(); defer s.mu.Unlock()
	if m:=s.data[activityID]; m!=nil {
		if p,ok:=m[userID]; ok { p.State=state; return true }
	}
	return false
}
