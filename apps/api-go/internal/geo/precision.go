// Package geo is the single source of truth for location precision on the
// server.
//
// # Why this package exists
//
// Before it, the repository carried four unreconciled precision vocabularies
// with no mapping between them:
//
//	Chapter 17:449-454   L0_AGGREGATE .. L4_EXECUTION_PRECISE  (authorisation)
//	Chapter 17:675-681   COUNTRY / CITY / DISTRICT / AREA / APPROX_POINT / EXACT_POINT
//	R15:6213-6223        GeoPrecision = CITY | DISTRICT | AREA | VENUE | EXACT
//	R8:101 / Ch21H:95    CITY | COARSE_AREA                     (global cap)
//
// Every privacy gate in the product ("Gate E", INV-SEC-06, AC-MAP-32/33) is a
// statement about precision. With four vocabularies and no table, "is this
// precise enough to expose?" was not answerable in code — each call site had to
// guess, and they guessed differently.
//
// The two axes are deliberately kept separate, because they answer different
// questions:
//
//	Precision  "how exact is this value?"      — a property of the data
//	Level      "how much authorisation do I hold?" — a property of the grant
//
// They are NOT isomorphic. Several levels permit the same precision, and one
// precision can be reached from more than one level. Do not add a 1:1
// assumption; use PrecisionFor / LevelFor and keep the invariants in
// precision_test.go green.
package geo

// Precision is the representation axis: how exact a location value is.
// Canonical values come from R15:6213-6223.
type Precision string

const (
	// PrecisionCity is a city or market. Browsing a profile without a task
	// stays here (R8 Gate E).
	PrecisionCity Precision = "CITY"
	// PrecisionDistrict is an administrative district.
	PrecisionDistrict Precision = "DISTRICT"
	// PrecisionArea is a neighbourhood-scale area. This is the granularity of
	// "COARSE_AREA" in R8:101 / Ch21H:95.
	PrecisionArea Precision = "AREA"
	// PrecisionVenue is a named place — a store, cafe, or scene. Venue
	// coordinates are public and are not a person's location.
	PrecisionVenue Precision = "VENUE"
	// PrecisionExact is a precise point. It is only ever produced under an
	// L4_EXECUTION_PRECISE grant and must never be persisted as social context.
	PrecisionExact Precision = "EXACT"
)

// GlobalContextCap is the ceiling for any location that becomes global browsing
// context (feed, nearby, profile). R8:98-101:
//
//	全局 Local Context 最多到：CITY / COARSE_AREA
//
// Anything finer must be purpose-bound and released by a task or order grant
// (R8:114). Clamp with AtMost before returning a value to a browsing reader.
const GlobalContextCap = PrecisionCity

// Level is the authorisation axis: how much location authority a grant carries.
// Canonical values come from Chapter 17:449-454.
type Level string

const (
	// LevelAggregate exposes aggregated cells only. No per-entity point is
	// permitted at this level.
	LevelAggregate Level = "L0_AGGREGATE"
	// LevelApproximate exposes approximate area, never a point.
	LevelApproximate Level = "L1_APPROXIMATE"
	// LevelTaskContext is task-scoped context. Still area-scale.
	LevelTaskContext Level = "L2_TASK_CONTEXT"
	// LevelMatched is released when a task is matched to an agent. This is
	// where venue unlocks (Chapter 17:502-577).
	LevelMatched Level = "L3_MATCHED"
	// LevelExecutionPrecise is execution-time authority and the only level that
	// permits an exact point.
	LevelExecutionPrecise Level = "L4_EXECUTION_PRECISE"
)

// precisionRank orders precisions from coarsest (1) to finest (5). Rank 0 is
// reserved for invalid values so that an unrecognised string can never be
// mistaken for a valid, coarse precision.
var precisionRank = map[Precision]int{
	PrecisionCity:     1,
	PrecisionDistrict: 2,
	PrecisionArea:     3,
	PrecisionVenue:    4,
	PrecisionExact:    5,
}

// Valid reports whether p is a canonical precision.
func (p Precision) Valid() bool {
	_, ok := precisionRank[p]
	return ok
}

// Rank returns the ordinal rank of p, or 0 if p is not canonical. Higher means
// finer. A zero rank must be treated as a failure, never as "coarser than CITY".
func (p Precision) Rank() int {
	return precisionRank[p]
}

// AtMost clamps p to at most max. It never escalates: if p is already coarser
// than max, p is returned unchanged. If either value is not canonical, the
// coarser of the two is returned, so a typo degrades to privacy rather than
// leaking precision.
func (p Precision) AtMost(max Precision) Precision {
	if !p.Valid() {
		return max
	}
	if !max.Valid() {
		return p
	}
	if p.Rank() <= max.Rank() {
		return p
	}
	return max
}

// levelPrecision is the missing mapping table: the finest precision each
// authorisation level permits.
//
// The rationale for each row, and the spec it comes from:
//
//	L0_AGGREGATE          CITY   aggregate cells only; a cell has a market, no point
//	L1_APPROXIMATE        AREA   approximate area, explicitly not a point (Ch17:1648)
//	L2_TASK_CONTEXT       AREA   task context stays area-scale until matched
//	L3_MATCHED            VENUE  matching is what unlocks a venue (Ch17:502-577)
//	L4_EXECUTION_PRECISE  EXACT  only execution-time authority yields a point
//
// DECISION NEEDED: rows L1/L2 both resolve to AREA, and the four source
// vocabularies do not agree on whether L2 should unlock a meeting point. The
// current choice keeps L2 area-scale, which is the conservative reading of
// Ch17:1648-1660 ("Available Now 可以用 approx location"). If the commander
// wants L2 to unlock a meeting point, change this table and the tests in
// precision_test.go together — the mapping is pinned there on purpose.
var levelPrecision = map[Level]Precision{
	LevelAggregate:        PrecisionCity,
	LevelApproximate:      PrecisionArea,
	LevelTaskContext:      PrecisionArea,
	LevelMatched:          PrecisionVenue,
	LevelExecutionPrecise: PrecisionExact,
}

// Valid reports whether l is a canonical authorisation level.
func (l Level) Valid() bool {
	_, ok := levelPrecision[l]
	return ok
}

// PrecisionFor returns the finest precision that level l permits. It returns
// false for an unknown level, so callers must handle the failure explicitly
// rather than silently receiving a permissive default.
func PrecisionFor(l Level) (Precision, bool) {
	p, ok := levelPrecision[l]
	return p, ok
}

// LevelFor returns the least authorisation level that is sufficient to expose
// precision p. It returns false for an unknown precision.
//
// Least is deliberate: L3_MATCHED and L4_EXECUTION_PRECISE are both "sufficient"
// for a venue, but requiring the least one keeps the check as tight as the
// mapping allows without escalating the authority a caller must hold.
func LevelFor(p Precision) (Level, bool) {
	if !p.Valid() {
		return "", false
	}
	best := Level("")
	bestRank := 0
	for l, allowed := range levelPrecision {
		if p.Rank() > allowed.Rank() {
			continue
		}
		r := levelRank[l]
		if best == "" || r < bestRank {
			best, bestRank = l, r
		}
	}
	if best == "" {
		return "", false
	}
	return best, true
}

// levelRank orders authorisation levels from least (1) to most (5) authority.
var levelRank = map[Level]int{
	LevelAggregate:        1,
	LevelApproximate:      2,
	LevelTaskContext:      3,
	LevelMatched:          4,
	LevelExecutionPrecise: 5,
}
