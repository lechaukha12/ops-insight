import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const traceId = searchParams.get('trace_id');

    if (!traceId) {
      return NextResponse.json({ error: 'Missing trace_id parameter' }, { status: 400 });
    }

    const resultSet = await clickhouse.query({
      query: `
        SELECT 
          timestamp, 
          span_id, 
          parent_span_id, 
          service_name, 
          endpoint_api, 
          error_message, 
          status_code, 
          duration_ms 
        FROM error_occurrences 
        WHERE trace_id = {t_id: String}
        ORDER BY timestamp ASC
      `,
      query_params: { t_id: traceId },
      format: 'JSONEachRow',
    });

    const spans = await resultSet.json() as any[];

    // Determine is_root_cause for each span in this specific trace
    const parentSpanIdsSet = new Set<string>();
    for (const span of spans) {
      if (span.parent_span_id) {
        parentSpanIdsSet.add(span.parent_span_id);
      }
    }

    const processedSpans = spans.map(span => ({
      ...span,
      is_root_cause: !parentSpanIdsSet.has(span.span_id)
    }));

    return NextResponse.json({ spans: processedSpans });
  } catch (error) {
    console.error('Error fetching trace spans from ClickHouse:', error);
    return NextResponse.json({ error: 'Failed to query database' }, { status: 500 });
  }
}
