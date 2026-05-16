import { NextRequest } from "next/server";

const S3_ENDPOINT = process.env.S3_ENDPOINT_URL || "http://localhost:9000";
const S3_BUCKET = process.env.S3_BUCKET_NAME || "standmeet-assets";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch the built HTML directly from S3/MinIO
  const s3Key = `pages/${id}/index.html`;
  const s3Url = `${S3_ENDPOINT}/${S3_BUCKET}/${s3Key}`;

  try {
    const res = await fetch(s3Url, {
      headers: {
        // MinIO supports unsigned requests if bucket policy allows,
        // otherwise we'll need to sign. For now, try direct access.
      },
      next: { revalidate: 30 }, // cache for 30s
    });

    if (!res.ok) {
      // Fallback: return 404
      return new Response("Page not found", { status: 404 });
    }

    const html = await res.text();

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return new Response("Page not found", { status: 404 });
  }
}
