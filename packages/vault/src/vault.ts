/**
 * Portal Vault — Segregated File Storage
 * 
 * Design:
 *   - Files are COPIED into ~/.portal/vault/{hash}.{ext}
 *   - Original files are never touched
 *   - Dedup by SHA-256 hash (same file → same vault entry)
 *   - Metadata extracted at ingest (cheap only: size, dates, ext)
 *   - vault_files record is immutable after creation
 *   - Classification is a FUTURE layer — separate table, separate events
 * 
 * Ingest flow:
 *   1. ingestFile(sourcePath) → hash file
 *   2. If hash exists in vault → return existing vault_id (dedup)
 *   3. Copy file to vault dir
 *   4. Write vault_files row
 *   5. Extract cheap metadata → write file_metadata row
 *   6. Emit file_ingested event to append log
 *   7. Return vault_id
 * 
 * Future classification layer writes:
 *   - file_classified event (references vault_id)
 *   - tags table row (references vault_id)
 *   - No changes to vault_files or file_metadata
 */

import { VaultFileRow, FileMetadataRow } from '../core/src/persistence';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── Configuration ───────────────────────────────────────────

export interface VaultConfig {
  /** Root directory for vault storage. Default: ~/.portal/vault */
  vaultDir: string;
  /** Max file size in bytes. Default: 100MB */
  maxFileSize: number;
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  vaultDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.portal', 'vault'),
  maxFileSize: 100 * 1024 * 1024, // 100MB
};

// ── Hash ────────────────────────────────────────────────────

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── MIME Type (basic, no dependencies) ──────────────────────

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  json: 'application/json',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

export function guessMimeType(ext: string): string | null {
  return MIME_MAP[ext.toLowerCase()] || null;
}

// ── Metadata Extraction (cheap only) ────────────────────────

export interface CheapMetadata {
  fileCreated: string | null;
  fileModified: string | null;
  wordCount: number | null;
  dimensions: string | null;
}

export function extractCheapMetadata(filePath: string, ext: string): CheapMetadata {
  const stat = fs.statSync(filePath);

  const meta: CheapMetadata = {
    fileCreated: stat.birthtime.toISOString(),
    fileModified: stat.mtime.toISOString(),
    wordCount: null,
    dimensions: null,
  };

  // Word count for text-like files (cheap: just split on whitespace)
  const textExts = new Set(['md', 'txt', 'html', 'css', 'js', 'ts', 'json', 'csv']);
  if (textExts.has(ext.toLowerCase())) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      meta.wordCount = content.split(/\s+/).filter(Boolean).length;
    } catch {
      // Non-fatal: leave null
    }
  }

  return meta;
}

// ── Ingest ──────────────────────────────────────────────────

export interface IngestResult {
  vaultId: string;
  hash: string;
  deduplicated: boolean;
  vaultPath: string;
}

/**
 * Ingest a file into the vault.
 * 
 * Returns vault ID and whether it was a dedup hit.
 * Does NOT write to SQLite — caller (hub) handles DB writes.
 * This keeps vault as pure file operations.
 * 
 * @param sourcePath - absolute path to the source file
 * @param config - vault configuration
 * @param existingHashes - set of hashes already in vault (for dedup check)
 */
export async function ingestFile(
  sourcePath: string,
  config: VaultConfig = DEFAULT_VAULT_CONFIG,
  existingHashes: Map<string, string> = new Map(), // hash → vault_id
): Promise<IngestResult> {
  // Validate source exists
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const stat = fs.statSync(sourcePath);
  if (stat.size > config.maxFileSize) {
    throw new Error(`File exceeds max size (${stat.size} > ${config.maxFileSize})`);
  }
  if (stat.isDirectory()) {
    throw new Error(`Cannot ingest directory: ${sourcePath}`);
  }

  // Hash
  const hash = await hashFile(sourcePath);

  // Dedup check
  const existingId = existingHashes.get(hash);
  if (existingId) {
    const ext = path.extname(sourcePath).slice(1).toLowerCase();
    return {
      vaultId: existingId,
      hash,
      deduplicated: true,
      vaultPath: path.join(config.vaultDir, `${hash}.${ext}`),
    };
  }

  // Copy to vault
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  const vaultFilename = `${hash}.${ext}`;
  const vaultPath = path.join(config.vaultDir, vaultFilename);

  fs.mkdirSync(config.vaultDir, { recursive: true });
  fs.copyFileSync(sourcePath, vaultPath);

  // Generate vault ID
  const vaultId = crypto.randomUUID();

  return {
    vaultId,
    hash,
    deduplicated: false,
    vaultPath,
  };
}

// ── Vault File Record Builder ───────────────────────────────

export function buildVaultRecord(
  sourcePath: string,
  result: IngestResult,
): VaultFileRow {
  const filename = path.basename(sourcePath);
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  const stat = fs.statSync(sourcePath);

  return {
    id: result.vaultId,
    hash: result.hash,
    filename,
    ext,
    size_bytes: stat.size,
    source_path: sourcePath,
    mime_type: guessMimeType(ext),
    ingested_at: new Date().toISOString(),
  };
}

export function buildMetadataRecord(
  sourcePath: string,
  vaultId: string,
): FileMetadataRow {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  const meta = extractCheapMetadata(sourcePath, ext);

  return {
    vault_id: vaultId,
    file_created: meta.fileCreated,
    file_modified: meta.fileModified,
    word_count: meta.wordCount,
    dimensions: meta.dimensions,
    extra: '{}',
  };
}
