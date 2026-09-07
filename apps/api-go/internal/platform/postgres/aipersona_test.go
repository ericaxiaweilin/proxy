package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
)

func TestAIPersonaPostgresPersistsPersonaAndReconsent(t *testing.T) {
	pool := requireTestPool(t)
	ctx := context.Background()
	suffix := time.Now().UnixNano()
	personaID := fmt.Sprintf("aip_pg_%d", suffix)
	ownerID := fmt.Sprintf("owner_pg_%d", suffix)
	subjectID := fmt.Sprintf("subject_pg_%d", suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ai.likeness_consents WHERE persona_id=$1`, personaID)
		_, _ = pool.Exec(ctx, `DELETE FROM ai.ai_personas WHERE id=$1`, personaID)
	})

	repo := NewAIPersonaRepository(pool)
	clock := time.Date(2026, 9, 7, 10, 0, 0, 0, time.UTC)
	svc := aipersona.NewService(repo, "terms-1.1")
	svc.SetNowFunc(func() time.Time { return clock })

	created, err := svc.CreatePersona(ctx, aipersona.Persona{
		ID: personaID, OwnerID: ownerID, DisplayName: "Mai", PersonaType: aipersona.PersonaTypePlatformAI,
	})
	if err != nil {
		t.Fatalf("create platform AI persona: %v", err)
	}
	if created.PersonaType != aipersona.PersonaTypePlatformAI {
		t.Fatalf("persona type=%s", created.PersonaType)
	}

	// A fresh service instance proves the account is repository-backed rather
	// than retained in process memory.
	restarted := aipersona.NewService(NewAIPersonaRepository(pool), "terms-1.1")
	got, err := restarted.GetPersona(ctx, personaID)
	if err != nil || got.DisplayName != "Mai" {
		t.Fatalf("read after restart: persona=%+v err=%v", got, err)
	}

	first, err := svc.GrantConsent(ctx, personaID, subjectID, aipersona.ConsentVisual, nil)
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if err := svc.RevokeConsent(ctx, first.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	clock = clock.Add(time.Second)
	second, err := svc.GrantConsent(ctx, personaID, subjectID, aipersona.ConsentVisual, nil)
	if err != nil {
		t.Fatalf("re-consent under same terms: %v", err)
	}
	if second.ID == first.ID {
		t.Fatal("re-consent must append a new audit row")
	}
	live, err := svc.HasLiveConsent(ctx, personaID, subjectID)
	if err != nil || live == nil || live.ID != second.ID {
		t.Fatalf("latest live consent=%+v err=%v", live, err)
	}
}
