import { pool } from './db/pool';
import type { Phase, Project, Task, TaskStatus } from './models';

export type { TaskStatus } from './models';

export const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  CANCELLED: [],
};

export interface Handoff {
  id: string;
  task_id: string;
  completed_items: string[];
  remaining_items: string[];
  current_issue: string | null;
  next_action: string;
  created_at: Date;
}

export interface HandoffInput {
  completed_items: string[];
  remaining_items: string[];
  current_issue?: string | null;
  next_action: string;
}

export async function createProject(input: { name: string; description?: string | null }): Promise<Project> {
  const result = await pool.query<Project>(
    'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *',
    [input.name, input.description ?? null],
  );
  return result.rows[0];
}

export async function getProject(id: string): Promise<Project | null> {
  const result = await pool.query<Project>('SELECT * FROM projects WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function updateProject(id: string, patch: { name?: string; description?: string | null }): Promise<Project | null> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return getProject(id);
  const values: unknown[] = [];
  const assignments = keys.map((key) => {
    values.push(patch[key]);
    return `${key} = $${values.length}`;
  });
  assignments.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<Project>(
    `UPDATE projects SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`, values,
  );
  return result.rows[0] ?? null;
}

export async function deleteProject(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function createPhase(input: {
  project_id: string; name: string; description?: string | null; position?: number;
}): Promise<Phase> {
  const result = await pool.query<Phase>(
    `INSERT INTO phases (project_id, name, description, position)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.project_id, input.name, input.description ?? null, input.position ?? 0],
  );
  return result.rows[0];
}

export async function getPhase(id: string): Promise<Phase | null> {
  const result = await pool.query<Phase>('SELECT * FROM phases WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listPhases(projectId: string): Promise<Phase[]> {
  const result = await pool.query<Phase>(
    'SELECT * FROM phases WHERE project_id = $1 ORDER BY position, created_at', [projectId],
  );
  return result.rows;
}

export async function updatePhase(id: string, patch: {
  name?: string; description?: string | null; position?: number;
}): Promise<Phase | null> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return getPhase(id);
  const values: unknown[] = [];
  const assignments = keys.map((key) => {
    values.push(patch[key]);
    return `${key} = $${values.length}`;
  });
  assignments.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<Phase>(
    `UPDATE phases SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`, values,
  );
  return result.rows[0] ?? null;
}

export async function deletePhase(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM phases WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

async function ensurePhaseBelongsToProject(phaseId: string | null | undefined, projectId: string): Promise<void> {
  if (!phaseId) return;
  const result = await pool.query('SELECT 1 FROM phases WHERE id = $1 AND project_id = $2', [phaseId, projectId]);
  if (!result.rowCount) throw new Error('Phase does not belong to the specified project');
}

export async function createTask(input: {
  project_id: string; phase_id?: string | null; title: string; description?: string | null;
}): Promise<Task> {
  await ensurePhaseBelongsToProject(input.phase_id, input.project_id);
  const result = await pool.query<Task>(
    `INSERT INTO tasks (project_id, phase_id, title, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.project_id, input.phase_id ?? null, input.title, input.description ?? null],
  );
  return result.rows[0];
}

export async function getTask(id: string): Promise<Task | null> {
  const result = await pool.query<Task>('SELECT * FROM tasks WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listTasks(projectId: string): Promise<Task[]> {
  const result = await pool.query<Task>(
    'SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at, id', [projectId],
  );
  return result.rows;
}

export async function updateTask(id: string, patch: {
  phase_id?: string | null; title?: string; description?: string | null;
}): Promise<Task | null> {
  const current = await getTask(id);
  if (!current) return null;
  const projectId = current.project_id;
  if (Object.hasOwn(patch, 'phase_id')) await ensurePhaseBelongsToProject(patch.phase_id, projectId);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return current;
  const values: unknown[] = [];
  const assignments = keys.map((key) => {
    values.push(patch[key]);
    return `${key} = $${values.length}`;
  });
  assignments.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<Task>(
    `UPDATE tasks SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`, values,
  );
  return result.rows[0] ?? null;
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function transitionTask(id: string, next: TaskStatus): Promise<Task | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query<Task>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [id]);
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }
    if (!taskTransitions[current.status as TaskStatus].includes(next)) {
      throw new Error(`Illegal task transition: ${current.status} -> ${next}`);
    }
    const result = await client.query<Task>(
      'UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, next],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createHandoff(taskId: string, input: HandoffInput): Promise<Handoff> {
  const result = await pool.query<Handoff>(
    `INSERT INTO handoffs (task_id, completed_items, remaining_items, current_issue, next_action)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5) RETURNING *`,
    [taskId, JSON.stringify(input.completed_items), JSON.stringify(input.remaining_items), input.current_issue ?? null, input.next_action],
  );
  return result.rows[0];
}

export async function getLatestHandoff(taskId: string): Promise<Handoff | null> {
  const result = await pool.query<Handoff>(
    'SELECT * FROM handoffs WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [taskId],
  );
  return result.rows[0] ?? null;
}
