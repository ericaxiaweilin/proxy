package voucher
// P1 VOUCHER-01 补充：领取上限/防刷阈值
const MaxPerPerson = 3
const MaxBatchClaim = 10
func IsFraudBatch(claims int) bool { return claims > MaxBatchClaim }
