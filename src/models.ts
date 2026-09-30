/** Values stored in the corresponding PostgreSQL enum types. */
export type MemoryType = 'DECISION' | 'FAILURE' | 'CHANGE' | 'OBSERVATION' | 'HANDOFF';
export type ConfidenceClass = 'OBSERVED' | 'INFERRED' | 'SUGGESTED';
export type MemoryStatus = 'ACTIVE' | 'SUPERSEDED' | 'INVALIDATED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Phase {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  /** pgvector text format, e.g. "[0.1,0.2,...]"; vector size is intentionally flexible. */
  embedding: string | null;
  confidence_class: ConfidenceClass;
  confidence_score: number;
  status: MemoryStatus;
  created_at: Date;
  invalidated_at: Date | null;
  invalidated_by: string | null;
  superseded_by: string | null;
  task_id: string | null;
  semantic_hash: string | null;
  hit_count: number;
  last_seen_at: Date;
  causal_parents: string[];
}
