import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { pool } from '../src/db/pool';
import {
  createMemory, deleteMemory, getMemory, listMemories, semanticHash, supersedeMemory, updateMemory,
} from '../src/memory-store';
import {
  createHandoff, createPhase, createProject, createTask, deletePhase, deleteProject, deleteTask, getLatestHandoff,
  getPhase, getProject, getTask, listPhases, listTasks, taskTransitions, transitionTask,
  updatePhase, updateProject, updateTask,
} from '../src/lifecycle';

const projectIds: string[] = [];
after(async () => {
  for (const id of projectIds) await deleteProject(id);
  await pool.end();
});

test('memory CRUD, active task deduplication, and manual supersession', async () => {
  const project = await createProject({ name: `memory test ${Date.now()}` });
  projectIds.push(project.id);
  const task = await createTask({ project_id: project.id, title: 'dedup test' });
  const base = {
    type: 'FAILURE' as const,
    content: 'The build fails on missing dependency',
    confidence_class: 'OBSERVED' as const,
    confidence_score: 0.9,
    task_id: task.id,
  };
  const first = await createMemory(base);
  const duplicates = await Promise.all(Array.from({ length: 8 }, () =>
    createMemory({ ...base, content: '  THE BUILD FAILS ON MISSING DEPENDENCY  ' }),
  ));
  assert.equal(first.deduplicated, false);
  assert.ok(duplicates.every((item) => item.deduplicated));
  assert.ok(duplicates.every((item) => item.memory.id === first.memory.id));
  assert.equal((await getMemory(first.memory.id))?.hit_count, 9);
  assert.equal(duplicates[0].memory.semantic_hash, semanticHash(base.content));

  const distinct = await createMemory({ ...base, content: 'The build fails because dependency resolution cannot find package xyz' });
  assert.equal(distinct.deduplicated, false);
  assert.notEqual(distinct.memory.id, first.memory.id);
  const otherTask = await createTask({ project_id: project.id, title: 'separate task' });
  const separateTaskMemory = await createMemory({ ...base, task_id: otherTask.id });
  assert.equal(separateTaskMemory.deduplicated, false);
  const observation = await createMemory({ ...base, type: 'OBSERVATION', content: 'The build log contains a warning' });
  const repeatedObservation = await createMemory({ ...base, type: 'OBSERVATION', content: ' THE BUILD LOG CONTAINS A WARNING ' });
  assert.equal(repeatedObservation.memory.id, observation.memory.id);
  assert.equal(repeatedObservation.memory.hit_count, 2);

  const replacement = await createMemory({ ...base, type: 'DECISION', content: 'Pin the missing dependency' });
  const superseded = await supersedeMemory(first.memory.id, replacement.memory.id);
  assert.equal(superseded?.status, 'SUPERSEDED');
  assert.equal(superseded?.superseded_by, replacement.memory.id);
  const afterSupersession = await createMemory(base);
  assert.equal(afterSupersession.deduplicated, false);
  assert.notEqual(afterSupersession.memory.id, first.memory.id);

  const updated = await updateMemory(replacement.memory.id, { content: 'Pin the dependency version' });
  assert.equal(updated?.content, 'Pin the dependency version');
  assert.equal((await getMemory(replacement.memory.id))?.content, 'Pin the dependency version');
  assert.ok((await listMemories({ task_id: task.id })).length >= 2);
  assert.equal(await deleteMemory(replacement.memory.id), true);
  assert.equal(await getMemory(replacement.memory.id), null);
});

test('project, phase, task CRUD; legal transitions; and structured handoff', async () => {
  assert.deepEqual(taskTransitions.TODO, ['IN_PROGRESS', 'CANCELLED']);
  const project = await createProject({ name: `lifecycle test ${Date.now()}`, description: 'initial' });
  projectIds.push(project.id);
  assert.equal((await getProject(project.id))?.name, project.name);
  assert.equal((await updateProject(project.id, { description: 'updated' }))?.description, 'updated');

  const phase = await createPhase({ project_id: project.id, name: 'Build', position: 1 });
  assert.equal((await getPhase(phase.id))?.name, 'Build');
  assert.equal((await listPhases(project.id)).length, 1);
  assert.equal((await updatePhase(phase.id, { position: 2 }))?.position, 2);

  const task = await createTask({ project_id: project.id, phase_id: phase.id, title: 'Implement' });
  assert.equal(task.status, 'TODO');
  assert.equal((await getTask(task.id))?.id, task.id);
  assert.equal((await listTasks(project.id)).length, 1);
  assert.equal((await updateTask(task.id, { title: 'Implement foundation' }))?.title, 'Implement foundation');
  assert.equal((await transitionTask(task.id, 'IN_PROGRESS'))?.status, 'IN_PROGRESS');
  await assert.rejects(() => transitionTask(task.id, 'TODO'), /Illegal task transition/);
  assert.equal((await transitionTask(task.id, 'COMPLETED'))?.status, 'COMPLETED');
  await assert.rejects(() => transitionTask(task.id, 'IN_PROGRESS'), /Illegal task transition/);

  const handoff = await createHandoff(task.id, {
    completed_items: ['Schema applied'],
    remaining_items: ['Wire API'],
    current_issue: 'No HTTP routes yet',
    next_action: 'Add route handlers',
  });
  const latest = await getLatestHandoff(task.id);
  assert.equal(latest?.id, handoff.id);
  assert.deepEqual(latest?.completed_items, ['Schema applied']);
  assert.deepEqual(latest?.remaining_items, ['Wire API']);
  assert.equal(latest?.next_action, 'Add route handlers');

  const retryTask = await createTask({ project_id: project.id, title: 'Retry path' });
  assert.equal((await transitionTask(retryTask.id, 'IN_PROGRESS'))?.status, 'IN_PROGRESS');
  assert.equal((await transitionTask(retryTask.id, 'BLOCKED'))?.status, 'BLOCKED');
  assert.equal((await transitionTask(retryTask.id, 'IN_PROGRESS'))?.status, 'IN_PROGRESS');
  assert.equal((await transitionTask(retryTask.id, 'FAILED'))?.status, 'FAILED');
  assert.equal((await transitionTask(retryTask.id, 'TODO'))?.status, 'TODO');
  assert.equal((await transitionTask(retryTask.id, 'IN_PROGRESS'))?.status, 'IN_PROGRESS');
  assert.equal((await transitionTask(retryTask.id, 'FAILED'))?.status, 'FAILED');
  assert.equal((await transitionTask(retryTask.id, 'CANCELLED'))?.status, 'CANCELLED');
  await assert.rejects(() => transitionTask(retryTask.id, 'TODO'), /Illegal task transition/);

  assert.equal(await deletePhase(phase.id), true);
  assert.equal(await getPhase(phase.id), null);
  assert.equal((await getTask(task.id))?.phase_id, null);
  assert.equal(await deleteTask(task.id), true);
  assert.equal(await getTask(task.id), null);
  assert.equal(await getLatestHandoff(task.id), null);
});
