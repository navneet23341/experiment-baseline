exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex(
    'memories',
    ['task_id', 'type', 'semantic_hash'],
    {
      name: 'memories_active_task_semantic_hash_unique',
      unique: true,
      where: "task_id IS NOT NULL AND semantic_hash IS NOT NULL AND status = 'ACTIVE' AND type IN ('FAILURE', 'OBSERVATION')",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex('memories', ['task_id', 'type', 'semantic_hash'], {
    name: 'memories_active_task_semantic_hash_unique',
  });
};
