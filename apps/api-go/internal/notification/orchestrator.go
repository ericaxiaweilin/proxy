package notification
import "sync"
// P1 MSG-01: Notification orchestration + idempotency — Master §22
type Event struct { ID string; Type string; Recipient string }
type Orchestrator struct { mu sync.Mutex; seen map[string]bool }
func NewOrchestrator() *Orchestrator { return &Orchestrator{seen: map[string]bool{}} }
func (o *Orchestrator) ShouldNotify(e Event) bool {
 o.mu.Lock(); defer o.mu.Unlock()
 key:=e.ID+":"+e.Type+":"+e.Recipient
 if o.seen[key] {return false}
 o.seen[key]=true
 return true
}
