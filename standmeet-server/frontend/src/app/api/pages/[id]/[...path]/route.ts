import { NextRequest } from "next/server";

const S3_ENDPOINT = process.env.S3_ENDPOINT_URL || "http://localhost:9000";
const S3_BUCKET = process.env.S3_BUCKET_NAME || "standmeet-assets";

const MIME_TYPES: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
};

function getMimeType(filepath: string): string {
  const ext = filepath.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  const filepath = path.join("/");

  const s3Key = `pages/${id}/${filepath}`;
  const s3Url = `${S3_ENDPOINT}/${S3_BUCKET}/${s3Key}`;

  try {
    const res = await fetch(s3Url, {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return new Response("Not found", { status: 404 });
    }

    const body = await res.arrayBuffer();

    return new Response(body, {
      headers: {
        "content-type": getMimeType(filepath),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
