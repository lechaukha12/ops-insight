import { createClient } from '@clickhouse/client';

const host = process.env.CLICKHOUSE_HOST || 'localhost';
const port = process.env.CLICKHOUSE_PORT || '8123';
const username = process.env.CLICKHOUSE_USER || 'default';
const password = process.env.CLICKHOUSE_PASSWORD || '';
const database = process.env.CLICKHOUSE_DB || 'insight';

console.log(`Connecting to ClickHouse at http://${host}:${port} (database: ${database})...`);

// Initial client to default database to run CREATE DATABASE
const initClient = createClient({
  url: `http://${host}:${port}`,
  username,
  password,
  database: 'default',
});

// Final client pointing to our target database
export const clickhouse = createClient({
  url: `http://${host}:${port}`,
  username,
  password,
  database,
});

export async function initDatabase() {
  try {
    // 1. Create database if not exists
    await initClient.exec({
      query: `CREATE DATABASE IF NOT EXISTS ${database}`,
    });
    console.log(`Database '${database}' verified/created.`);

    // 2. Create error_signatures table
    // ReplacingMergeTree keeps the latest version of a signature by signature_id, using last_seen for versioning.
    await clickhouse.exec({
      query: `
        CREATE TABLE IF NOT EXISTS error_signatures (
          signature_id String,
          service_name String,
          endpoint_api String,
          error_message String,
          status_code String,
          count UInt64,
          first_seen DateTime,
          last_seen DateTime
        ) ENGINE = ReplacingMergeTree(last_seen)
        PRIMARY KEY signature_id
        ORDER BY signature_id
      `,
    });
    console.log("Table 'error_signatures' verified/created.");

    // 3. Create error_occurrences table
    // Standard MergeTree containing history of all trace error occurrences.
    await clickhouse.exec({
      query: `
        CREATE TABLE IF NOT EXISTS error_occurrences (
          timestamp DateTime,
          signature_id String,
          trace_id String,
          span_id String,
          service_name String,
          endpoint_api String,
          error_message String,
          status_code String,
          duration_ms Float64
        ) ENGINE = MergeTree()
        ORDER BY (timestamp, signature_id)
      `,
    });
    console.log("Table 'error_occurrences' verified/created.");

  } catch (error) {
    console.error('Failed to initialize ClickHouse database tables:', error);
    throw error;
  }
}
