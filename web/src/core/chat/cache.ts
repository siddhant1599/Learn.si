/** Each chat is one atomic storage record. A stale tab never writes other chats.
 * Same-chat conflicts use last completed local save wins, as ordered by storage.
 * Tombstones are retained so stale tabs cannot recreate future deleted chats.
 */
import { persistedThread } from './privacy';
import type { ChatThread, ChatMessage, ChatSettings } from './types';

export const CHAT_PREFIX = 'document-lab.chat.v2.';
export const DELETED_PREFIX = 'document-lab.deleted-chat.v2.';
const LEGACY = 'document-lab.threads';
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

function message(v: unknown): v is ChatMessage {
  if (!object(v) || typeof v.id !== 'string' || typeof v.text !== 'string') return false;
  if (v.role === 'user') return strings(v.files);
  if (v.role !== 'assistant' || !['streaming','complete','stopped','error'].includes(v.status)) return false;
  if (!Array.isArray(v.steps) || !v.steps.every((s: unknown) => object(s) && typeof s.id === 'string'
    && typeof s.label === 'string' && ['active','complete','failed','stopped'].includes(s.status)
    && ['search','fetch','bash','write'].includes(s.kind) && (s.results === undefined || strings(s.results)))) return false;
  for (const field of ['reasoning','error','persistedAnswer']) if (v[field] !== undefined && typeof v[field] !== 'string') return false;
  if (v.steps.some((s: Record<string, unknown>) =>
    (s.progressVersion !== undefined && s.progressVersion !== 1) ||
    (s.attempt !== undefined && (!Number.isSafeInteger(s.attempt) || (s.attempt as number) < 0)) ||
    (s.sequence !== undefined && (!Number.isSafeInteger(s.sequence) || (s.sequence as number) < 1)) ||
    (s.parent !== undefined && typeof s.parent !== 'string'))) return false;
  if (v.warnings !== undefined && !strings(v.warnings)) return false;
  if (v.durationSeconds !== undefined && (typeof v.durationSeconds !== 'number' || !Number.isFinite(v.durationSeconds))) return false;
  if (v.webRequested !== undefined && typeof v.webRequested !== 'boolean') return false;
  for (const field of ['citations','persistedCitations']) {
    if (v[field] !== undefined && (!Array.isArray(v[field]) || !v[field].every((c: unknown) =>
      object(c) && Number.isInteger(c.citation) && c.citation > 0
      && (c.page === undefined || (typeof c.page === 'number' && Number.isFinite(c.page)))
      && (c.published_date === undefined || typeof c.published_date === 'string') &&
      (c.source_type === 'web' ? typeof c.url === 'string' && typeof c.title === 'string' && typeof c.retrieved_at === 'string'
        : (c.source_type === undefined || c.source_type === 'document') &&
          ['document_id','document_title','edition','number','kind'].every(k => typeof c[k] === 'string'))))) return false;
  }
  return true;
}

export function validThread(v: unknown): v is ChatThread {
  return object(v) && typeof v.id === 'string' && !!v.id && typeof v.title === 'string'
    && typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt)
    && (v.serverThreadId === undefined || typeof v.serverThreadId === 'string')
    && (v.documentIds === undefined || strings(v.documentIds))
    && Array.isArray(v.messages) && v.messages.every(message)
    && Array.isArray(v.todos) && v.todos.every((t: unknown) => object(t) && typeof t.content === 'string'
      && ['pending','in_progress','completed'].includes(t.status));
}
function parse(raw: string | null): unknown {
  try { return raw === null ? undefined : JSON.parse(raw); } catch { return undefined; }
}
export function readChats(storage: Storage): { threads: ChatThread[]; invalid: boolean } {
  const threads: ChatThread[] = [];
  let invalid = false;
  // Migration writes only missing per-chat keys. Original data remains recoverable
  // if quota/security restrictions prevent the migration from finishing.
  const legacyRaw = storage.getItem(LEGACY);
  if (legacyRaw !== null) {
    const legacy = parse(legacyRaw);
    if (Array.isArray(legacy)) {
      let migrated = true;
      for (const item of legacy) {
        if (!validThread(item)) { invalid = true; migrated = false; continue; }
        const key = CHAT_PREFIX + item.id;
        if (storage.getItem(key) === null && storage.getItem(DELETED_PREFIX + item.id) === null) {
          try { storage.setItem(key, JSON.stringify({thread: persistedThread(item)})); }
          catch { migrated = false; threads.push(item); }
        }
      }
      if (migrated) storage.removeItem(LEGACY);
    } else invalid = true;
  }
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(CHAT_PREFIX) || storage.getItem(DELETED_PREFIX + key.slice(CHAT_PREFIX.length)) !== null) continue;
    const value = parse(storage.getItem(key));
    if (object(value) && value.deleted === true) continue;
    if (object(value) && validThread(value.thread) && key === CHAT_PREFIX + value.thread.id) threads.push(value.thread);
    else invalid = true;
  }
  return {threads: threads.sort((a,b) => b.updatedAt-a.updatedAt || a.id.localeCompare(b.id)), invalid};
}
export function saveChat(storage: Storage, thread: ChatThread): boolean {
  const key = CHAT_PREFIX + thread.id;
  if (storage.getItem(DELETED_PREFIX + thread.id) !== null) return false;
  const current = parse(storage.getItem(key));
  if (object(current) && current.deleted === true) return false;
  storage.setItem(key, JSON.stringify({thread: persistedThread(thread)}));
  return true;
}
export function restoreSettings(value: unknown, fallback: ChatSettings): ChatSettings {
  if (!object(value)) return fallback;
  return {mode: ['flash','thinking','pro','ultra'].includes(value.mode) ? value.mode : fallback.mode,
    model: typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 200 ? value.model : fallback.model};
}

/** Future deletion callers retain this independent tombstone, even if a stale
 * writer races the record removal. Readers always give the tombstone precedence. */
export function markChatDeleted(storage: Storage, id: string) {
  storage.setItem(DELETED_PREFIX + id, 'true');
  storage.removeItem(CHAT_PREFIX + id);
}
