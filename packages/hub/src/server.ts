/**
 * Portal Hub Server — v0.5.0
 *
 * Changes from v0.4.0:
 *   - Heat scoring integration: schema, endpoints, auto-seed from mtime
 *   - GET /projects/:id/heat — compute + cache heat scores for project nodes
 *   - POST /heat/recalc/:projectId — force recalculation
 *   - PUT /nodes/:id/pin — toggle pinned status
 *   - PUT /nodes/:id/promote — toggle promoted status
 *   - Children queries now LEFT JOIN heat_scores (heat_score, heat_tier on every child)
 *   - POST /open now updates heat_metadata (open_count, last_opened)
 *   - Project entry updates project_last_active for all project nodes
 */

import Fastify from 'fastify';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { SCHEMA_SQL } from '../../core/src/persistence';
import { HEAT_SCHEMA_SQL, rowToHeatMetadata, UPSERT_HEAT_METADATA_SQL, RECORD_EXECUTE_SQL, UPDATE_PROJECT_ACTIVE_SQL, TOGGLE_PIN_SQL, CACHE_SCORE_SQL, GET_PROJECT_HEAT_SQL } from '../../core/src/heat-persistence';
import { calculateHeatBatch, getProfile } from '../../core/src/heat';
import type { WeightProfile } from '../../core/src/heat-types';
import { WEIGHT_PROFILES } from '../../core/src/heat-types';
import { ingestFile, buildVaultRecord, buildMetadataRecord, DEFAULT_VAULT_CONFIG } from '../../vault/src/vault';
import { getLogger, LogEntry } from './logger';

// ── Config ──────────────────────────────────────────────────

const PORTAL_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.portal');
const DB_PATH = path.join(PORTAL_DIR, 'portal.db');
const PORT = 3141;

// ── Init ────────────────────────────────────────────────────

fs.mkdirSync(PORTAL_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA_SQL);
db.exec(HEAT_SCHEMA_SQL);

const logger = getLogger();

