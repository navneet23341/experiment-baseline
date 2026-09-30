exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('task_status', [
    'TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]);
  pgm.addColumn('tasks', {
    status: { type: 'task_status', notNull: true, default: 'TODO' },
  });
  pgm.createIndex('tasks', ['status']);

  pgm.createTable('handoffs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    task_id: { type: 'uuid', notNull: true, references: 'tasks', onDelete: 'CASCADE' },
    completed_items: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    remaining_items: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    current_issue: { type: 'text' },
    next_action: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('handoffs', ['task_id', 'created_at']);
  pgm.addConstraint('handoffs', 'handoffs_completed_items_array', {
    check: "jsonb_typeof(completed_items) = 'array'",
  });
  pgm.addConstraint('handoffs', 'handoffs_remaining_items_array', {
    check: "jsonb_typeof(remaining_items) = 'array'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('handoffs');
  pgm.dropIndex('tasks', ['status']);
  pgm.dropColumn('tasks', 'status');
  pgm.dropType('task_status');
};
