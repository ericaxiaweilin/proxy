package activity
import "testing"
func TestParticipation(t *testing.T){
 s:=NewParticipationStore()
 s.Ensure("a1","u1", PartWaitlisted)
 if p,ok:=s.Get("a1","u1"); !ok || p.State!=PartWaitlisted {t.Fatal()}
 s.UpdateState("a1","u1", PartCancelled)
 if p,_:=s.Get("a1","u1"); p.State!=PartCancelled {t.Fatal()}
}
