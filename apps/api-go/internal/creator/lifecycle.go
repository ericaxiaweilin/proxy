package creator

// P0 CREATOR-01: Creator Program state — Master §14, AC via eligibility
type State string
const (
	StateCandidate    State = "CANDIDATE"
	StateSeed         State = "SEED"
	StateVerified     State = "VERIFIED"
	StateLocal        State = "LOCAL"
	StateHostPro      State = "HOST_PRO"
	StatePartner      State = "PARTNER"
	StateSuspended    State = "SUSPENDED"
)

func CanTransition(from, to State) bool {
	allowed := map[State][]State{
		StateCandidate: {StateSeed, StateSuspended},
		StateSeed: {StateVerified, StateSuspended},
		StateVerified: {StateLocal, StateSuspended},
		StateLocal: {StateHostPro, StateSuspended},
		StateHostPro: {StatePartner, StateSuspended},
		StatePartner: {StateSuspended},
		StateSuspended: {StateCandidate},
	}
	for _, v := range allowed[from] {
		if v==to {return true}
	}
	return false
}
