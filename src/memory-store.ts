import { createHash } from 'node:crypto';
import { pool } from './db/pool';
import type { ConfidenceClass, Memory, MemoryStatus, MemoryType } from './models';

export interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  confidence_class: ConfidenceClass;
  confidence_score: number;
  task_id?: string | null;
  embedding?: string | null;
  causal_parents?: string[];
}

export type MemoryPatch = Partial<Pick<Memory,
  'type' | 'content' | 'embedding' | 'confidence_class' | 'confidence_score' |
  'status' | 'invalidated_at' | 'invalidated_by' | 'superseded_by' | 'task_id' | 'causal_parents'>>;

export interface CreateMemoryResult {
  memory: Memory;
  deduplicated: boolean;
}

/** Fold case and Unicode variants and collapse whitespace, retaining punctuation and wording. */
export function normalizeMemoryContent(content: string): string {
  return content.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

export function semanticHash(content: string): string {
  return createHash('sha256').update(normalizeMemoryContent(content), 'utf8').digest('hex');
}

export async function createMemory(input: CreateMemoryInput): Promise<CreateMemoryResult> {
  const canDeduplicate = input.task_id != null &&
    (input.type === 'FAILURE' || input.type === 'OBSERVATION');
  const hash = canDeduplicate ? semanticHash(input.content) : null;
  const values = [
    input.type, input.content, input.embedding ?? null, input.confidence_class,
    input.confidence_score, input.task_id ?? null, hash, input.causal_parents ?? [],
  ];

  if (canDeduplicate) {
    const result = await pool.query<Memory>(
      `INSERT INTO memories
         ("type", content, embedding, confidence_class, confidence_score, task_id, semantic_hash, causal_parents)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8::uuid[])
       ON CONFLICT (task_id, "type", semantic_hash)
         WHERE task_id IS NOT NULL AND semantic_hash IS NOT NULL
           AND status = 'ACTIVE' AND "type" IN ('FAILURE', 'OBSERVATION')
       DO UPDATE SET hit_count = memories.hit_count + 1, last_seen_at = now()
       RETURNING *`, values,
    );
    const memory = result.rows[0];
    return { memory, deduplicated: memory.hit_count > 1 };
  }

  const result = await pool.query<Memory>(
    `INSERT INTO memories
       ("type", content, embedding, confidence_class, confidence_score, task_id, semantic_hash, causal_parents)
     VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8::uuid[])
     RETURNING *`, values,
  );
  return { memory: result.rows[0], deduplicated: false };
}

export async function getMemory(id: string): Promise<Memory | null> {
  const result = await pool.query<Memory>('SELECT * FROM memories WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listMemories(options: {
  task_id?: string;
  status?: MemoryStatus;
  limit?: number;
} = {}): Promise<Memory[]> {
  const result = await pool.query<Memory>(
    `SELECT * FROM memories
     WHERE ($1::uuid IS NULL OR task_id = $1)
       AND ($2::memory_status IS NULL OR status = $2)
     ORDER BY created_at, id
     LIMIT $3`,
    [options.task_id ?? null, options.status ?? null, options.limit ?? 100],
  );
  return result.rows;
}

const patchColumns: Record<keyof MemoryPatch, string> = {
  type: '"type"', content: 'content', embedding: 'embedding',
  confidence_class: 'confidence_class', confidence_score: 'confidence_score',
  status: 'status', invalidated_at: 'invalidated_at', invalidated_by: 'invalidated_by',
  superseded_by: 'superseded_by', task_id: 'task_id', causal_parents: 'causal_parents',
};

export async function updateMemory(id: string, patch: MemoryPatch): Promise<Memory | null> {
  const entries = Object.entries(patch) as [keyof MemoryPatch, MemoryPatch[keyof MemoryPatch]][];
  if (entries.length === 0) return getMemory(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<Memory>('SELECT * FROM memories WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const merged = { ...current.rows[0], ...patch };
    const nextHash = (merged.task_id && (merged.type === 'FAILURE' || merged.type === 'OBSERVATION'))
      ? semanticHash(merged.content)
      : null;
    const values: unknown[] = [];
    const assignments = entries.map(([key, value]) => {
      values.push(value);
      const cast = key === 'embedding' ? '::vector' : key === 'causal_parents' ? '::uuid[]' : '';
      return `${patchColumns[key]} = $${values.length}${cast}`;
    });
    if (entries.some(([key]) => key === 'content' || key === 'type' || key === 'task_id')) {
      values.push(nextHash);
      assignments.push(`semantic_hash = $${values.length}`);
    }
    values.push(id);
    const updated = await client.query<Memory>(
      `UPDATE memories SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`, values,
    );
    await client.query('COMMIT');
    return updated.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMemory(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM memories WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function supersedeMemory(oldId: string, replacementId: string): Promise<Memory | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const oldResult = await client.query<Memory>('SELECT * FROM memories WHERE id = $1 FOR UPDATE', [oldId]);
    const replacementResult = await client.query<Memory>('SELECT * FROM memories WHERE id = $1', [replacementId]);
    if (!oldResult.rows[0] || !replacementResult.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    if (oldId === replacementId) throw new Error('A memory cannot supersede itself');
    if (oldResult.rows[0].status !== 'ACTIVE' || replacementResult.rows[0].status !== 'ACTIVE') {
      throw new Error('Both memories must be ACTIVE to record supersession');
    }
    const updated = await client.query<Memory>(
      `UPDATE memories SET status = 'SUPERSEDED', superseded_by = $2 WHERE id = $1 RETURNING *`,
      [oldId, replacementId],
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
