-- R15：Post 增加展示名（P0 演示；权威作者仍是 author_type + author_id）
ALTER TABLE localnet.posts ADD COLUMN IF NOT EXISTS author_display_name text NOT NULL DEFAULT '';
