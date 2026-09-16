package geo

import "testing"

// allPrecisions is ordered coarsest to finest. The order is asserted below, so
// inserting a new precision in the wrong place fails rather than silently
// reordering the ladder.
var allPrecisions = []Precision{
	PrecisionCity,
	PrecisionDistrict,
	PrecisionArea,
	PrecisionVenue,
	PrecisionExact,
}

var allLevels = []Level{
	LevelAggregate,
	LevelApproximate,
	LevelTaskContext,
	LevelMatched,
	LevelExecutionPrecise,
}

// TestPrecisionVocabularyIsClosed pins the canonical set. R15:6213-6223 names
// exactly these five; a sixth value means someone reintroduced a second
// vocabulary.
func TestPrecisionVocabularyIsClosed(t *testing.T) {
	if len(precisionRank) != len(allPrecisions) {
		t.Fatalf("precision vocabulary drifted: %d values declared, %d canonical", len(precisionRank), len(allPrecisions))
	}
	for _, p := range allPrecisions {
		if !p.Valid() {
			t.Errorf("%q must be a canonical precision", p)
		}
	}
	for _, junk := range []Precision{"", "city", "COARSE_AREA", "APPROX_POINT", "EXACT_POINT", "L2_TASK_CONTEXT", "UNKNOWN"} {
		if junk.Valid() {
			t.Errorf("%q must not be accepted as a canonical precision", junk)
		}
		if junk.Rank() != 0 {
			t.Errorf("%q must rank 0 so it cannot be mistaken for a coarse precision, got %d", junk, junk.Rank())
		}
	}
}

// TestLevelVocabularyIsClosed pins the authorisation axis. Chapter 17:449-454
// names exactly these five.
func TestLevelVocabularyIsClosed(t *testing.T) {
	if len(levelPrecision) != len(allLevels) {
		t.Fatalf("level vocabulary drifted: %d values declared, %d canonical", len(levelPrecision), len(allLevels))
	}
	for _, l := range allLevels {
		if !l.Valid() {
			t.Errorf("%q must be a canonical level", l)
		}
	}
	for _, junk := range []Level{"", "L1", "APPROXIMATE", "L5_EXECUTION", "UNKNOWN"} {
		if junk.Valid() {
			t.Errorf("%q must not be accepted as a canonical level", junk)
		}
	}
}

// TestPrecisionRankIsStrictlyIncreasing guards the ordering the whole package
// leans on. If two precisions ever tie, AtMost stops being a total clamp.
func TestPrecisionRankIsStrictlyIncreasing(t *testing.T) {
	prev := 0
	for _, p := range allPrecisions {
		r := p.Rank()
		if r <= prev {
			t.Fatalf("%q must rank above the previous precision: got %d after %d", p, r, prev)
		}
		prev = r
	}
}

// TestAtMostNeverEscalates is the core invariant. Clamping is the only
// operation allowed to change a precision on the way out to a reader, and it
// must never hand back something finer than either input.
func TestAtMostNeverEscalates(t *testing.T) {
	for _, p := range allPrecisions {
		for _, max := range allPrecisions {
			got := p.AtMost(max)
			if !got.Valid() {
				t.Fatalf("%q.AtMost(%q) produced a non-canonical precision %q", p, max, got)
			}
			if got.Rank() > p.Rank() {
				t.Errorf("%q.AtMost(%q) escalated to %q", p, max, got)
			}
			if got.Rank() > max.Rank() {
				t.Errorf("%q.AtMost(%q) exceeded the cap with %q", p, max, got)
			}
		}
	}
}

// TestAtMostDegradesToPrivacyOnGarbage: an unrecognised value must resolve to
// the cap, not to the unknown value. A typo has to lose precision, never leak it.
func TestAtMostDegradesToPrivacyOnGarbage(t *testing.T) {
	if got := Precision("VENUEE").AtMost(GlobalContextCap); got != GlobalContextCap {
		t.Errorf("unknown precision must degrade to the cap, got %q", got)
	}
	if got := PrecisionExact.AtMost(Precision("GARBAGE")); got != PrecisionExact {
		t.Errorf("unknown cap must leave the value alone, got %q", got)
	}
}

