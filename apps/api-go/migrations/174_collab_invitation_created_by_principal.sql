-- 174_collab_invitation_created_by_principal.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：这条列是**收件箱收件人**能被解析出来的前提。
--
-- 邀约/还价这类流程的收件人是**对方**，而对方不是从当前动作的 actor 推得出来的：
-- creator 接受/还价/拒绝的那一刻，actor 是 creator，要通知的是「当初发这条活单的人」
-- —— 那个 user account id 在事件发生的这一瞬间根本不在这条事件的任何字段里。
--
-- 不存下来的两种下场，各有各的坏：
--   ① worker 在通知时去 business.member_directory 反查「这个商户有哪些成员」——
--      那是**猜**（多成员商户该通知谁？），而且把 worker 绑到 business 域；
--   ② 只通知 creator 侧 —— 商家发完活单之后永远收不到「她还价了」。
--
-- 「这条活单是谁发的」本身也是审计上该有的事实，所以记在活单行上，而不是
-- 另开一张映射表：它就是这条记录的一部分。
--
-- 可空：历史行（这条列之前建的）无从得知是谁发的，NULL 意味着「不知道该通知谁」。
-- 那种情况下**不发通知**，而不是猜一个收件人。
ALTER TABLE supply.collab_invitations
    ADD COLUMN IF NOT EXISTS created_by_principal_id TEXT;

COMMENT ON COLUMN supply.collab_invitations.created_by_principal_id IS
    '发这条活单的 user account id。MERCHANT-CREATOR-NOTIFY-001：creator 还价/接受/拒绝时，通知对象是「发活单的人」而不是当前 actor —— actor id 在那一刻推不出收件人。NULL = 未知（历史行），此时不发通知，不猜。';
