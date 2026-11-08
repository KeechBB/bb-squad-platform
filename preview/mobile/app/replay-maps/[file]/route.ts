export function GET() {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><pattern id="grid" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M128 0H0V128" fill="none" stroke="#575069"/></pattern></defs><rect width="1024" height="1024" fill="#171322"/><rect width="1024" height="1024" fill="url(#grid)"/><text x="512" y="512" fill="#c3b3e3" font-size="32" text-anchor="middle">LOCAL PREVIEW · MAP PLACEHOLDER</text></svg>`, { headers: { "Content-Type": "image/svg+xml" } });
}