// ── Heat: seed from mtime for existing nodes without heat_metadata ──
function seedHeatFromMtime() {
  const unseeded = db.prepare(`
    SELECT n.id, n.project_id, n.file_modified, n.updated_at
    FROM nodes n
    LEFT JOIN heat_metadata hm ON n.id = hm.node_id
    WHERE hm.node_id IS NULL AND n.is_folder = 0
  `).all() as Array<{ id: string; project_id: string | null; file_modified: string | null; updated_at: string }>;

  if (unseeded.length === 0) return;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO heat_metadata (node_id, project_id, last_opened, open_count, edit_count,
      reference_count, import_count, pinned, locked, promoted, archived, project_last_active, updated_at)
    VALUES (?, ?, ?, 1, 0, 0, 0, 0, 0, 0, 0, ?, datetime('now'))
  `);

  const batch = db.transaction((rows: typeof unseeded) => {
    for (const row of rows) {
      const lastOpened = row.file_modified || row.updated_at || new Date().toISOString();
      stmt.run(row.id, row.project_id, lastOpened, lastOpened);
    }
  });

  batch(unseeded);
  logger.info('heat', `Seeded heat_metadata for ${unseeded.length} existing nodes from mtime`);
}

seedHeatFromMtime();

// ── Heat: compute and cache scores for a project ──
function computeAndCacheHeat(projectId: string): Array<{ nodeId: string; score: number; tier: string }> {
  const profileName = (db.prepare("SELECT value FROM settings WHERE key = 'heat.active_profile'").get() as any)?.value || 'balanced';
  const profile = getProfile(profileName);

  const rows = db.prepare(GET_PROJECT_HEAT_SQL).all(projectId) as any[];
  if (rows.length === 0) return [];

  const metas = rows.map(rowToHeatMetadata);
  const scores = calculateHeatBatch(metas, profile);

  const cacheStmt = db.prepare(CACHE_SCORE_SQL);
  const batch = db.transaction(() => {
    for (const s of scores) {
      cacheStmt.run(s.nodeId, s.score, s.tier, profile.name);
    }
  });
  batch();

  return scores.map(s => ({ nodeId: s.nodeId, score: s.score, tier: s.tier }));
}

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

function loadHashIndex(): Map<string, string> {
  const rows = db.prepare('SELECT hash, id FROM vault_files').all() as Array<{ hash: string; id: string }>;
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.hash, row.id);
  return map;
}

let hashIndex = loadHashIndex();

logger.info('startup', 'Hub server initializing', { dbPath: DB_PATH, port: PORT });

// ── Fastify ─────────────────────────────────────────────────

const app = Fastify({ logger: false });

// ── Health ──────────────────────────────────────────────────

app.get('/health', async () => {
  return { status: 'ok', version: '0.5.0', uptime: process.uptime() };
});

// ── Settings ────────────────────────────────────────────────

app.get('/settings', async () => {
  const rows = db.prepare('SELECT * FROM settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return { settings };
});

app.put('/settings/:key', async (req) => {
  const { key } = req.params as { key: string };
  const { value } = req.body as { value: string };
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
  logger.info('db', `Setting updated: ${key} = ${value}`);
  return { ok: true, key, value };
});

// ── Projects ────────────────────────────────────────────────

app.get('/projects', async () => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  // For each project, get the most recent file_modified among its nodes
  for (const p of projects as any[]) {
    const latest = db.prepare(`
      SELECT MAX(file_modified) as latest_modified, COUNT(*) as node_count
      FROM nodes WHERE project_id = ?
    `).get(p.id) as any;
    p.latest_modified = latest?.latest_modified || p.updated_at;
    p.node_count = latest?.node_count || 0;
  }
  return { projects };
});

app.post('/projects', async (req) => {
  const { name, color } = req.body as { name: string; color?: string };
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO projects (id, name, color) VALUES (?, ?, ?)').run(id, name, color || '#6B7280');
  logger.info('db', `Project created: ${name}`, { projectId: id });
  return { id, name, color: color || '#6B7280' };
});

app.get('/projects/:id', async (req) => {
  const { id } = req.params as { id: string };
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return { error: 'not found' };

  // Update project_last_active for heat calculation on project entry
  db.prepare(UPDATE_PROJECT_ACTIVE_SQL).run(id);

  // Recompute heat scores on project entry
  computeAndCacheHeat(id);

  // Get immediate children with heat scores
  const children = db.prepare(`
    SELECT n.*, v.filename, v.ext as vault_ext, v.size_bytes, v.mime_type,
           fm.file_created, fm.file_modified as meta_modified,
           hs.score as heat_score, hs.tier as heat_tier
    FROM nodes n
    LEFT JOIN vault_files v ON n.vault_id = v.id
    LEFT JOIN file_metadata fm ON n.vault_id = fm.vault_id
    LEFT JOIN heat_scores hs ON n.id = hs.node_id
    WHERE n.project_id = ? AND n.parent_id IS NULL
    ORDER BY n.is_folder DESC, hs.score DESC, n.file_modified DESC
  `).all(id);

  // For folder nodes, get child count
  for (const child of children as any[]) {
    if (child.is_folder) {
      const count = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE parent_id = ?').get(child.id) as any;
      child.child_count = count?.c || 0;
      // Get most recent file_modified among descendants
      const latest = db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM nodes WHERE parent_id = ?
          UNION ALL
          SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
        )
        SELECT MAX(n.file_modified) as latest FROM nodes n JOIN descendants d ON n.id = d.id
      `).get(child.id) as any;
      child.latest_child_modified = latest?.latest || child.file_modified;
    }
  }

  return { project, children };
});

// ── Node Children ───────────────────────────────────────────

