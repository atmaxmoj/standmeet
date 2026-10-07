# @standmeet/embed

A StandMeet chat for any web page: one `<script>` tag and one element. The visitor asks; the owner's
AI answers in the owner's voice from the owner's corpus. React, the SDK and the stylesheet are all
inside the bundle and the chat renders in a shadow root, so it works on a page with no framework
and does not touch the page's own styles.

## Use (no build step)

Every StandMeet instance serves this package itself. Add, on any page:

```html
<script src="https://your-instance.example/embed.js" defer></script>

<standmeet-chat base-url="https://your-instance.example" mode="public"></standmeet-chat>
```

| attribute | what it does |
|---|---|
| `base-url` | the StandMeet instance the chat talks to (required) |
| `mode="public"` | answer anonymous visitors on the owner's public tier |
| `code` | open the chat with an access code |
| `embed` `kid` `key` | open it with an embed token issued in the instance's admin (Embeds) |
| `layout` | `inline` (default), `rail` or `dock` |
| `lang` | the chat's own copy language (defaults to the page's `<html lang>`) |
| `placeholder` | the ask box's placeholder |

## Use (from npm)

```sh
npm i @standmeet/embed
```

```ts
import '@standmeet/embed'; // registers <standmeet-chat>
```

`@standmeet/embed/loader` is the small loader the `<script>` above is.

Because React is bundled in, a React page gets a second copy of React for this element. On a React
site, use `@standmeet/sdk` instead.

## Versioning

Versions follow the StandMeet instance's release tags (`v0.1.130` → `0.1.130`).

## License

MIT
