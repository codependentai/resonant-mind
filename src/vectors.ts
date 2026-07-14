/**
 * pgvector Adapter — Vectorize-compatible interface backed by Postgres
 *
 * Wraps pgvector SQL in .upsert() and .query() matching VectorizeIndex shape.
 * Vectors stored in the `embeddings` table alongside all relational data.
 */

import { Client } from "pg";

interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface VectorQueryResult {
  matches: VectorMatch[];
}

interface VectorUpsertItem {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Parse source_type and source_id from vector ID patterns:
 * entity-{id}, obs-{entity_id}-{obs_id}, journal-{id}, img-{id}
 */
function parseVectorId(id: string): {
  sourceType: string;
  sourceId: number;
} {
  if (id.startsWith("entity-")) {
    return { sourceType: "entity", sourceId: parseInt(id.split("-")[1]) };
  } else if (id.startsWith("obs-")) {
    const parts = id.split("-");
    return { sourceType: "observation", sourceId: parseInt(parts[2]) };
  } else if (id.startsWith("journal-")) {
    return { sourceType: "journal", sourceId: parseInt(id.split("-")[1]) };
  } else if (id.startsWith("img-")) {
    return { sourceType: "image", sourceId: parseInt(id.split("-")[1]) };
  }
  return { sourceType: "unknown", sourceId: 0 };
}

/** Format a number array as pgvector literal: [0.1,0.2,...] */
function toSql(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Create a Vectorize-compatible adapter backed by pgvector.
 * Connection goes through Hyperdrive (same pool as DB queries).
 */
export function createVectorAdapter(connectionString: string) {
  return {
    async upsert(items: VectorUpsertItem[]): Promise<void> {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        for (const item of items) {
          const { sourceType, sourceId } = parseVectorId(item.id);
          const content =
            (item.metadata?.content as string) ||
            (item.metadata?.description as string) ||
            "";
          await client.query(
            `INSERT INTO embeddings (id, source_type, source_id, embedding, content, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               embedding = EXCLUDED.embedding,
               content = EXCLUDED.content,
               metadata = EXCLUDED.metadata`,
            [
              item.id,
              sourceType,
              sourceId,
              toSql(item.values),
              content,
              JSON.stringify(item.metadata || {}),
            ]
          );
        }
      } finally {
        await client.end();
      }
    },

    // Review finding: this method was MISSING while three call
    // sites (dream-processing regen, legacy-tools/delete image branch,
    // store-image delete) called it inside swallowed try/catch — image and
    // dream embedding cleanup silently no-op'd since the pgvector migration.
    async deleteByIds(ids: string[]): Promise<void> {
      if (!ids.length) return;
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await client.query(`DELETE FROM embeddings WHERE id = ANY($1)`, [ids]);
      } finally {
        await client.end();
      }
    },

    async query(
      embedding: number[],
      options: { topK: number; returnMetadata?: string }
    ): Promise<VectorQueryResult> {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        const result = await client.query(
          `SELECT id, content, metadata,
                  1 - (embedding <=> $1) as score
           FROM embeddings
           ORDER BY embedding <=> $1
           LIMIT $2`,
          [toSql(embedding), options.topK]
        );

        return {
          matches: result.rows.map(
            (row: {
              id: string;
              score: string;
              metadata: string | Record<string, unknown>;
            }) => ({
              id: row.id,
              score: parseFloat(row.score),
              metadata:
                typeof row.metadata === "string"
                  ? JSON.parse(row.metadata)
                  : row.metadata || {},
            })
          ),
        };
      } finally {
        await client.end();
      }
    },
  };
}
