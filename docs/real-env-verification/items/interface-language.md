# interface-language — the product speaks the reader's language, on both sides of the door

- **Module:** The interface is available in several languages. A visitor's choice lives in the address, so a link opens in the language it was shared in. The owner switches the admin from the chrome, and the switch changes the interface rather than only the address.
- **Surface:** The language switch in the public top bar and in the admin top bar; every admin section and every visitor surface under a locale prefix.
- **Real dep:** none
- **Exclusive:** none
- **Backing e2e:** `ui-locale-in-url` · `owner-locale-switch` · `admin-nav-i18n` · `corpus-i18n-reader` · `writing-i18n-reader`.

## Checks

### 1 — The visitor's language is in the address, and a shared link keeps it ⭐
- **Steps:** Open a visitor surface, switch to another language from the top bar, and copy the address. Open that address in a browser that has never visited.
- **Expected:** The address carries the language, and the fresh browser renders that language without being asked again.
- **Backing test:** `ui-locale-in-url.spec.ts`

### 2 — Switching the admin language changes the interface ⭐
- **Steps:** From the admin top bar, switch language. Read the sidebar, a section heading, a table's column labels and a confirmation dialog.
- **Expected:** All of them are in the chosen language. None shows a key path, and none stays in the previous language.
- **Mock gap:** The key-parity gate proves every message exists in every catalogue. Whether the running interface reaches those messages is a different question, and only reading the screen answers it.
- **Backing test:** `owner-locale-switch.spec.ts` · `admin-nav-i18n.spec.ts`

### 3 — Every admin section is translated, not only the nav
- **Steps:** In a non-default language, open each admin section in turn and read the whole screen, including empty states, error text and the units on numbers.
- **Expected:** No English left in a translated locale, and no raw key. A number's unit and a schedule's interval read as language, not as a format string.
- **Backing test:** `admin-nav-i18n.spec.ts`

### 4 — A multilingual corpus entry serves one language at a time
- **Steps:** Open an entry that carries several languages, then ask for another one.
- **Expected:** Only the requested language is in the page. The others are absent rather than hidden, and a link inside the prose carries the choice onward.
- **Backing test:** `corpus-i18n-reader.spec.ts` · `writing-i18n-reader.spec.ts`

### 5 — The chosen language survives the next click
- **Steps:** Pick a language, then navigate: entry to entry, section to section, and through a full page load.
- **Expected:** The language holds across all three. It is not reset by a navigation that happens to reload.
- **Backing test:** `corpus-i18n-reader.spec.ts` · `owner-locale-switch.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read one whole screen in a language you do not use daily: anything still in English, and any label that reads as a key path, is what this module exists to catch.

The address and the rendered language are two views of one choice — say which disagrees when they do.

Every language a switcher offers must be reachable and complete: an option that changes the address without changing the words, and one that changes some of the words, are the same defect at different depths.
