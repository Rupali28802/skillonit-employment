export const runtime = 'nodejs';
export async function GET(request: Request) {
  // Heartbeat transport. Production job events require the shared pub/sub adapter;
  // never fake a stream of newly ingested vacancies or poll MongoDB per subscriber.
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('event: ready\ndata: {"connected":true}\n\n'),
      );
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(timer);
        }
      }, 25000);
      request.signal.addEventListener('abort', () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
