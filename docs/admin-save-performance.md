# Admin catalog save latency

Reviewed against `6f7ebc6` (main). The repository uses Next.js Server Actions,
Drizzle and PostgreSQL, rather than Laravel controllers/observers.

## Findings and changes

| Reported area | Repository evidence | Change / decision |
| --- | --- | --- |
| Image compression and upload block the save controller | `lib/storage/upload-client.ts` compresses in the browser and uploads directly to R2 before calling the save action. Upload signing is already batched. | Retain the direct upload path; a server queue cannot eliminate the browser's initial transfer. Measure upload and save separately. |
| External work after product save | `removeObjects` and main-image palette extraction already use `next/server.after` through `runAfterResponse`. | No new external call in the request path. This remains best-effort execution, **not a durable retry queue**. |
| Sequential relation writes | Category saves upserted every subcategory individually, including unchanged rows. Product images, colors and variants were already batched. | Diff subcategories, skip unchanged rows, and upsert changed rows in batches of at most 250. Existing IDs, ordering and last-duplicate-slug-wins behavior are preserved. Serialize category edits with a `FOR NO KEY UPDATE` lock, which permits foreign-key key-share locks. |
| Repeated search rebuild | Every category edit rebuilt every product's search text, even image/description/order-only edits. The shared indexer issued one update per product. | Rebuild only on category/subcategory name changes or subcategory removal. Read products using keyset pages of 250, load colors per page, and issue one parameterized `UPDATE ... FROM (VALUES ...)` per page. Skip row writes when search text is unchanged. Brand rename and catalog import also benefit from the shared indexer. |
| Unindexed catalog foreign keys | Category, subcategory, brand, product-image, product-color and product-variant lookup indexes exist in checked-in migrations. | No duplicate indexes added. Production migration application and actual query plans still require verification. |
| Cache/listener delays | Catalog actions explicitly invalidate Next.js cache tags/paths. No Laravel model observers or external search/push listener calls were found in these save paths. | Keep immediate invalidation and transactional category search consistency. No asynchronous listener migration was made. |

Search still participates in the category transaction when names or links change.
Batching reduces network round trips; it does **not** make large-category rename
work constant-time or release locks between pages. Metadata-only edits avoid that
work entirely. Existing product stock locking and delta handling are unchanged.

## Reproducible checks

- `tests/manage-actions.test.ts`: 251 subcategories require two insert/upsert
  statements instead of 251; unchanged subcategories cause no relation writes or
  product-search reads. Renames retain subcategory IDs, removals clear product
  links and search terms, and a failed index write rolls back the category edit.
- `tests/search-index.test.ts`: 501 products require three update statements
  instead of 501 (nine indexer statements overall instead of 503). All searchable
  fields, Arabic normalization, color ordering, prices and stock are checked.
  A database audit trigger verifies that repeating an unchanged refresh causes
  no product-row writes. Explicit-ID, category, brand, all-product and empty
  scopes and the exact page boundary are covered.

These are query-count and correctness checks on PGlite, not production latency
measurements or concurrent PostgreSQL lock tests. No production database was used.

## Deployment verification

No new schema migration, dependency, queue worker or environment variable is
required for this patch. Review and deploy it through the normal application flow.

1. In the browser Network panel, measure compression/upload, signing, the save
   Server Action, and the resulting page refresh separately. Compare saves with
   no image change, one replacement image, and multiple gallery images.
2. In staging, compare category metadata edits and renames at representative
   product counts. Record p50/p95 action duration, query count and transaction
   duration before and after, with the same database region and pool settings.
3. Check that the production schema contains the migration-defined indexes:

   ```sql
   SELECT tablename, indexname, indexdef
   FROM pg_indexes
   WHERE schemaname = 'store'
     AND tablename IN ('products', 'subcategories', 'product_images',
                       'product_colors', 'product_variants')
   ORDER BY tablename, indexname;
   ```

   Expected leading columns: `products(category_id, sort_order)`,
   `products(subcategory_id)`, `products(brand_id)`,
   `subcategories(category_id, slug)` (unique),
   `product_images(product_id, sort_order)`,
   `product_colors(product_id, sort_order)`, and
   `product_variants(product_id, color, size)` (unique).
4. If latency remains, inspect read-only `pg_stat_activity` wait events and
   `pg_blocking_pids(pid)` during a representative save. Check pool saturation
   and application/database region distance before adding indexes or workers.

## Durable background processing is a separate deployment change

The proposed queue migration is not implemented by this patch. If large-category
renames remain slow or guaranteed media retries are required, use a transactional
outbox: write the entity and job in the same transaction, then let an authenticated
worker claim bounded batches with leases, retries/backoff and failure reporting.
Search jobs must read current data and protect against overwriting newer product
edits; image-palette jobs must check that their image key is still current.
Invalidate search caches after successful processing, and expose pending/failed
processing status. Confirm worker hosting and scheduling before changing save
semantics to eventual consistency. Merely moving search to `after()` would not
supply durability, retries, or that status contract.
