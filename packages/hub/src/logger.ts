/**
 * Portal System Logger
 * 
 * Two output targets:
 *   1. system_events table in SQLite (queryable from app)
 *   2. ~/.portal/logs/portal.log (readable from PowerShell)
 * 
 * Categories: startup, shutdown, ingest, physics, vault, db, render, error
 * Levels: info, warn, error
 * 
 * The logger is synchronous for writes (append to buffer)
 * and flushes to SQLite/file on an interval or on shutdown.
 * This keeps logging off the hot path.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory =
  | 'startup'
  | 'shutdown'
  | 'ingest'
  | 'physics'
  | 'vault'
  | 'db'
  | 'render'
  | 'error';

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface LoggerConfig {
  /** Directory for log files. Default: ~/.portal/logs */
  logDir: string;
  /** Max entries to buffer before flush. Default: 50 */
  bufferSize: number;
  /** Flush interval in ms. Default: 5000 */
  flushIntervalMs: number;
  /** Also write to console. Default: true in dev */
  consoleOutput: boolean;
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  logDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.portal', 'logs'),
  bufferSize: 50,
  flushIntervalMs: 5000,
  consoleOutput: true,
};

// ── Logger ──────────────────────────────────────────────────

export class SystemLogger {
  private buffer: LogEntry[] = [];
  private config: LoggerConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dbWriter: ((entries: LogEntry[]) => void) | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    fs.mkdirSync(this.config.logDir, { recursive: true });
    this.startFlushTimer();
  }

  /** Register a callback that writes entries to SQLite */
  setDbWriter(writer: (entries: LogEntry[]) => void): void {
    this.dbWriter = writer;
  }

  // ── Public API ──────────────────────────────────────────

  info(category: LogCategory, message: string, detail: Record<string, unknown> = {}): void {
    this.log('info', category, message, detail);
  }

  warn(category: LogCategory, message: string, detail: Record<string, unknown> = {}): void {
    this.log('warn', category, message, detail);
  }

  error(category: LogCategory, message: string, detail: Record<string, unknown> = {}): void {
    this.log('error', category, message, detail);
  }

  // ── Diagnostic Report ───────────────────────────────────

  /**
   * Generate a diagnostic report from the buffer + recent log file.
   * Callable from the app's UI or via a hub endpoint.
   */
  generateReport(): string {
    const lines: string[] = [
      `Portal Diagnostic Report`,
      `Generated: ${new Date().toISOString()}`,
      `Buffer size: ${this.buffer.length}`,
      `---`,
    ];

    // Include buffered entries
    for (const entry of this.buffer) {
      lines.push(this.formatEntry(entry));
    }

    // Include last 100 lines from log file
    const logPath = this.currentLogPath();
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const recent = content.split('\n').slice(-100);
      lines.push(`--- Recent log (${logPath}) ---`);
      lines.push(...recent);
    }

    return lines.join('\n');
  }

  // ── Flush & Shutdown ────────────────────────────────────

  flush(): void {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    // Write to file
    const logPath = this.currentLogPath();
    const lines = entries.map((e) => this.formatEntry(e)).join('\n') + '\n';
    fs.appendFileSync(logPath, lines);

    // Write to SQLite if writer registered
    if (this.dbWriter) {
      try {
        this.dbWriter(entries);
      } catch (err) {
        // Don't recurse — just write to file
        const errLine = `[ERROR] [db] Failed to write system events to SQLite: ${err}\n`;
        fs.appendFileSync(logPath, errLine);
      }
    }
  }

  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // ── Internals ───────────────────────────────────────────

  private log(level: LogLevel, category: LogCategory, message: string, detail: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      category,
      message,
      detail,
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(entry);

    if (this.config.consoleOutput) {
      const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
      console.log(`${prefix} [${category}] ${message}`);
    }

    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  private formatEntry(entry: LogEntry): string {
    const detail = Object.keys(entry.detail).length > 0
      ? ` ${JSON.stringify(entry.detail)}`
      : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${detail}`;
  }

  private currentLogPath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.config.logDir, `portal-${date}.log`);
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }
}

// ── Singleton ───────────────────────────────────────────────

let _logger: SystemLogger | null = null;

export function getLogger(config?: Partial<LoggerConfig>): SystemLogger {
  if (!_logger) {
    _logger = new SystemLogger(config);
  }
  return _logger;
}
