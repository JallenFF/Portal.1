/**
 * Portal Hub Server — v0.3.0
 * 
 * Sole SQLite writer. Localhost only. No auth (local app).
 * 
 * Endpoints:
 *   GET  /health              — alive check
 *   GET  /projects             — list all projects
 *   POST /projects             — create project
 *   GET  /projects/:id         — get project with nodes
 *   POST /ingest               — ingest file into vault + create node
 *   GET  /events               — query domain events
 *   POST /events               — write domain event
 *   GET  /positions/:layout    — get all positions for a layout
 *   PUT  /positions/:layout    — batch update positions for a layout
 *   GET  /diagnostics          — system diagnostic report
 *   GET  /diagnostics/events   — query system events
 * 
 * Not built yet (future phases):
 *   POST /sandbox/reset
 *   POST /triage/suggest
 *   GET  /entropy/:projectId
 */

import Fastify from 'fastify';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { SCHEMA_SQL } from '../../core/src/persistence';
import { ingestFile, buildVaultRecord, buildMetadataRecord, DEFAULT_VAULT_CONFIG } from '../../vault/src/vault';
import { getLogger, LogEntry } from './logger';

// ── Config ──────────────────────────────────────────────────

const PORTAL_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.portal');
const DB_PATH = path.join(PORTAL_DIR, 'portal.db');
const PORT = 3141; // pi, easy to remember

// ── Init ────────────────────────────────────────────────────

fs.mkdirSync(PORTAL_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA_SQL);

const logger = getLogger();

// Register DB writer for system events
logger.setDbWriter((entries: LogEntry[]) => {
  const stmt = db.prepare(`
    INSERT INTO system_events (level, category, message, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const batch = db.transaction((items: LogEntry[]) => {
    for (const e of items) {
      stmt.run(e.level, e.category, e.message, JSON.stringify(e.detail), e.timestamp);
    }
  });
  batch(entries);
});

// Build hash index for dedup
function loadHashIndex(): Map<string, string> {
  const rows = db.prepare('SELECT hash, id FROM vault_files').all() as Array<{ hash: string; id: string }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.hash, row.id);
  }
  return map;
}

let hashIndex = loadHashIndex();

logger.info('startup', 'Hub server initializing', {
  dbPath: DB_PATH,
  vaultDir: DEFAULT_VAULT_CONFIG.vaultDir,
  port: PORT,
});

// ── Fastify ─────────────────────────────────────────────────

const app = Fastify({ logger: false });

// ── Health ──────────────────────────────────────────────────

app.get('/health', async () => {
  return { status: 'ok', version: '0.3.0', uptime: process.uptime() };
});

// ── Projects ────────────────────────────────────────────────

app.get('/projects', async () => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  return { projects };
});

app.post('/projects', async (req) => {
  const { name, color } = req.body as { name: string; color?: string };
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO projects (id, name, color) VALUES (?, ?, ?)
  `).run(id, name, color || '#6B7280');

  logger.info('db', `Project created: ${name}`, { projectId: id });
  return { id, name, color: color || '#6B7280' };
});

app.get('/projects/:id', async (req) => {
  const { id } = req.params as { id: string };
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return { error: 'not found' };

  const nodes = db.prepare(`
    SELECT n.*, v.filename, v.ext, v.size_bytes, v.mime_type
    FROM nodes n
    LEFT JOIN vault_files v ON n.vault_id = v.id
    WHERE n.project_id = ?
    ORDER BY n.created_at DESC
  `).all(id);

  return { project, nodes };
});

// ── Ingest ──────────────────────────────────────────────────

app.post('/ingest', async (req) => {
  const { sourcePath, projectId, label } = req.body as {
    sourcePath: string;
    projectId?: string;
    label?: string;
  };

  try {
    // 1. Ingest file to vault
    const result = await ingestFile(sourcePath, DEFAULT_VAULT_CONFIG, hashIndex);

    if (!result.deduplicated) {
      // 2. Write vault_files row
      const vaultRecord = buildVaultRecord(sourcePath, result);
      db.prepare(`
        INSERT INTO vault_files (id, hash, filename, ext, size_bytes, source_path, mime_type, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vaultRecord.id, vaultRecord.hash, vaultRecord.filename, vaultRecord.ext,
        vaultRecord.size_bytes, vaultRecord.source_path, vaultRecord.mime_type,
        vaultRecord.ingested_at,
      );

      // 3. Write file_metadata row
      const metaRecord = buildMetadataRecord(sourcePath, result.vaultId);
      db.prepare(`
        INSERT INTO file_metadata (vault_id, file_created, file_modified, word_count, dimensions, extra)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        metaRecord.vault_id, metaRecord.file_created, metaRecord.file_modified,
        metaRecord.word_count, metaRecord.dimensions, metaRecord.extra,
      );

      // Update hash index
      hashIndex.set(result.hash, result.vaultId);
    }

    // 4. Create node
    const nodeId = crypto.randomUUID();
    const nodeLabel = label || path.basename(sourcePath);
    const ext = path.extname(sourcePath).slice(1).toLowerCase();

    db.prepare(`
      INSERT INTO nodes (id, project_id, label, type, vault_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(nodeId, projectId || null, nodeLabel, ext || 'file', result.vaultId);

    // 5. Emit event
    const sessionId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO events (session_id, type, entity_id, payload)
      VALUES (?, 'file_ingested', ?, ?)
    `).run(sessionId, nodeId, JSON.stringify({
      vaultId: result.vaultId,
      hash: result.hash,
      deduplicated: result.deduplicated,
      sourcePath,
      projectId: projectId || null,
    }));

    logger.info('ingest', `File ingested: ${nodeLabel}`, {
      nodeId,
      vaultId: result.vaultId,
      deduplicated: result.deduplicated,
      ext,
    });

    return {
      nodeId,
      vaultId: result.vaultId,
      deduplicated: result.deduplicated,
      label: nodeLabel,
    };
  } catch (err: any) {
    logger.error('ingest', `Ingest failed: ${err.message}`, { sourcePath });
    return { error: err.message };
  }
});

