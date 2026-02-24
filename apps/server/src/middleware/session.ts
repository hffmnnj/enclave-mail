/**
 * Re-exports from the canonical session manager module.
 *
 * Existing consumers (e.g. auth routes) import from this path.
 * New code should import directly from `../auth/session-manager.js`.
 */
export {
  createSession,
  invalidateAllSessions,
  invalidateSession,
  validateSession,
} from '../auth/session-manager.js';

export type { SessionData } from '../auth/session-manager.js';

/**
 * @deprecated Use `SessionData` from `../auth/session-manager.js` instead.
 */
export type SessionRecord = import('../auth/session-manager.js').SessionData;
