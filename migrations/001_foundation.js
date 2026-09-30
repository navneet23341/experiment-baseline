/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('vector', { ifNotExists: true });

  pgm.createType('memory_type', [
    'DECISION', 'FAILURE', 'CHANGE', 'OBSERVATION', 'HANDOFF',
  ]);
  pgm.createType('confidence_class', ['OBSERVED', 'INFERRED', 'SUGGESTED']);
  pgm.createType('memory_status', ['ACTIVE', 'SUPERSEDED', 'INVALIDATED']);

  pgm.createTable('projects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('phases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid', notNull: true, references: 'projects', onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    position: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('phases', ['project_id', 'position']);

  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid', notNull: true, references: 'projects', onDelete: 'CASCADE',
    },
    phase_id: { type: 'uuid', references: 'phases', onDelete: 'SET NULL' },
    title: { type: 'text', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('tasks', ['project_id']);
  pgm.createIndex('tasks', ['phase_id']);

  pgm.createTable('memories', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    type: { type: 'memory_type', notNull: true },
    content: { type: 'text', notNull: true },
    embedding: { type: 'vector' },
    confidence_class: { type: 'confidence_class', notNull: true },
    confidence_score: { type: 'real', notNull: true },
    status: { type: 'memory_status', notNull: true, default: 'ACTIVE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    invalidated_at: { type: 'timestamptz' },
    invalidated_by: { type: 'uuid', references: 'memories', onDelete: 'SET NULL' },
    superseded_by: { type: 'uuid', references: 'memories', onDelete: 'SET NULL' },
    task_id: { type: 'uuid', references: 'tasks', onDelete: 'SET NULL' },
    semantic_hash: { type: 'text' },
    hit_count: { type: 'integer', notNull: true, default: 1 },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    causal_parents: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
  });
  pgm.addConstraint('memories', 'memories_confidence_score_range', {
    check: 'confidence_score >= 0 AND confidence_score <= 1',
  });
  pgm.addConstraint('memories', 'memories_hit_count_positive', { check: 'hit_count >= 1' });
  pgm.addConstraint('memories', 'memories_not_self_superseded', {
    check: 'superseded_by IS NULL OR superseded_by <> id',
  });
  pgm.addConstraint('memories', 'memories_not_self_invalidated', {
    check: 'invalidated_by IS NULL OR invalidated_by <> id',
  });
  pgm.createIndex('memories', ['task_id']);
  pgm.createIndex('memories', ['status']);
  pgm.createIndex('memories', ['semantic_hash']);
};

exports.down = (pgm) => {
  pgm.dropTable('memories');
  pgm.dropTable('tasks');
  pgm.dropTable('phases');
  pgm.dropTable('projects');
  pgm.dropType('memory_status');
  pgm.dropType('confidence_class');
  pgm.dropType('memory_type');
  // Keep the shared pgvector extension installed; other schemas may use it.
};
