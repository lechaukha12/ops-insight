import { NextResponse } from 'next/server';
import { aggregator, ErrorSpan } from '@/lib/aggregator';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type');
    const contentEncoding = request.headers.get('content-encoding');
    console.log(`Ingested trace request: Content-Type=${contentType}, Content-Encoding=${contentEncoding}`);
    
    const clone = request.clone();
    const rawText = await clone.text();
    console.log(`Raw body preview (first 100 chars): ${rawText.slice(0, 100)}`);

    const body = JSON.parse(rawText);
    
    // Parse OTLP JSON payload
    const errorSpans = parseOtlpJson(body);
    
    if (errorSpans.length > 0) {
      console.log(`Ingested ${errorSpans.length} error spans from collector. Inserting to aggregator...`);
      for (const span of errorSpans) {
        await aggregator.addSpan(span);
      }
    }

    // OTel Collector expects 200 OK or 201 Created with JSON response
    return NextResponse.json({ partialSuccessExports: [] }, { status: 200 });
  } catch (error) {
    console.error('Error in OTLP trace ingestion endpoint:', error);
    return NextResponse.json({ error: 'Failed to process traces' }, { status: 500 });
  }
}

function parseOtlpJson(body: any): ErrorSpan[] {
  const errorSpans: ErrorSpan[] = [];
  const resourceSpans = body.resourceSpans || [];

  for (const resourceSpan of resourceSpans) {
    // 1. Get Service Name from resource attributes
    const resourceAttrs = resourceSpan.resource?.attributes || [];
    const serviceNameAttr = resourceAttrs.find((a: any) => a.key === 'service.name');
    const serviceName = serviceNameAttr?.value?.stringValue || 'unknown-service';

    const scopeSpans = resourceSpan.scopeSpans || [];
    for (const scopeSpan of scopeSpans) {
      const spans = scopeSpan.spans || [];
      for (const span of spans) {
        // 2. Check if the span is an error
        // status.code: 2 is StatusCode.ERROR, or string representation
        const statusCode = span.status?.code;
        const isError = 
          statusCode === 2 || 
          statusCode === 'STATUS_CODE_ERROR' || 
          (span.status?.message && span.status.message.trim().length > 0);

        if (isError) {
          // 3. Extract Error Message
          let errorMessage = span.status?.message || '';
          
          // Check span events for exceptions if status.message is empty
          if (!errorMessage && span.events) {
            const exceptionEvent = span.events.find((e: any) => e.name === 'exception');
            if (exceptionEvent) {
              const exceptionAttrs = exceptionEvent.attributes || [];
              const messageAttr = exceptionAttrs.find((a: any) => a.key === 'exception.message');
              const typeAttr = exceptionAttrs.find((a: any) => a.key === 'exception.type');
              
              const msgVal = messageAttr?.value?.stringValue || '';
              const typeVal = typeAttr?.value?.stringValue || '';
              errorMessage = typeVal ? `${typeVal}: ${msgVal}` : msgVal;
            }
          }

          if (!errorMessage) {
            errorMessage = 'Unknown Error (Status: ERROR)';
          }

          // 4. Calculate duration
          let startTimeNano = 0n;
          let endTimeNano = 0n;
          try {
            startTimeNano = BigInt(span.startTimeUnixNano || 0);
            endTimeNano = BigInt(span.endTimeUnixNano || 0);
          } catch {
            // Fallback in case of parsing errors
          }
          
          const durationMs = Number(endTimeNano - startTimeNano) / 1_000_000.0;

          // Convert unix nano timestamp to Date object
          const timestampMs = Number(startTimeNano / 1_000_000n);
          const timestamp = new Date(timestampMs || Date.now());

          errorSpans.push({
            timestamp,
            trace_id: span.traceId,
            span_id: span.spanId,
            service_name: serviceName,
            endpoint_api: span.name || 'unknown-operation',
            error_message: errorMessage,
            status_code: 'ERROR',
            duration_ms: Math.max(0, durationMs),
          });
        }
      }
    }
  }

  return errorSpans;
}
