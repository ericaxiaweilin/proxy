package runtime

var registeredActions = map[string]ActionDefinition{
	"open_surface":          {ActionID: "open_surface", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "tasks", "feed"}},
	"open_merchant":         {ActionID: "open_merchant", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "feed", "merchant"}},
	"open_map":              {ActionID: "open_map", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "map"}},
	"open_route":            {ActionID: "open_route", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "map"}},
	"apply_coupon":          {ActionID: "apply_coupon", RiskLevel: "MEDIUM", AllowedSurfaces: []string{"home", "coupon"}},
	"start_match":           {ActionID: "start_match", RiskLevel: "MEDIUM", AllowedSurfaces: []string{"home"}},
	"submit_choice":         {ActionID: "submit_choice", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "tasks"}},
	"confirm_reservation":   {ActionID: "confirm_reservation", RiskLevel: "HIGH", RequiresConfirmation: true, AllowedSurfaces: []string{"reservation"}},
	"dismiss":               {ActionID: "dismiss", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "inbox"}},
	"refresh":               {ActionID: "refresh", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "feed"}},
	"open_fastest_plan":     {ActionID: "open_fastest_plan", RiskLevel: "LOW", AllowedSurfaces: []string{"home"}},
	"open_registered_route": {ActionID: "open_registered_route", RiskLevel: "LOW", AllowedSurfaces: []string{"home", "me"}},
}

type ActionDefinition struct {
	ActionID             string   `json:"action_id"`
	RequiresConfirmation bool     `json:"requires_confirmation"`
	RiskLevel            string   `json:"risk_level"`
	AllowedSurfaces      []string `json:"allowed_surfaces"`
}

func IsRegisteredAction(id string) bool {
	_, ok := registeredActions[id]
	return ok
}

func GetAction(id string) (ActionDefinition, bool) {
	a, ok := registeredActions[id]
	return a, ok
}
