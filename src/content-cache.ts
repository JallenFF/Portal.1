// ============================================================
// Portal Frontend — Content Cache
// ============================================================
// Caches loaded text previews and image thumbnails.
// Fetches on demand when a file node is zoomed in enough.
// ============================================================

import { fetchTextPreview, getThumbnailUrl } from './api';
import type { TextPreview } from './api';

// ── Text Preview Cache ──────────────────────────────────────

const _textCache = new Map<string, TextPreview | 'loading' | 'error'>();

export function getTextPreview(nodeId: string): TextPreview | null {
  const cached = _textCache.get(nodeId);
  if (cached === 'loading' || cached === 'error') return null;
  if (cached) return cached;

  // Start loading
  _textCache.set(nodeId, 'loading');
  fetchTextPreview(nodeId).then((result) => {
    _textCache.set(nodeId, result || 'error');
  }).catch(() => {
    _textCache.set(nodeId, 'error');
  });

  return null;
}

// ── Image Thumbnail Cache ───────────────────────────────────

const _imageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();

export function getImageThumbnail(nodeId: string): HTMLImageElement | null {
  const cached = _imageCache.get(nodeId);
  if (cached === 'loading' || cached === 'error') return null;
  if (cached instanceof HTMLImageElement) return cached.complete ? cached : null;

  // Start loading
  _imageCache.set(nodeId, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { _imageCache.set(nodeId, img); };
  img.onerror = () => { _imageCache.set(nodeId, 'error'); };
  img.src = getThumbnailUrl(nodeId);

  return null;
}

// ── Query state (for showing loading spinners) ──────────────

export function isContentLoading(nodeId: string): boolean {
  return _textCache.get(nodeId) === 'loading' || _imageCache.get(nodeId) === 'loading';
}