// ── Events ──────────────────────────────────────────────────

app.get('/events', async (req) => {
  const { type, session_id, entity_id, limit } = req.query as {
    type?: string;
    session_id?: string;
    entity_id?: string;
    limit?: string;
  };

  let sql = 'SELECT * FROM events WHERE 1=1';
  const params: any[] = [];

  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (session_id) { sql += ' AND session_id = ?'; params.push(session_id); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit || '100', 10));

  const events = db.prepare(sql).all(...params);
  return { events };
});

app.post('/events', async (req) => {
  const { session_id, type, entity_id, payload } = req.body as {
    session_id: string;
    type: string;
    entity_id?: string;
    payload?: Record<string, unknown>;
  };

  db.prepare(`
    INSERT INTO events (session_id, type, entity_id, payload)
    VALUES (?, ?, ?, ?)
  `).run(session_id, type, entity_id || null, JSON.stringify(payload || {}));

  return { ok: true };
});

// ── Positions ───────────────────────────────────────────────

app.get('/positions/:layout', async (req) => {
  const { layout } = req.params as { layout: string };
  const positions = db.prepare(
    'SELECT * FROM layout_positions WHERE layout_type = ?'
  ).all(layout);
  return { positions };
});

app.put('/positions/:layout', async (req) => {
  const { layout } = req.params as { layout: string };
  const { positions } = req.body as {
    positions: Array<{ node_id: string; x: number; y: number }>;
  };

  const stmt = db.prepare(`
    INSERT INTO layout_positions (node_id, layout_type, x, y, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(node_id, layout_type)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
  `);

  const batch = db.transaction((items: Array<{ node_id: string; x: number; y: number }>) => {
    for (const p of items) {
      stmt.run(p.node_id, layout, p.x, p.y);
    }
  });

  batch(positions);
  return { ok: true, count: positions.length };
});

// ── Diagnostics ─────────────────────────────────────────────

app.get('/diagnostics', async () => {
  const report = logger.generateReport();

  // Add DB stats
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
  const vaultCount = (db.prepare('SELECT COUNT(*) as c FROM vault_files').get() as any).c;
  const eventCount = (db.prepare('SELECT COUNT(*) as c FROM events').get() as any).c;
  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c;
  const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;

  return {
    report,
    stats: {
      nodes: nodeCount,
      vaultFiles: vaultCount,
      events: eventCount,
      projects: projectCount,
      dbSizeBytes: dbSize,
      uptime: process.uptime(),
    },
  };
});

app.get('/diagnostics/events', async (req) => {
  const { level, category, limit } = req.query as {
    level?: string;
    category?: string;
    limit?: string;
  };

  let sql = 'SELECT * FROM system_events WHERE 1=1';
  const params: any[] = [];

  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (category) { sql += ' AND category = ?'; params.push(category); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit || '50', 10));

  const events = db.prepare(sql).all(...params);
  return { events };
});

// ── Start ───────────────────────────────────────────────────

async function start() {
  try {
    await app.listen({ port: PORT, host: '127.0.0.1' });
    logger.info('startup', `Hub listening on http://127.0.0.1:${PORT}`);
    console.log(`\n  Portal Hub v0.3.0`);
    console.log(`  http://127.0.0.1:${PORT}`);
    console.log(`  DB: ${DB_PATH}`);
    console.log(`  Vault: ${DEFAULT_VAULT_CONFIG.vaultDir}\n`);
  } catch (err) {
    logger.error('startup', `Failed to start hub: ${err}`);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('shutdown', 'Hub shutting down (SIGINT)');
  logger.shutdown();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('shutdown', 'Hub shutting down (SIGTERM)');
  logger.shutdown();
  db.close();
  process.exit(0);
});

start();
