import { NextRequest, NextResponse } from "next/server";

const DJANGO_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "";

export async function middleware(request: NextRequest) {
  // Only intercept /i/[code] or /i/[code]/
  const match = request.nextUrl.pathname.match(/^\/i\/([^/]+)\/?$/);
  if (!match) return NextResponse.next();

  const code = match[1];

  try {
    const res = await fetch(`${DJANGO_URL}/api/internal/invite-page/${code}/`, {
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      next: { revalidate: 10 }, // cache for 10s
    });

    if (!res.ok) return NextResponse.next();

    const data = await res.json();
    if (data.page_id) {
      // Rewrite to the page serving API route
      return NextResponse.rewrite(
        new URL(`/api/pages/${data.page_id}`, request.url)
      );
    }
  } catch {
    // If check fails, fall through to default chat UI
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/i/:code",
};
