// ============================================================
// Portal Frontend — Color Maps
// ============================================================

export const EXT_COLORS: Record<string, string> = {
  pdf: '#EF4444', docx: '#3B82F6', xlsx: '#10B981', csv: '#6EE7B7',
  md: '#A78BFA', html: '#F97316', js: '#FBBF24', ts: '#3B82F6',
  json: '#6B7280', pptx: '#F59E0B', mp4: '#EC4899', env: '#6B7280',
  web: '#60A5FA', app: '#34D399', email: '#F472B6', dir: '#FCD34D',
  txt: '#9CA3AF', css: '#06B6D4', png: '#F472B6', jpg: '#F472B6',
  jpeg: '#F472B6', gif: '#F472B6', svg: '#A78BFA', zip: '#6B7280',
  py: '#3776AB', doc: '#3B82F6', xls: '#10B981', ppt: '#F59E0B',
  folder: '#F59E0B',
};

export const PROJECT_COLORS = [
  '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981',
  '#EF4444', '#EC4899', '#06B6D4', '#84CC16',
];

export function getExtColor(ext: string): string {
  return EXT_COLORS[ext] || '#6B7280';
}
