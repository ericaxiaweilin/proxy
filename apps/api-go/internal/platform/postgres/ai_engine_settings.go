package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/identity"
)

func (r *IdentityRepository) GetAiEngineSettings(ctx context.Context, userID string) (identity.AiEngineSettings, error) {
	var s identity.AiEngineSettings
	var history, topics []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT user_account_id, paused,
		       chat_tone, chat_reply_length, chat_emoji, chat_rhythm, chat_permission,
		       image_scene, image_pose, image_camera, image_prompt, image_prompt_history,
		       image_aspect, image_quality, image_vendor_pref, image_model_pref,
		       post_pace, post_topics, post_permission, version
		FROM identity.ai_engine_settings
		WHERE user_account_id = $1
	`, userID).Scan(
		&s.UserAccountID, &s.Paused,
		&s.ChatTone, &s.ChatReplyLength, &s.ChatEmoji, &s.ChatRhythm, &s.ChatPermission,
		&s.ImageScene, &s.ImagePose, &s.ImageCamera, &s.ImagePrompt, &history,
		&s.ImageAspect, &s.ImageQuality, &s.ImageVendorPref, &s.ImageModelPref,
		&s.PostPace, &topics, &s.PostPermission, &s.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.AiEngineSettings{}, identity.ErrAiEngineSettingsNotFound
	}
	if err != nil {
		return identity.AiEngineSettings{}, err
	}
	if len(history) > 0 {
		if err = json.Unmarshal(history, &s.ImagePromptHistory); err != nil {
			return identity.AiEngineSettings{}, err
		}
	}
	if s.ImagePromptHistory == nil {
		s.ImagePromptHistory = []string{}
	}
	if len(topics) > 0 {
		if err = json.Unmarshal(topics, &s.PostTopics); err != nil {
			return identity.AiEngineSettings{}, err
		}
	}
	if s.PostTopics == nil {
		s.PostTopics = []string{}
	}
	return s, nil
}

func (r *IdentityRepository) UpsertAiEngineSettings(ctx context.Context, s identity.AiEngineSettings) (identity.AiEngineSettings, error) {
	history, err := json.Marshal(s.ImagePromptHistory)
	if err != nil {
		return identity.AiEngineSettings{}, err
	}
	if s.ImagePromptHistory == nil {
		history = []byte("[]")
	}
	topics, err := json.Marshal(s.PostTopics)
	if err != nil {
		return identity.AiEngineSettings{}, err
	}
	if s.PostTopics == nil {
		topics = []byte("[]")
	}
	err = queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO identity.ai_engine_settings (
			user_account_id, paused,
			chat_tone, chat_reply_length, chat_emoji, chat_rhythm, chat_permission,
			image_scene, image_pose, image_camera, image_prompt, image_prompt_history,
			image_aspect, image_quality, image_vendor_pref, image_model_pref,
			post_pace, post_topics, post_permission
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (user_account_id) DO UPDATE SET
			paused = EXCLUDED.paused,
			chat_tone = EXCLUDED.chat_tone,
			chat_reply_length = EXCLUDED.chat_reply_length,
			chat_emoji = EXCLUDED.chat_emoji,
			chat_rhythm = EXCLUDED.chat_rhythm,
			chat_permission = EXCLUDED.chat_permission,
			image_scene = EXCLUDED.image_scene,
			image_pose = EXCLUDED.image_pose,
			image_camera = EXCLUDED.image_camera,
			image_prompt = EXCLUDED.image_prompt,
			image_prompt_history = EXCLUDED.image_prompt_history,
			image_aspect = EXCLUDED.image_aspect,
			image_quality = EXCLUDED.image_quality,
			image_vendor_pref = EXCLUDED.image_vendor_pref,
			image_model_pref = EXCLUDED.image_model_pref,
			post_pace = EXCLUDED.post_pace,
			post_topics = EXCLUDED.post_topics,
			post_permission = EXCLUDED.post_permission,
			version = identity.ai_engine_settings.version + 1,
			updated_at = now()
		RETURNING version
	`,
		s.UserAccountID, s.Paused,
		s.ChatTone, s.ChatReplyLength, s.ChatEmoji, s.ChatRhythm, s.ChatPermission,
		s.ImageScene, s.ImagePose, s.ImageCamera, s.ImagePrompt, history,
		s.ImageAspect, s.ImageQuality, s.ImageVendorPref, s.ImageModelPref,
		s.PostPace, topics, s.PostPermission,
	).Scan(&s.Version)
	return s, err
}

func (r *IdentityRepository) AddAiTokens(ctx context.Context, userID, period string, prompt, output int) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO identity.ai_token_usage (user_account_id, period, prompt_tokens, output_tokens)
		VALUES ($1, $2, GREATEST($3, 0), GREATEST($4, 0))
		ON CONFLICT (user_account_id, period) DO UPDATE SET
			prompt_tokens = identity.ai_token_usage.prompt_tokens + GREATEST($3, 0),
			output_tokens = identity.ai_token_usage.output_tokens + GREATEST($4, 0),
			updated_at = now()
	`, userID, period, prompt, output)
	return err
}

func (r *IdentityRepository) GetAiTokens(ctx context.Context, userID, period string) (identity.AiTokenUsage, error) {
	var u identity.AiTokenUsage
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT user_account_id, period, prompt_tokens, output_tokens
		FROM identity.ai_token_usage
		WHERE user_account_id = $1 AND period = $2
	`, userID, period).Scan(&u.UserAccountID, &u.Period, &u.PromptTokens, &u.OutputTokens)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.AiTokenUsage{UserAccountID: userID, Period: period}, nil
	}
	if err != nil {
		return identity.AiTokenUsage{}, err
	}
	return u, nil
}

var (
	_ identity.AiEngineSettingsRepository = (*IdentityRepository)(nil)
	_ identity.AiTokenUsageRepository     = (*IdentityRepository)(nil)
)
