package scale
// P2 Scale & Growth — Master §26.3
// Creator Seed/Mission, Scene flywheel, Reco, Campaigns, AI video, Multi-city
type MissionType string
const (
	MissionSeedScene MissionType = "SEED_SCENE"
	MissionInvite    MissionType = "INVITE"
)
func NextCity(cur string) string {
	switch cur {
	case "hanoi": return "hcmc"
	case "hcmc": return "danang"
	default: return "hanoi"
	}
}
