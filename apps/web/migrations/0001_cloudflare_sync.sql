CREATE TABLE IF NOT EXISTS chats (
    user_id TEXT NOT NULL,
    local_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS chats_by_user_updated
    ON chats (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    user_id TEXT NOT NULL,
    local_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS messages_by_user_chat_created
    ON messages (user_id, chat_id, created_at ASC);

CREATE TABLE IF NOT EXISTS attachments (
    user_id TEXT NOT NULL,
    local_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    purged_at INTEGER,
    storage_key TEXT,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS attachments_by_user_message
    ON attachments (user_id, message_id);

CREATE INDEX IF NOT EXISTS attachments_by_user_type_purge
    ON attachments (user_id, type, purged_at);

CREATE TABLE IF NOT EXISTS skills (
    user_id TEXT NOT NULL,
    local_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, local_id)
);

CREATE TABLE IF NOT EXISTS skill_settings (
    user_id TEXT PRIMARY KEY,
    default_skill_id TEXT,
    selected_skill_id TEXT,
    selected_skill_mode TEXT NOT NULL DEFAULT 'auto'
);
