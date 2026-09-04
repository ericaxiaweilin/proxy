CREATE TABLE IF NOT EXISTS identity.account_preferences (
  user_account_id TEXT PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  social_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_on_merchant BOOLEAN NOT NULL DEFAULT FALSE,
  show_on_profile BOOLEAN NOT NULL DEFAULT FALSE,
  show_influence BOOLEAN NOT NULL DEFAULT FALSE,
  collaboration_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  collaboration_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  collaboration_rate TEXT NOT NULL DEFAULT '',
  collaboration_contact TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(social_accounts) = 'array'),
  CHECK (jsonb_typeof(collaboration_types) = 'array'),
  CHECK (char_length(collaboration_rate) <= 200),
  CHECK (char_length(collaboration_contact) <= 200)
);
