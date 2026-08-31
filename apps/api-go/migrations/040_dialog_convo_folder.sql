-- 040_dialog_convo_folder.sql
-- Lotus v1 §1/§3/§7: Dialog/Convo/Folder/Pin + ReadCursor

CREATE TABLE IF NOT EXISTS conversation.dialogs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('dm','group','official')),
    title TEXT NOT NULL,
    avatar_ref TEXT,
    member_ids JSONB NOT NULL DEFAULT '[]',
    folder_ids JSONB NOT NULL DEFAULT '[]',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    is_macke BOOLEAN NOT NULL DEFAULT FALSE,
    latest_seq BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dialogs_member ON conversation.dialogs USING GIN (member_ids);
CREATE INDEX IF NOT EXISTS idx_dialogs_macke ON conversation.dialogs (is_macke) WHERE is_macke = TRUE;

CREATE TABLE IF NOT EXISTS conversation.convos (
    id TEXT PRIMARY KEY,
    parent_dialog_id TEXT NOT NULL REFERENCES conversation.dialogs(id) ON DELETE CASCADE,
    seed_message_id TEXT NOT NULL,
    title TEXT NOT NULL,
    participant_ids JSONB NOT NULL DEFAULT '[]',
    external_participant_ids JSONB NOT NULL DEFAULT '[]',
    latest_seq BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (seed_message_id)
);
CREATE INDEX IF NOT EXISTS idx_convos_parent ON conversation.convos (parent_dialog_id);

CREATE TABLE IF NOT EXISTS conversation.folders (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dialog_ids JSONB NOT NULL DEFAULT '[]',
    ord INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON conversation.folders (owner_user_id);

CREATE TABLE IF NOT EXISTS conversation.pins (
    id TEXT PRIMARY KEY,
    dialog_id TEXT NOT NULL REFERENCES conversation.dialogs(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES conversation.messages(id) ON DELETE CASCADE,
    pinned_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pins_dialog ON conversation.pins (dialog_id);

CREATE TABLE IF NOT EXISTS conversation.read_cursors (
    user_id TEXT NOT NULL,
    dialog_id TEXT NOT NULL REFERENCES conversation.dialogs(id) ON DELETE CASCADE,
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, dialog_id)
);
CREATE TABLE IF NOT EXISTS conversation.convo_read_cursors (
    user_id TEXT NOT NULL,
    convo_id TEXT NOT NULL REFERENCES conversation.convos(id) ON DELETE CASCADE,
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, convo_id)
);
COMMENT ON TABLE conversation.dialogs IS 'v1 Dialog: dm/group/official, Folder/MacKe, latestSeq for cursor unread';
COMMENT ON TABLE conversation.convos IS 'v1 Convo: Message Branch, must have seedMessageId';
