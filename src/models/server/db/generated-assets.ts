import type { Generation, GenerationRecord } from '../../generation.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ModelError } from '../../errors.ts';
import { generationIdentity } from '../../generation.ts';

function database<T>(run: (db: DatabaseSync) => T): T {
  // ponytail: a single Node host with persistent disk; use a shared DB before scaling replicas.
  const dir = resolve(process.env.AI_DATA_DIR || '.data/ai');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dir, 'generations.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, request TEXT NOT NULL, record TEXT NOT NULL)');
    return run(db);
  }
  finally {
    db.close();
  }
}

export function reserveGeneration(input: Generation) {
  return database((db) => {
    const now = new Date().toISOString();
    const record: GenerationRecord = { ...input, status: 'submitting', createdAt: now, updatedAt: now };
    const request = JSON.stringify(input);
    const inserted = db.prepare('INSERT OR IGNORE INTO generations VALUES (?, ?, ?)').run(input.id, request, JSON.stringify(record));
    const saved = db.prepare('SELECT request, record FROM generations WHERE id = ?').get(input.id)!;
    if (generationIdentity(JSON.parse(saved.record as string) as GenerationRecord) !== generationIdentity(input))
      throw new ModelError('conflict', 'This id belongs to a different request');
    return { created: inserted.changes === 1, record: JSON.parse(saved.record as string) as GenerationRecord };
  });
}

export function readGeneration(id: string): GenerationRecord | undefined {
  return database((db) => {
    const row = db.prepare('SELECT record FROM generations WHERE id = ?').get(id);
    return row ? JSON.parse(row.record as string) as GenerationRecord : undefined;
  });
}

export function updateGeneration(id: string, patch: Partial<Pick<GenerationRecord, 'status' | 'providerJobId' | 'result'>>) {
  return database((db) => {
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT record FROM generations WHERE id = ?').get(id);
    if (!row)
      throw new ModelError('not_found', 'Generation not found');
    const previous = JSON.parse(row.record as string) as GenerationRecord;
    // Concurrent polls must not regress a terminal result.
    const record = ['completed', 'failed'].includes(previous.status) ? previous : { ...previous, ...patch, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE generations SET record = ? WHERE id = ?').run(JSON.stringify(record), id);
    db.exec('COMMIT');
    return record;
  });
}