// TestGlobalContextCapMatchesR8GateE pins the ceiling to CITY. R8:98-101 caps
// global browsing context at CITY / COARSE_AREA; a venue or exact value reaching
// a browsing reader is the leak AC-MAP-32/33 forbids.
func TestGlobalContextCapMatchesR8GateE(t *testing.T) {
	if GlobalContextCap != PrecisionCity {
		t.Fatalf("R8 Gate E caps global context at CITY, got %q", GlobalContextCap)
	}
	for _, finer := range []Precision{PrecisionDistrict, PrecisionArea, PrecisionVenue, PrecisionExact} {
		if got := finer.AtMost(GlobalContextCap); got != PrecisionCity {
			t.Errorf("%q must be clamped to CITY for a global reader, got %q", finer, got)
		}
	}
	if got := PrecisionCity.AtMost(GlobalContextCap); got != PrecisionCity {
		t.Errorf("CITY is already at the cap and must pass through, got %q", got)
	}
}

// TestMappingRoundTripNeverLosesPrecision: if a caller legitimately holds
// precision p, routing p through the authorisation axis and back must not
// downgrade it. A failure here means some precision is unreachable and call
// sites will start guessing again.
func TestMappingRoundTripNeverLosesPrecision(t *testing.T) {
	for _, p := range allPrecisions {
		l, ok := LevelFor(p)
		if !ok {
			t.Fatalf("LevelFor(%q) must resolve", p)
		}
		back, ok := PrecisionFor(l)
		if !ok {
			t.Fatalf("PrecisionFor(%q) must resolve", l)
		}
		if back.Rank() < p.Rank() {
			t.Errorf("round trip lost precision: %q -> %q -> %q", p, l, back)
		}
	}
}

// TestLevelForIsTheLeastSufficientLevel: LevelFor must not demand more
// authority than the mapping requires, or every caller ends up over-granting.
func TestLevelForIsTheLeastSufficientLevel(t *testing.T) {
	for _, l := range allLevels {
		allowed, ok := PrecisionFor(l)
		if !ok {
			t.Fatalf("PrecisionFor(%q) must resolve", l)
		}
		needed, ok := LevelFor(allowed)
		if !ok {
			t.Fatalf("LevelFor(%q) must resolve", allowed)
		}
		if levelRank[needed] > levelRank[l] {
			t.Errorf("LevelFor(%q) demanded %q, more authority than %q holds", allowed, needed, l)
		}
	}
}

// TestMappingTableIsPinned is the deliberate tripwire on the one row set the
// spec does not settle. Chapter 17:502-577 says matching unlocks a venue and
// only execution unlocks a point; it is silent on whether task context (L2)
// unlocks a meeting point. We chose area-scale. Changing that choice has to be
// a conscious edit here, not a silent drift.
func TestMappingTableIsPinned(t *testing.T) {
	want := map[Level]Precision{
		LevelAggregate:        PrecisionCity,
		LevelApproximate:      PrecisionArea,
		LevelTaskContext:      PrecisionArea,
		LevelMatched:          PrecisionVenue,
		LevelExecutionPrecise: PrecisionExact,
	}
	for l, expected := range want {
		got, ok := PrecisionFor(l)
		if !ok {
			t.Fatalf("PrecisionFor(%q) must resolve", l)
		}
		if got != expected {
			t.Errorf("PrecisionFor(%q) = %q, pinned at %q — if this is intentional, update this test and the DECISION note in precision.go", l, got, expected)
		}
	}
	if len(want) != len(levelPrecision) {
		t.Errorf("a level was added or removed without updating this pin")
	}
}

// TestUnlockLadderMatchesChapter17: venue must not be reachable before
// matching, and an exact point must be reachable only at execution. This is the
// product rule, not a formatting detail.
func TestUnlockLadderMatchesChapter17(t *testing.T) {
	for _, l := range []Level{LevelAggregate, LevelApproximate, LevelTaskContext} {
		allowed, _ := PrecisionFor(l)
		if allowed.Rank() >= PrecisionVenue.Rank() {
			t.Errorf("%q must not unlock a venue, it permits %q", l, allowed)
		}
	}
	if allowed, _ := PrecisionFor(LevelMatched); allowed != PrecisionVenue {
		t.Errorf("matching is what unlocks a venue, %q permits %q", LevelMatched, allowed)
	}
	for _, l := range []Level{LevelAggregate, LevelApproximate, LevelTaskContext, LevelMatched} {
		allowed, _ := PrecisionFor(l)
		if allowed == PrecisionExact {
			t.Errorf("%q must not unlock an exact point", l)
		}
	}
	if allowed, _ := PrecisionFor(LevelExecutionPrecise); allowed != PrecisionExact {
		t.Errorf("%q must permit an exact point, got %q", LevelExecutionPrecise, allowed)
	}
}
