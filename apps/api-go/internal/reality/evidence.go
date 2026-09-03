package reality

// P0 SCENE-01: VisitEvidence — Master §10.3, AC-09
type EvidenceType string
const (
	EvidenceVerifiedEventAttendance EvidenceType = "VERIFIED_EVENT_ATTENDANCE"
	EvidenceMerchantScan            EvidenceType = "MERCHANT_SCAN"
	EvidenceOrderCheckin            EvidenceType = "ORDER_CHECKIN"
	EvidencePostGeoDeclaration      EvidenceType = "POST_GEO_DECLARATION"
	EvidenceUserDeclared            EvidenceType = "USER_DECLARED"
	EvidenceAIGenerated             EvidenceType = "AI_GENERATED"
)

func Confidence(e EvidenceType) int {
	switch e {
	case EvidenceVerifiedEventAttendance, EvidenceMerchantScan, EvidenceOrderCheckin:
		return 3 // 高
	case EvidencePostGeoDeclaration:
		return 2 // 中
	case EvidenceUserDeclared:
		return 1 // 低
	case EvidenceAIGenerated:
		return 0 // 无 authority
	default:
		return 0
	}
}

func CanEstablishVisit(e EvidenceType) bool {
	return e != EvidenceAIGenerated
}

func RequiresModeration(e EvidenceType) bool {
	return e == EvidenceUserDeclared || e == EvidencePostGeoDeclaration
}
