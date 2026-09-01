-- 048_voucher_settlements.sql — 凭证结算账本（P0 账本分离）
-- 每次 SettleVoucher 产生一条不可变账本记录，供对账与审计

CREATE TABLE IF NOT EXISTS voucher.settlements (
    settlement_id TEXT PRIMARY KEY,
    voucher_id    TEXT NOT NULL,
    actor_id      TEXT NOT NULL,
    amount        INTEGER NOT NULL CHECK (amount > 0),
    currency      TEXT NOT NULL DEFAULT 'VND',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (actor_id, voucher_id) REFERENCES voucher.vouchers(actor_id, voucher_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_settlements_actor ON voucher.settlements(actor_id);
CREATE INDEX IF NOT EXISTS idx_settlements_voucher ON voucher.settlements(voucher_id);
