# Invite Materializer P0 — ORDER-01/02 AC-04/05
> Master §11-12：Invite 唯一 materialize + TermsVersion + reconfirm

- SourceContextType → MaterializedType 表已在 `apps/api-go/internal/invite/materializer.go`
- Material Change 字段：price/time/exactLocation/scope → TermsVersion+1 → 旧确认失效
- 关联 Order State Machine：DRAFT→TERMS_CONFIRMED→COMMITTED→EN_ROUTE→ARRIVED→IN_PROGRESS→COMPLETION_REVIEW→SETTLED
