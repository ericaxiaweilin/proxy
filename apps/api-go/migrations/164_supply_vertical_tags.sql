-- MERCHANT-CREATOR-TAGS-001：创作者自声明内容垂类（餐厅/咖啡店/旅游等）。
-- JSONB 数组，默认空数组；展示过滤在客户端封闭名单，服务端不过滤。
ALTER TABLE supply.agent_services
    ADD COLUMN IF NOT EXISTS vertical_tags JSONB NOT NULL DEFAULT '[]';
