export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const backend = process.env.BACKEND_URL || 'http://127.0.0.1:4000';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Flush the public stream immediately. Some reverse proxies wait for a
      // response body chunk before forwarding SSE headers to the browser.
      controller.enqueue(encoder.encode('event: ready\ndata: {"connected":true}\n\n'));
      void (async () => {
        try {
          const upstream = await fetch(`${backend}/api/v1/jobs/stream`, {
            headers: {
              Accept: 'text/event-stream',
              ...(request.headers.get('last-event-id') ? { 'Last-Event-ID': request.headers.get('last-event-id')! } : {}),
            },
            cache: 'no-store',
            signal: request.signal,
          });
          if (!upstream.ok || !upstream.body) throw new Error('Upstream job stream is unavailable');
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch {
          if (!request.signal.aborted) controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'));
          controller.close();
        }
      })();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
