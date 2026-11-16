package database_test

import (
	"context"
	"io"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jefthah/jdsign/apps/api/internal/database"
	"github.com/jefthah/jdsign/apps/api/internal/testdb"
)

func TestMigrationsRollBackAndReapplyCleanly(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	if err := database.Migrate(ctx, pool, "down", io.Discard); err != nil {
		t.Fatalf("migrate down: %v", err)
	}
	if tables := countApplicationTables(t, pool); tables != 0 {
		t.Fatalf("tables after down = %d, want 0", tables)
	}

	if err := database.Migrate(ctx, pool, "up", io.Discard); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
	if tables := countApplicationTables(t, pool); tables != 14 {
		t.Fatalf("tables after up = %d, want 14", tables)
	}
}

func TestLedgerEntriesCannotBeChanged(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO users (email, name, role) VALUES ('seller@example.test', 'Seller', 'seller'), ('buyer@example.test', 'Buyer', 'buyer');
		INSERT INTO templates (seller_id, category_id, title, slug, summary, description, price, technology, archive_path)
		VALUES (1, 1, 'Template', 'template-abcdefgh', 'Ringkas', 'Deskripsi yang panjangnya lebih dari tiga puluh karakter.', 150000, 'HTML', 'templates/1/a.zip');
		INSERT INTO orders (number, checkout_key, buyer_id, total) VALUES ('JD-01JD0000000000000000000000', gen_random_uuid(), 2, 150000);
		INSERT INTO order_items (order_id, template_id, seller_id, title, version, license_type, license_key, price, commission_bps, platform_fee, seller_net, archive_path)
		VALUES (1, 1, 1, 'Template', '1.0.0', 'Standard', gen_random_uuid(), 150000, 1000, 15000, 135000, 'templates/1/a.zip');
		INSERT INTO ledger_entries (seller_id, order_item_id, reference, type, amount) VALUES (1, 1, 'sale:1', 'sale', 135000);
	`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	if _, err := pool.Exec(ctx, "UPDATE ledger_entries SET amount = 1"); err == nil {
		t.Fatal("ledger entry was updated")
	}
	if _, err := pool.Exec(ctx, "DELETE FROM ledger_entries"); err == nil {
		t.Fatal("ledger entry was deleted")
	}
}

func countApplicationTables(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()

	var count int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'goose_db_version'
	`).Scan(&count)
	if err != nil {
		t.Fatalf("counting tables: %v", err)
	}

	return count
}
