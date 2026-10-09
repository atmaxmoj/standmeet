// posts-ui.ts —— the browser side of the posts specs (posts-tests.md § E, F, I, J).
//
// Contract (defined while RED; the implementation must satisfy it):
//   SDK (`@standmeet/sdk`), inside <StandMeetProvider>:
//     <Posts />   the timeline of what the reader's session may see (GET /api/v1/posts)
//       data-testid="posts-widget"           the timeline
//       data-testid="posts-item-<id>"        one post; inside it:
//         data-testid="posts-time"           a <time dateTime=<created_at ISO>>, shown in the
//                                            reader's timezone as an absolute time
//         data-testid="posts-body"           the rendered markdown body
//         data-testid="posts-edited"         present iff updated_at ≠ created_at
//       data-testid="posts-empty"            nothing to show (copy in the page's <html lang>)
//       data-testid="posts-error"            the load failed (a sentence, never a status)
//     usePosts() → { items, loading, error, hasMore, loadMore }
//   Admin, section slug `posts` (/admin/posts, nav testid admin-nav-posts; zh label 动态):
//     posts-composer-body                    textarea
//     posts-composer-visibility              <select> private | public | roles (default private)
//     posts-composer-roles                   the role multi-select; rendered only for `roles`
//     posts-composer-role-<roleID>           one role checkbox in it
//     posts-composer-pool-toggle / -pool-list / -pool-insert-<assetID>   cite a pool image
//     posts-composer-submit
//     posts-list                             the owner timeline (ListPane: section-load-failed /
//                                            posts-empty)
//     post-row-<id>                          one post, rendered body inside
//     post-visibility-<id>                   its badge: private | public | roles
//     post-visibility-edit-<id>              inline <select> that changes it
//     post-delete-<id>                       delete (confirm prompt names the trash)
//     posts-filter-visibility                <select> '' (all) | private | public | roles
//     posts-search                           search box
//   Trash section: group `trash-posts`, rows `trash-post-row-<id>`, `trash-post-restore-<id>`.

import type { Locator, Page } from '@playwright/test';

const PASSWORD = 'correct-horse-battery-staple';

// ownerCreds —— the login setupPostsOwner(handle) claimed with, for test.use({ownerCredentials}).
export function ownerCreds(handle: string): { email: string; password: string } {
  return { email: `${handle}@example.com`, password: PASSWORD };
}

// POSTS_PAGE —— a microsite that places the timeline component and the hook beside it. The page
// language follows the visitor's stored choice (usePageLang writes <html lang>), so a spec can open
// it in Chinese by seeding `sm-lang`.
export const POSTS_PAGE = `
import { StandMeetProvider, Posts, usePosts, usePageLang } from "@standmeet/sdk";

function HookCount() {
  const posts = usePosts();
  return <div data-sm="hook-count">{posts.loading ? "" : String(posts.items.length)}</div>;
}

export default function App() {
  usePageLang(["en", "zh"] as const, "en");
  return (
    <StandMeetProvider>
      <main>
        <h1 data-sm="marker">POSTS PAGE</h1>
        <Posts />
        <HookCount />
      </main>
    </StandMeetProvider>
  );
}
`.trim();

// timelineItems —— every post the SDK timeline shows on this page.
export function timelineItems(page: Page): Locator {
  return page.getByTestId('posts-widget').locator('[data-testid^="posts-item-"]');
}

// xssBody —— a post body carrying the three classic payloads plus markdown and KaTeX, all around a
// marker. Each payload, if it ever ran, would set its own window flag (readXSSFlags).
export function xssBody(mark: string): string {
  return [
    `## Heading_${mark}`,
    '',
    `Inline math $E = mc^2$ and the marker ${mark}.`,
    '',
    '<script>window.__postScript = true</script>',
    '',
    // A blank line after each payload: an HTML line opens a markdown HTML block that runs to the
    // next blank line, and would swallow the link below it.
    '<img src="x" onerror="window.__postImg = true" />',
    '',
    '[click me](javascript:window.__postLink=true)',
  ].join('\n');
}

// readXSSFlags —— which payloads ran on this page (all false = inert).
export function readXSSFlags(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return { script: w['__postScript'] === true, img: w['__postImg'] === true, link: w['__postLink'] === true };
  });
}
