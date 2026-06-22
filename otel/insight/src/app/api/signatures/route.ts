import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const signatureId = searchParams.get('signature_id');

    // 1. Drill-down: Return raw occurrences for a specific signature ID
    if (signatureId) {
      const resultSet = await clickhouse.query({
        query: `
          SELECT 
            timestamp, 
            trace_id, 
            span_id, 
            parent_span_id,
            duration_ms 
          FROM error_occurrences 
          WHERE signature_id = {sig_id: String}
          ORDER BY timestamp DESC 
          LIMIT 50
        `,
        query_params: { sig_id: signatureId },
        format: 'JSONEachRow',
      });
      const occurrences = await resultSet.json() as any[];

      if (occurrences.length === 0) {
        return NextResponse.json({ occurrences: [] });
      }

      // Fetch all error spans for these trace IDs to compute root cause
      const traceIds = Array.from(new Set(occurrences.map(o => o.trace_id)));
      const allSpansSet = await clickhouse.query({
        query: `
          SELECT 
            trace_id, 
            span_id, 
            parent_span_id 
          FROM error_occurrences 
          WHERE trace_id IN ({t_ids: Array(String)})
        `,
        query_params: { t_ids: traceIds },
        format: 'JSONEachRow',
      });
      const allSpans = await allSpansSet.json() as any[];

      // Create a set of trace_id:parent_span_id to check if a span acts as a parent of any error span
      const parentSpanIdsSet = new Set<string>();
      for (const span of allSpans) {
        if (span.parent_span_id) {
          parentSpanIdsSet.add(`${span.trace_id}:${span.parent_span_id}`);
        }
      }

      // Process occurrences and compute is_root_cause
      const processedOccurrences = occurrences.map(occ => {
        const key = `${occ.trace_id}:${occ.span_id}`;
        const hasChildError = parentSpanIdsSet.has(key);
        return {
          timestamp: occ.timestamp,
          trace_id: occ.trace_id,
          span_id: occ.span_id,
          duration_ms: occ.duration_ms,
          is_root_cause: !hasChildError
        };
      });

      return NextResponse.json({ occurrences: processedOccurrences });
    }

    // 2. Overview: Query aggregated stats, signatures, and 24h timeline
    // Get signatures list
    const signaturesSet = await clickhouse.query({
      query: `
        SELECT 
          signature_id,
          service_name,
          endpoint_api,
          error_message,
          status_code,
          count,
          first_seen,
          last_seen
        FROM error_signatures FINAL
        ORDER BY last_seen DESC
      `,
      format: 'JSONEachRow',
    });
    const signatures = await signaturesSet.json();

    // Get 24-hour error count
    const count24hSet = await clickhouse.query({
      query: `
        SELECT count() as total_errors 
        FROM error_occurrences 
        WHERE timestamp >= now() - INTERVAL 24 HOUR
      `,
      format: 'JSONEachRow',
    });
    const count24hRows = await count24hSet.json() as any[];
    const totalErrors24h = Number(count24hRows[0]?.total_errors || 0);

    // Get 1-hour error count
    const count1hSet = await clickhouse.query({
      query: `
        SELECT count() as total_errors 
        FROM error_occurrences 
        WHERE timestamp >= now() - INTERVAL 1 HOUR
      `,
      format: 'JSONEachRow',
    });
    const count1hRows = await count1hSet.json() as any[];
    const totalErrors1h = Number(count1hRows[0]?.total_errors || 0);

    // Get timeline: errors bucketed by 10-minute intervals for the last 24 hours
    const timelineSet = await clickhouse.query({
      query: `
        SELECT 
          toStartOfInterval(timestamp, INTERVAL 10 MINUTE) as time,
          count() as count
        FROM error_occurrences
        WHERE timestamp >= now() - INTERVAL 24 HOUR
        GROUP BY time
        ORDER BY time ASC
      `,
      format: 'JSONEachRow',
    });
    const timeline = await timelineSet.json();

    return NextResponse.json({
      stats: {
        totalSignatures: signatures.length,
        totalErrors24h,
        totalErrors1h,
      },
      signatures,
      timeline,
    });
  } catch (error) {
    console.error('Error fetching data from ClickHouse:', error);
    return NextResponse.json({ error: 'Failed to query database' }, { status: 500 });
  }
}
