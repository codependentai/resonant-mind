# Alternative embedding providers

Resonant Mind v4 stores 768-dimensional embeddings in Postgres using pgvector. The default provider is Gemini, implemented in `src/embeddings.ts`.

An alternative provider must preserve these contracts:

1. Return a finite numeric vector of the configured dimension.
2. Support text embedding for observations, journals, entities, and queries.
3. Either support image-plus-context embedding or provide an explicit text-only fallback.
4. Use the same model for stored vectors and retrieval queries.
5. Re-embed existing rows when dimensions or vector spaces change.

## Changing dimensions

Changing dimensions is a schema migration, not a configuration toggle:

1. Back up Postgres.
2. Create a replacement vector column or table with the new dimension.
3. Re-embed every source row.
4. Validate row counts and retrieval quality.
5. Build a new HNSW index.
6. Switch reads only after validation.
7. Remove the old vectors in a later contract migration.

Never reinterpret vectors produced by one model as though another model created them.
