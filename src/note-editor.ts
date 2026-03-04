// ============================================================
// Portal Frontend — Note Editor Overlay
// ============================================================
// HTML textarea overlay for editing sticky notes on the canvas.
// Positioned at the note's screen coordinates.
// Saves on blur, Escape, or Enter (without shift).
// ============================================================

import { state, camera } from './state';
import { worldToScreen } from './math';
import { updateNote } from './api';
import type { WorkspaceNote } from './types';

let _canvas: HTMLCanvasElement;
let _container: HTMLElement;
let _activeEditor: HTMLTextAreaElement | null = null;
let _activeNoteId: string | null = null;

export function initNoteEditor(canvas: HTMLCanvasElement): void {
  _canvas = canvas;

  // Create container
  _container = document.createElement('div');
  _container.id = 'note-editor-container';
  _container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:25;';
  document.body.appendChild(_container);

  // Register global callback for opening editor
  (window as any).__portalOpenNoteEditor = openNoteEditor;
}

export function openNoteEditor(note: WorkspaceNote): void {
  // Close any existing editor first
  closeNoteEditor();

  _activeNoteId = note.id;

  const sc = worldToScreen(note.x, note.y, _canvas);
  const screenW = note.width * camera.zoom;
  const screenH = note.height * camera.zoom;

  const textarea = document.createElement('textarea');
  textarea.value = note.content;
  textarea.style.cssText = `
    position: absolute;
    left: ${sc.x}px;
    top: ${sc.y}px;
    width: ${Math.max(screenW, 120)}px;
    height: ${Math.max(screenH, 80)}px;
    background: ${note.color};
    border: 2px solid #3b82f6;
    border-radius: ${Math.max(2, Math.min(screenW, screenH) * 0.04)}px;
    padding: ${screenW * 0.08}px;
    font-family: system-ui, sans-serif;
    font-size: ${Math.max(10, Math.min(16, screenH * 0.08))}px;
    color: rgba(0,0,0,0.8);
    resize: none;
    outline: none;
    pointer-events: auto;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 26;
  `;

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      saveAndClose();
    }
    // Enter without shift = save
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveAndClose();
    }
    // Prevent keyboard shortcuts from firing
    e.stopPropagation();
  });

  textarea.addEventListener('blur', () => {
    // Small delay to allow click events to fire
    setTimeout(saveAndClose, 100);
  });

  _container.appendChild(textarea);
  _activeEditor = textarea;

  // Focus and select all
  requestAnimationFrame(() => {
    textarea.focus();
    if (!note.content) {
      textarea.placeholder = 'Type your note...';
    }
  });
}

function saveAndClose(): void {
  if (!_activeEditor || !_activeNoteId) return;

  const content = _activeEditor.value;
  const noteId = _activeNoteId;

  // Update in state
  const note = state.workspaceNotes.find(n => n.id === noteId);
  if (note) {
    note.content = content;
  }

  // Save to hub
  updateNote(noteId, { content });

  // Close editor
  closeNoteEditor();
}

function closeNoteEditor(): void {
  if (_activeEditor) {
    _activeEditor.remove();
    _activeEditor = null;
  }
  _activeNoteId = null;
  state.editingNote = null;
}
