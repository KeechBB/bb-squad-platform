/** Старые вкладки Сети больше не получают 404 в консоли. */
export function GET() {
  return new Response(null, { status: 204 });
}

export function POST() {
  return new Response(null, { status: 204 });
}
