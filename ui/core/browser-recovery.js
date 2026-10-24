import { DRAFT_KEY } from './drafts.js';

export const BROWSER_SESSION_PREFIX = 'markrust.recovery.session.';

// Fresh workspace per page. Old drafts are read-only imports, never adopted.
// Cross-tab liveness/locking and explicit archive cleanup are not implemented.
export function createBrowserRecovery(storage, id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`) {
  const ownKey = BROWSER_SESSION_PREFIX + id;
  function store() {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('Penyimpanan recovery browser tidak tersedia');
    }
    return storage;
  }
  function decode(raw, legacy = false) {
    if (raw === null) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.markdown !== 'string' ||
        (data.version !== 1 && !(legacy && data.version === undefined))) {
      throw new Error('Format recovery browser tidak valid');
    }
    return {
      version: 1, markdown: data.markdown,
      path: typeof data.path === 'string' && data.path ? data.path : null,
      savedAt: Number(data.savedAt) || 0
    };
  }
  function allowed(key) {
    return key === DRAFT_KEY || (typeof key === 'string' && key.startsWith(BROWSER_SESSION_PREFIX));
  }
  let claimed = false;
  return {
    async write(draft) {
      const s = store();
      // Never overwrite a key that already belonged to another page/session.
      if (!claimed && s.getItem(ownKey) !== null) throw new Error('ID sesi recovery sudah dipakai');
      s.setItem(ownKey, JSON.stringify({ ...draft, version: 1 }));
      claimed = true;
    },
    async read() { return decode(store().getItem(ownKey)); },
    async clear() {
      if (claimed) store().removeItem(ownKey);
    },
    async list() {
      const s = store();
      const keys = [];
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key !== ownKey && allowed(key)) keys.push(key);
      }
      return keys.sort().map((key) => {
        const raw = s.getItem(key);
        if (raw === null) return null;
        try {
          const draft = decode(raw, key === DRAFT_KEY);
          return { id: key, path: draft.path, savedAt: draft.savedAt };
        } catch {
          return { id: key, path: null, savedAt: null, corrupt: true };
        }
      }).filter(Boolean);
    },
    async select(key) {
      if (key === ownKey || !allowed(key)) throw new Error('ID recovery browser tidak valid');
      const draft = decode(store().getItem(key), key === DRAFT_KEY);
      if (!draft) throw new Error('Recovery sudah tidak tersedia');
      return draft;
    }
  };
}
