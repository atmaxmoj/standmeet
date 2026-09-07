# microsite-store — a page keeps its own data, and only its own

- **Module:** Each microsite gets a persistence store of its own, so a page can hold a poll, a sign-up list or a tally without the instance modelling any of them. A visitor writes to it only after the owner opens that page for writing. One page's data is unreachable from another.
- **Surface:** The public endpoint `/api/v1/pages/<slug>/store`, the SDK's `usePageStore` inside a built page, and the owner's write toggle.
- **Real dep:** The prod stack with its real database. A built page that reads and writes its own store, so the visitor path is the SDK's rather than a hand-made request.
- **Exclusive:** none
- **Backing e2e:** `microsite-store-admin` · `microsite-store-isolation` · `microsite-admin-authoring`.
- **Note:** The size cap and the unknown-slug refusal are hardening with nothing to look at; their spec covers them and they are not checks here.

## Checks

### 1 — A page refuses writes until its owner opens it ⭐
- **Steps:** As a visitor, write a document to a page whose store the owner has not opened. Then have the owner turn writing on and write again.
- **Expected:** The first write is refused and says so. The second lands and is readable.
- **Backing test:** `microsite-store-isolation.spec.ts`

### 2 — One page's data never appears in another's ⭐
- **Steps:** Write a document with a distinctive value into page A's store. Read page B's store, by every collection name A used.
- **Expected:** B returns nothing of A's. The value appears under A alone.
- **Mock gap:** Isolation is a property of how the store is partitioned in the real database; a fixture holding one map per page cannot fail this.
- **Backing test:** `microsite-store-isolation.spec.ts`

### 3 — Deleting a page takes its store with it
- **Steps:** Write to a page's store, then delete the page. Read that store again.
- **Expected:** The store is gone rather than empty-but-present, and the read says the page does not exist.
- **Backing test:** `microsite-store-isolation.spec.ts`

### 4 — A visitor's write shows on the page itself
- **Steps:** Open a built page that uses `usePageStore`, submit whatever it collects, and reload.
- **Expected:** The submission is on the page after the reload, for the next visitor as well as for this one.
- **Backing test:** `microsite-store-admin.spec.ts`

### 5 — The owner can read and clear what a page collected
- **Steps:** From the owner's side, list a page's documents, delete one, and clear the collection.
- **Expected:** Each action is reflected on the page's own surface afterwards.
- **Backing test:** `microsite-store-admin.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The write toggle's label must say what it opens: a page that says writing is off while a visitor's submission lands is the defect this module exists for.

The owner's document list and the page's own rendering are two views of one store — name any document present in one and not the other.

Every affordance that collects something must show the visitor what happened: a submit that stores the document while the page says nothing is indistinguishable from one that dropped it.
