package postgres

import (
	"context"
	"os"
	"strconv"
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
	config, err := poolConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, config)
}

func poolConfig(databaseURL string) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	maxConnections := envInt32("PROXY_DB_MAX_CONNS", 20, 1, 200)
	minConnections := envInt32("PROXY_DB_MIN_CONNS", 2, 0, maxConnections)
	config.MaxConns = maxConnections
	config.MinConns = minConnections
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnLifetimeJitter = 5 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute
	config.HealthCheckPeriod = 30 * time.Second
	if config.ConnConfig.ConnectTimeout <= 0 {
		config.ConnConfig.ConnectTimeout = 5 * time.Second
	}
	return config, nil
}

func envInt32(key string, fallback, minimum, maximum int32) int32 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 32)
	if err != nil || value < int64(minimum) || value > int64(maximum) {
		return fallback
	}
	return int32(value)
}
