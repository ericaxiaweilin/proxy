package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type transactionContextKey struct{}

type TransactionRunner struct {
	pool *pgxpool.Pool
}

func NewTransactionRunner(pool *pgxpool.Pool) *TransactionRunner {
	return &TransactionRunner{pool: pool}
}

func (r *TransactionRunner) WithinTransaction(ctx context.Context, operation func(context.Context) error) error {
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, _ pgx.Tx) error {
		return operation(transactionContext)
	})
}

type sqlExecer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type sqlQueryer interface {
	sqlExecer
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func transactionFromContext(ctx context.Context) (pgx.Tx, bool) {
	transaction, ok := ctx.Value(transactionContextKey{}).(pgx.Tx)
	return transaction, ok
}

func execerForContext(ctx context.Context, pool *pgxpool.Pool) sqlExecer {
	if transaction, ok := transactionFromContext(ctx); ok {
		return transaction
	}
	return pool
}

func queryerForContext(ctx context.Context, pool *pgxpool.Pool) sqlQueryer {
	if transaction, ok := transactionFromContext(ctx); ok {
		return transaction
	}
	return pool
}

func runInTransaction(ctx context.Context, pool *pgxpool.Pool, operation func(context.Context, pgx.Tx) error) error {
	if transaction, ok := transactionFromContext(ctx); ok {
		return operation(ctx, transaction)
	}
	transaction, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	transactionContext := context.WithValue(ctx, transactionContextKey{}, transaction)
	if err := operation(transactionContext, transaction); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute
	return pgxpool.NewWithConfig(ctx, config)
}
