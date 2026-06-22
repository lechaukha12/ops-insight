import { clickhouse, initDatabase } from './clickhouse';
import crypto from 'crypto';

export interface ErrorSpan {
  timestamp: Date;
  trace_id: string;
  span_id: string;
  service_name: string;
  endpoint_api: string;
  error_message: string;
  status_code: string;
  duration_ms: number;
}

interface SignatureCacheItem {
  signature_id: string;
  service_name: string;
  endpoint_api: string;
  error_message: string;
  status_code: string;
  count: number;
  first_seen: Date;
  last_seen: Date;
  isDirty: boolean;
}

class TraceAggregator {
  private signatureCache = new Map<string, SignatureCacheItem>();
  private occurrenceBuffer: ErrorSpan[] = [];
  private isInitialized = false;
  private isFlushing = false;
  private initPromise: Promise<void> | null = null;

  constructor() {}

  private async ensureInitialized() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await initDatabase();

        // Load existing signatures from ClickHouse to populate in-memory cache
        const resultSet = await clickhouse.query({
          query: `SELECT signature_id, service_name, endpoint_api, error_message, status_code, count, first_seen, last_seen FROM error_signatures`,
          format: 'JSONEachRow'
        });
        const rows = await resultSet.json() as any[];

        for (const row of rows) {
          this.signatureCache.set(row.signature_id, {
            signature_id: row.signature_id,
            service_name: row.service_name,
            endpoint_api: row.endpoint_api,
            error_message: row.error_message,
            status_code: row.status_code,
            count: Number(row.count),
            first_seen: new Date(row.first_seen + 'Z'), // Append 'Z' to treat as UTC from ClickHouse
            last_seen: new Date(row.last_seen + 'Z'),
            isDirty: false
          });
        }

        this.isInitialized = true;
        console.log(`Aggregator initialized. Loaded ${this.signatureCache.size} signatures from ClickHouse.`);

        // Start periodic flush to ClickHouse every 5 seconds
        setInterval(() => this.flush(), 5000);
      } catch (error) {
        console.error('Failed to initialize TraceAggregator:', error);
        this.initPromise = null; // Reset so next request can retry
      }
    })();

    return this.initPromise;
  }

  public async addSpan(span: ErrorSpan) {
    if (!this.isInitialized) {
      await this.ensureInitialized();
    }

    // Generate Signature ID = MD5(service_name + endpoint_api + error_message + status_code)
    // Trim values to ensure clean matching
    const service = (span.service_name || 'unknown').trim();
    const endpoint = (span.endpoint_api || 'unknown').trim();
    const msg = (span.error_message || 'No error message').trim();
    const status = (span.status_code || 'ERROR').trim();

    const signatureId = crypto
      .createHash('md5')
      .update(`${service}${endpoint}${msg}${status}`)
      .digest('hex');

    // Update in-memory signature cache
    const existing = this.signatureCache.get(signatureId);
    if (existing) {
      existing.count += 1;
      existing.last_seen = span.timestamp;
      existing.isDirty = true;
    } else {
      const newItem: SignatureCacheItem = {
        signature_id: signatureId,
        service_name: service,
        endpoint_api: endpoint,
        error_message: msg,
        status_code: status,
        count: 1,
        first_seen: span.timestamp,
        last_seen: span.timestamp,
        isDirty: true
      };
      this.signatureCache.set(signatureId, newItem);
    }

    // Buffer the raw incident occurrence
    this.occurrenceBuffer.push({
      ...span,
      service_name: service,
      endpoint_api: endpoint,
      error_message: msg,
      status_code: status
    });
  }

  private async flush() {
    if (this.isFlushing || !this.isInitialized) return;
    this.isFlushing = true;

    try {
      // 1. Flush Dirty Signatures
      const dirtySignatures = Array.from(this.signatureCache.values()).filter(s => s.isDirty);
      if (dirtySignatures.length > 0) {
        console.log(`Flushing ${dirtySignatures.length} updated signatures to ClickHouse...`);
        
        // Format dates correctly for ClickHouse (YYYY-MM-DD HH:MM:SS)
        const formatClickHouseDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

        const signatureRows = dirtySignatures.map(s => ({
          signature_id: s.signature_id,
          service_name: s.service_name,
          endpoint_api: s.endpoint_api,
          error_message: s.error_message,
          status_code: s.status_code,
          count: s.count,
          first_seen: formatClickHouseDate(s.first_seen),
          last_seen: formatClickHouseDate(s.last_seen),
        }));

        await clickhouse.insert({
          table: 'error_signatures',
          values: signatureRows,
          format: 'JSONEachRow',
        });

        // Clear dirty flags
        dirtySignatures.forEach(s => (s.isDirty = false));
      }

      // 2. Flush Raw Occurrences
      if (this.occurrenceBuffer.length > 0) {
        const occurrencesToFlush = [...this.occurrenceBuffer];
        this.occurrenceBuffer = []; // Clear buffer immediately to prevent duplicate flushes

        console.log(`Flushing ${occurrencesToFlush.length} error trace occurrences to ClickHouse...`);

        const formatClickHouseDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

        const occurrenceRows = occurrencesToFlush.map(o => ({
          timestamp: formatClickHouseDate(o.timestamp),
          signature_id: crypto
            .createHash('md5')
            .update(`${o.service_name}${o.endpoint_api}${o.error_message}${o.status_code}`)
            .digest('hex'),
          trace_id: o.trace_id,
          span_id: o.span_id,
          service_name: o.service_name,
          endpoint_api: o.endpoint_api,
          error_message: o.error_message,
          status_code: o.status_code,
          duration_ms: o.duration_ms
        }));

        await clickhouse.insert({
          table: 'error_occurrences',
          values: occurrenceRows,
          format: 'JSONEachRow',
        });
      }

    } catch (error) {
      console.error('Error flushing trace aggregator to ClickHouse:', error);
    } finally {
      this.isFlushing = false;
    }
  }
}

// Support singleton pattern in Next.js hot-reloading development environment
const globalForAggregator = globalThis as unknown as {
  aggregatorInstance?: TraceAggregator;
};

export const aggregator = globalForAggregator.aggregatorInstance ?? new TraceAggregator();

if (process.env.NODE_ENV !== 'production') {
  globalForAggregator.aggregatorInstance = aggregator;
}
