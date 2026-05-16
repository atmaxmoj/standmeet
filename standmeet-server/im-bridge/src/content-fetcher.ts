const SUMMARY_MAX_LEN = 500;

/**
 * Fetch content summary from Django API by path.
 * Returns the summary if available, otherwise truncated content.
 */
export async function fetchContentSummary(
  djangoUrl: string,
  ownerToken: string,
  path: string,
): Promise<string> {
  try {
    // Strip leading slash for URL construction (Django expects /api/repo/{path}/)
    const cleanPath = path.replace(/^\//, "");
    const res = await fetch(`${djangoUrl}/api/repo/${cleanPath}/`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    if (!res.ok) {
      return `Content not found: ${path}`;
    }

    const data = await res.json();

    if (data.summary) {
      return data.summary;
    }

    // Fallback: stringify content and truncate
    const contentStr = typeof data.content === "string"
      ? data.content
      : JSON.stringify(data.content, null, 2);

    if (contentStr.length <= SUMMARY_MAX_LEN) {
      return contentStr;
    }

    return contentStr.slice(0, SUMMARY_MAX_LEN) + "...";
  } catch (err) {
    console.error(`[content-fetcher] Failed to fetch ${path}:`, err);
    return `Could not load content for ${path}.`;
  }
}

/**
 * Extract a human-readable label from a content path.
 * e.g. "/profile/about" -> "about", "/projects/standmeet" -> "standmeet"
 */
export function pathToLabel(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