app.get('/nodes/:id/children', async (req) => {
  const { id } = req.params as { id: string };
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!node) return { error: 'not found' };

  const children = db.prepare(`
    SELECT n.*, v.filename, v.ext as vault_ext, v.size_bytes, v.mime_type,
           fm.file_created, fm.file_modified as meta_modified,
           hs.score as heat_score, hs.tier as heat_tier
    FROM nodes n
    LEFT JOIN vault_files v ON n.vault_id = v.id
    LEFT JOIN file_metadata fm ON n.vault_id = fm.vault_id
    LEFT JOIN heat_scores hs ON n.id = hs.node_id
    WHERE n.parent_id = ?
    ORDER BY n.is_folder DESC, hs.score DESC, n.file_modified DESC
  `).all(id);

  for (const child of children as any[]) {
    if (child.is_folder) {
      const count = db.prepare('SELECT COUNT(*) as c FROM nodes WHERE parent_id = ?').get(child.id) as any;
      child.child_count = count?.c || 0;
      const latest = db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM nodes WHERE parent_id = ?
          UNION ALL
          SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
        )
        SELECT MAX(n.file_modified) as latest FROM nodes n JOIN descendants d ON n.id = d.id
      `).get(child.id) as any;
      child.latest_child_modified = latest?.latest || child.file_modified;
    }
  }

  return { node, children };
});

// ── Ingest (single file) ────────────────────────────────────

app.post('/ingest', async (req) => {
  const { sourcePath, projectId, parentId, label } = req.body as {
    sourcePath: string;
    projectId?: string;
    parentId?: string;
    label?: string;
  };

  try {
    const result = await ingestFile(sourcePath, DEFAULT_VAULT_CONFIG, hashIndex);
    const stat = fs.statSync(sourcePath);

    if (!result.deduplicated) {
      const vaultRecord = buildVaultRecord(sourcePath, result);
      db.prepare(`
        INSERT INTO vault_files (id, hash, filename, ext, size_bytes, source_path, mime_type, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(vaultRecord.id, vaultRecord.hash, vaultRecord.filename, vaultRecord.ext,
        vaultRecord.size_bytes, vaultRecord.source_path, vaultRecord.mime_type, vaultRecord.ingested_at);

      const metaRecord = buildMetadataRecord(sourcePath, result.vaultId);
      db.prepare(`
        INSERT INTO file_metadata (vault_id, file_created, file_modified, word_count, dimensions, extra)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(metaRecord.vault_id, metaRecord.file_created, metaRecord.file_modified,
        metaRecord.word_count, metaRecord.dimensions, metaRecord.extra);

      hashIndex.set(result.hash, result.vaultId);
    }

    const nodeId = crypto.randomUUID();
    const nodeLabel = label || path.basename(sourcePath);
    const ext = path.extname(sourcePath).slice(1).toLowerCase();

    db.prepare(`
      INSERT INTO nodes (id, project_id, parent_id, label, type, is_folder, vault_id, source_path, file_modified)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(nodeId, projectId || null, parentId || null, nodeLabel, ext || 'file',
      result.vaultId, sourcePath, stat.mtime.toISOString());

    const sessionId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO events (session_id, type, entity_id, payload) VALUES (?, 'file_ingested', ?, ?)
    `).run(sessionId, nodeId, JSON.stringify({
      vaultId: result.vaultId, hash: result.hash, deduplicated: result.deduplicated,
      sourcePath, projectId: projectId || null, parentId: parentId || null,
    }));

    logger.info('ingest', `File ingested: ${nodeLabel}`, { nodeId, vaultId: result.vaultId });
    return { nodeId, vaultId: result.vaultId, deduplicated: result.deduplicated, label: nodeLabel };
  } catch (err: any) {
    logger.error('ingest', `Ingest failed: ${err.message}`, { sourcePath });
    return { error: err.message };
  }
});

// ── Batch Ingest (folder → project with hierarchy) ──────────

app.post('/ingest/folder', async (req) => {
  const { folderPath, projectId } = req.body as {
    folderPath: string;
    projectId: string;
  };

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return { error: `Not a valid directory: ${folderPath}` };
  }

  const sessionId = crypto.randomUUID();
  const stats = { folders: 0, files: 0, errors: 0, skipped: 0 };

  // Map folder paths to their node IDs for parent_id linking
  const folderNodeMap = new Map<string, string>();

  async function processDirectory(dirPath: string, parentNodeId: string | null) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Separate folders and files
    const folders = entries.filter(e => e.isDirectory());
    const files = entries.filter(e => e.isFile());

    // Create folder nodes first
    for (const folder of folders) {
      const fullPath = path.join(dirPath, folder.name);
      const folderId = crypto.randomUUID();

      // Get the most recent mtime from the folder itself
      const folderStat = fs.statSync(fullPath);

      db.prepare(`
        INSERT INTO nodes (id, project_id, parent_id, label, type, is_folder, source_path, file_modified)
        VALUES (?, ?, ?, ?, 'folder', 1, ?, ?)
      `).run(folderId, projectId, parentNodeId, folder.name, fullPath, folderStat.mtime.toISOString());

      folderNodeMap.set(fullPath, folderId);
      stats.folders++;

      // Recurse into subdirectory
      await processDirectory(fullPath, folderId);
    }

    // Ingest files
    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);

      try {
        const fileStat = fs.statSync(fullPath);
        if (fileStat.size > DEFAULT_VAULT_CONFIG.maxFileSize) {
          logger.warn('ingest', `Skipped file: ${fullPath} — File exceeds max size`, { size: fileStat.size });
          stats.skipped++;
          continue;
        }

        const result = await ingestFile(fullPath, DEFAULT_VAULT_CONFIG, hashIndex);

        if (!result.deduplicated) {
          const vaultRecord = buildVaultRecord(fullPath, result);
          db.prepare(`
            INSERT INTO vault_files (id, hash, filename, ext, size_bytes, source_path, mime_type, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(vaultRecord.id, vaultRecord.hash, vaultRecord.filename, vaultRecord.ext,
            vaultRecord.size_bytes, vaultRecord.source_path, vaultRecord.mime_type, vaultRecord.ingested_at);

          const metaRecord = buildMetadataRecord(fullPath, result.vaultId);
          db.prepare(`
            INSERT INTO file_metadata (vault_id, file_created, file_modified, word_count, dimensions, extra)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(metaRecord.vault_id, metaRecord.file_created, metaRecord.file_modified,
            metaRecord.word_count, metaRecord.dimensions, metaRecord.extra);

          hashIndex.set(result.hash, result.vaultId);
        }

        const nodeId = crypto.randomUUID();
        const ext = path.extname(fullPath).slice(1).toLowerCase();

        db.prepare(`
          INSERT INTO nodes (id, project_id, parent_id, label, type, is_folder, vault_id, source_path, file_modified)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(nodeId, projectId, parentNodeId, file.name, ext || 'file',
          result.vaultId, fullPath, fileStat.mtime.toISOString());

        db.prepare(`
          INSERT INTO events (session_id, type, entity_id, payload) VALUES (?, 'file_ingested', ?, ?)
        `).run(sessionId, nodeId, JSON.stringify({
          vaultId: result.vaultId, sourcePath: fullPath, projectId, parentId: parentNodeId,
        }));

        stats.files++;
      } catch (err: any) {
        logger.warn('ingest', `Skipped file: ${fullPath} — ${err.message}`);
        stats.errors++;
      }
    }
  }

  await processDirectory(folderPath, null);

  logger.info('ingest', `Folder ingested with hierarchy: ${folderPath}`, stats);
  return { folder: folderPath, projectId, ...stats };
});

// ── Open File ───────────────────────────────────────────────

app.post('/open', async (req) => {
  const { nodeId } = req.body as { nodeId: string };
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any;

  if (!node) return { error: 'Node not found' };
  if (!node.source_path) return { error: 'No source path for this node' };
  if (!fs.existsSync(node.source_path)) return { error: `File not found: ${node.source_path}` };

  try {
    // Windows: use start command to open with default app
    const escaped = node.source_path.replace(/"/g, '\\"');
    if (process.platform === 'win32') {
      execSync(`start "" "${escaped}"`, { shell: 'cmd.exe' });
    } else if (process.platform === 'darwin') {
      execSync(`open "${escaped}"`);
    } else {
      execSync(`xdg-open "${escaped}"`);
    }

    // Log the open event
    const sessionId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO events (session_id, type, entity_id, payload) VALUES (?, 'file_opened', ?, ?)
    `).run(sessionId, nodeId, JSON.stringify({ source_path: node.source_path }));

    // Update node's updated_at to track access
    db.prepare('UPDATE nodes SET updated_at = datetime(?) WHERE id = ?')
      .run(new Date().toISOString(), nodeId);

    // Update heat metadata: increment open_count, update last_opened
    db.prepare(UPSERT_HEAT_METADATA_SQL).run(nodeId, node.project_id);

    logger.info('db', `File opened: ${node.label}`, { nodeId, path: node.source_path });
    return { ok: true, path: node.source_path };
  } catch (err: any) {
    logger.error('error', `Failed to open file: ${err.message}`, { nodeId });
    return { error: err.message };
  }
});

// ── File Preview (text content) ──────────────────────────────

app.get('/nodes/:id/preview', async (req, reply) => {
  const { id } = req.params as { id: string };
  const lines = parseInt((req.query as any).lines || '15', 10);

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
  if (!node) return reply.code(404).send({ error: 'Node not found' });
  if (!node.source_path) return reply.code(404).send({ error: 'No source path' });
  if (!fs.existsSync(node.source_path)) return reply.code(404).send({ error: 'File not found' });

  const ext = path.extname(node.source_path).slice(1).toLowerCase();

  try {
    // Read first 32KB to check if file is text-readable
    const fd = fs.openSync(node.source_path, 'r');
    const buf = Buffer.alloc(32768);
    const bytesRead = fs.readSync(fd, buf, 0, 32768, 0);
    fs.closeSync(fd);

    const sample = buf.slice(0, bytesRead);

    // Detect binary: if more than 5% of bytes are control chars (except \n \r \t), it's binary
    let controlCount = 0;
    for (let i = 0; i < Math.min(bytesRead, 1024); i++) {
      const b = sample[i];
      if (b === 0 || (b < 32 && b !== 10 && b !== 13 && b !== 9)) controlCount++;
    }
    const isBinary = controlCount > Math.min(bytesRead, 1024) * 0.05;

    if (isBinary) {
      // Try extracting real text from known binary document formats
      try {
        if (ext === 'docx' || ext === 'doc') {
          const result = await mammoth.extractRawText({ path: node.source_path });
          const docLines = result.value.split('\n').filter((l: string) => l.trim() !== '');
          if (docLines.length > 0) {
            return { lines: docLines.slice(0, lines), ext, total: docLines.length };
          }
        } else if (ext === 'pdf') {
          const pdfBuf = fs.readFileSync(node.source_path);
          const pdfData = await pdfParse(pdfBuf);
          const pdfLines = pdfData.text.split('\n').filter((l: string) => l.trim() !== '');
          if (pdfLines.length > 0) {
            return { lines: pdfLines.slice(0, lines), ext, total: pdfLines.length };
          }
        }
      } catch (_extractErr) {
        // Fall through to metadata preview if extraction fails
      }

      // Fallback: return file metadata as preview
      const stats = fs.statSync(node.source_path);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      const modified = stats.mtime.toISOString().split('T')[0];
      return {
        lines: [
          `[${ext.toUpperCase()} Document]`,
          ``,
          `Size: ${sizeMB} MB`,
          `Modified: ${modified}`,
          `Name: ${path.basename(node.source_path)}`,
        ],
        ext,
        total: 5,
        binary: true,
      };
    }

    // Text file: read and return lines
    const content = sample.toString('utf-8');
    const textLines = content.split('\n').slice(0, lines);
    const fullContent = fs.readFileSync(node.source_path, 'utf-8');
    return { lines: textLines, ext, total: fullContent.split('\n').length };
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

// ── File Thumbnail (raw file serving for images) ─────────────

app.get('/nodes/:id/thumbnail', async (req, reply) => {
  const { id } = req.params as { id: string };

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
  if (!node) return reply.code(404).send({ error: 'Node not found' });
  if (!node.source_path) return reply.code(404).send({ error: 'No source path' });
  if (!fs.existsSync(node.source_path)) return reply.code(404).send({ error: 'File not found' });

  const ext = path.extname(node.source_path).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  };

  const mime = mimeMap[ext];

  // Serve raw image files directly
  if (mime) {
    try {
      const buf = fs.readFileSync(node.source_path);
      return reply.type(mime).header('Cache-Control', 'max-age=3600').send(buf);
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  }

  // For non-image files, generate an SVG "page" thumbnail from extracted text
  try {
    let textContent = '';

    if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ path: node.source_path });
      textContent = result.value;
    } else if (ext === 'pdf') {
      const pdfBuf = fs.readFileSync(node.source_path);
      const pdfResult = await pdfParse(pdfBuf);
      textContent = pdfResult.text;
    } else {
      // Try reading as text
      const fd = fs.openSync(node.source_path, 'r');
      const testBuf = Buffer.alloc(1024);
      const bytesRead = fs.readSync(fd, testBuf, 0, 1024, 0);
      fs.closeSync(fd);
      let ctrl = 0;
      for (let i = 0; i < bytesRead; i++) {
        const b = testBuf[i];
        if (b === 0 || (b < 32 && b !== 10 && b !== 13 && b !== 9)) ctrl++;
      }
      if (ctrl <= bytesRead * 0.05) {
        textContent = fs.readFileSync(node.source_path, 'utf-8');
      }
    }

    if (!textContent.trim()) {
      return reply.code(400).send({ error: 'Cannot generate thumbnail', ext });
    }

    // Render text as an SVG "document page"
    const pageW = 400;
    const pageH = 520;
    const margin = 30;
    const fontSize = 11;
    const lineH = 16;
    const maxLines = Math.floor((pageH - margin * 2) / lineH);
    const maxChars = Math.floor((pageW - margin * 2) / (fontSize * 0.6));

    const lines = textContent.split('\n').slice(0, maxLines);
    const escapedLines = lines.map((l: string) => {
      const trimmed = l.slice(0, maxChars);
      return trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });

    const textY = margin + fontSize;
    const tspans = escapedLines.map((l: string, i: number) =>
      `<tspan x="${margin}" dy="${i === 0 ? 0 : lineH}">${l || ' '}</tspan>`
    ).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}">
      <rect width="${pageW}" height="${pageH}" fill="#f8f8f6" rx="4"/>
      <rect x="0" y="0" width="${pageW}" height="6" fill="#e0e0dc"/>
      <text x="${margin}" y="${textY}" font-family="Georgia, serif" font-size="${fontSize}" fill="#1a1a1a" line-height="${lineH}">${tspans}</text>
    </svg>`;

    return reply.type('image/svg+xml').header('Cache-Control', 'max-age=3600').send(svg);
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

// ── Move Node ───────────────────────────────────────────────

app.put('/nodes/:id/move', async (req) => {
  const { id } = req.params as { id: string };
  const { projectId, parentId } = req.body as { projectId?: string | null; parentId?: string | null };

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!node) return { error: 'Node not found' };

  const oldProjectId = (node as any).project_id;
  const oldParentId = (node as any).parent_id;

  if (projectId !== undefined) {
    db.prepare('UPDATE nodes SET project_id = ?, updated_at = datetime(?) WHERE id = ?')
      .run(projectId, new Date().toISOString(), id);
  }
  if (parentId !== undefined) {
    db.prepare('UPDATE nodes SET parent_id = ?, updated_at = datetime(?) WHERE id = ?')
      .run(parentId, new Date().toISOString(), id);
  }

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO events (session_id, type, entity_id, payload) VALUES (?, 'node_moved', ?, ?)
  `).run(sessionId, id, JSON.stringify({
    fromProject: oldProjectId, toProject: projectId,
    fromParent: oldParentId, toParent: parentId,
  }));

  return { ok: true, nodeId: id };
});

// ── Events ──────────────────────────────────────────────────

app.get('/events', async (req) => {
  const { type, session_id, entity_id, limit } = req.query as {
    type?: string; session_id?: string; entity_id?: string; limit?: string;
  };
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params: any[] = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (session_id) { sql += ' AND session_id = ?'; params.push(session_id); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit || '100', 10));
  return { events: db.prepare(sql).all(...params) };
});

app.post('/events', async (req) => {
  const { session_id, type, entity_id, payload } = req.body as {
    session_id: string; type: string; entity_id?: string; payload?: Record<string, unknown>;
  };
  db.prepare('INSERT INTO events (session_id, type, entity_id, payload) VALUES (?, ?, ?, ?)')
    .run(session_id, type, entity_id || null, JSON.stringify(payload || {}));
  return { ok: true };
});

// ── Positions ───────────────────────────────────────────────

app.get('/positions/:layout', async (req) => {
  const { layout } = req.params as { layout: string };
  return { positions: db.prepare('SELECT * FROM layout_positions WHERE layout_type = ?').all(layout) };
});

app.put('/positions/:layout', async (req) => {
  const { layout } = req.params as { layout: string };
  const { positions } = req.body as { positions: Array<{ node_id: string; x: number; y: number }> };
  const stmt = db.prepare(`
    INSERT INTO layout_positions (node_id, layout_type, x, y, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(node_id, layout_type)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
  `);
  const batch = db.transaction((items: typeof positions) => {
    for (const p of items) stmt.run(p.node_id, layout, p.x, p.y);
  });
  batch(positions);
  return { ok: true, count: positions.length };
});

// ── Diagnostics ─────────────────────────────────────────────

app.get('/diagnostics', async () => {
  const report = logger.generateReport();
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
  const folderCount = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE is_folder = 1').get() as any).c;
  const fileCount = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE is_folder = 0').get() as any).c;
  const vaultCount = (db.prepare('SELECT COUNT(*) as c FROM vault_files').get() as any).c;
  const eventCount = (db.prepare('SELECT COUNT(*) as c FROM events').get() as any).c;
  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c;
  const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;

  return {
    report,
    stats: { nodes: nodeCount, folders: folderCount, files: fileCount, vaultFiles: vaultCount,
             events: eventCount, projects: projectCount, dbSizeBytes: dbSize, uptime: process.uptime() },
  };
});

app.get('/diagnostics/events', async (req) => {
  const { level, category, limit } = req.query as { level?: string; category?: string; limit?: string };
  let sql = 'SELECT * FROM system_events WHERE 1=1';
  const params: any[] = [];
  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit || '50', 10));
  return { events: db.prepare(sql).all(...params) };
});

// ── Heat Endpoints ──────────────────────────────────────────

app.get('/projects/:id/heat', async (req) => {
  const { id } = req.params as { id: string };
  const scores = computeAndCacheHeat(id);
  return { projectId: id, scores };
});

app.post('/heat/recalc/:projectId', async (req) => {
  const { projectId } = req.params as { projectId: string };
  const scores = computeAndCacheHeat(projectId);
  logger.info('heat', `Recalculated heat for project ${projectId}: ${scores.length} nodes`);
  return { projectId, scores, count: scores.length };
});

app.put('/nodes/:id/pin', async (req) => {
  const { id } = req.params as { id: string };
  db.prepare(TOGGLE_PIN_SQL).run(id);
  const row = db.prepare('SELECT pinned FROM heat_metadata WHERE node_id = ?').get(id) as any;
  logger.info('heat', `Toggled pin for node ${id}: pinned=${row?.pinned}`);
  return { ok: true, nodeId: id, pinned: row?.pinned === 1 };
});

app.put('/nodes/:id/promote', async (req) => {
  const { id } = req.params as { id: string };
  db.prepare(`
    UPDATE heat_metadata SET
      promoted = CASE WHEN promoted = 1 THEN 0 ELSE 1 END,
      updated_at = datetime('now')
    WHERE node_id = ?
  `).run(id);
  const row = db.prepare('SELECT promoted FROM heat_metadata WHERE node_id = ?').get(id) as any;
  logger.info('heat', `Toggled promote for node ${id}: promoted=${row?.promoted}`);
  return { ok: true, nodeId: id, promoted: row?.promoted === 1 };
});

// ── Start ───────────────────────────────────────────────────

async function start() {
  try {
    await app.listen({ port: PORT, host: '127.0.0.1' });
    logger.info('startup', `Hub listening on http://127.0.0.1:${PORT}`);
    console.log(`\n  Portal Hub v0.5.0`);
    console.log(`  http://127.0.0.1:${PORT}`);
    console.log(`  DB: ${DB_PATH}`);
    console.log(`  Vault: ${DEFAULT_VAULT_CONFIG.vaultDir}\n`);
  } catch (err) {
    logger.error('startup', `Failed to start hub: ${err}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => { logger.info('shutdown', 'SIGINT'); logger.shutdown(); db.close(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('shutdown', 'SIGTERM'); logger.shutdown(); db.close(); process.exit(0); });

start();
