import { DRAFT_KEY } from './drafts.js';

export const BROWSER_SESSION_PREFIX = 'markrust.recovery.session.';

// Fresh workspace per page. Old drafts are read-only imports, never adopted.
// Web Locks protect live modern tabs; cleanup is unavailable without them.
export function createBrowserRecovery(storage, id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, locks = globalThis.navigator?.locks) {
  const ownKey = BROWSER_SESSION_PREFIX + id;
  const lockName = (key) => 'markrust-archive:' + key;
  const canLock = typeof locks?.request === 'function' && typeof locks?.query === 'function';
  let releaseLease;
  let leaseAcquired = !canLock;
  // Keep our session locked for this page's lifetime, including bfcache. The
  // browser releases locks on document destruction; dispose is for tests only.
  const ready = !canLock ? Promise.resolve(true) : new Promise((resolve) => {
    locks.request(lockName(ownKey), { mode: 'exclusive', ifAvailable: true }, (lock) => {
      leaseAcquired = Boolean(lock);
      resolve(leaseAcquired);
      return lock ? new Promise((release) => { releaseLease = release; }) : undefined;
    }).catch(() => resolve(false));
  });
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
  let disposed = false;
  return {
    async write(draft) {
      if (disposed) throw new Error('Sesi sudah ditutup');
      if (!leaseAcquired && !(await ready)) throw new Error('Lock sesi browser tidak tersedia');
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
      const held = canLock ? (await locks.query()).held || [] : [];
      const deletable = (key) => canLock && !held.some((lock) => lock.name === lockName(key));
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
          return { id: key, path: draft.path, savedAt: draft.savedAt, canDelete: deletable(key) };
        } catch {
          return { id: key, path: null, savedAt: null, corrupt: true, canDelete: deletable(key) };
        }
      }).filter(Boolean);
    },
    dispose() { disposed = true; releaseLease?.(); },
    async remove(key, expectedRaw) {
      if (key === ownKey || !allowed(key)) throw new Error('Sesi aktif/ID tidak boleh dihapus');
      if (!canLock) throw new Error('Cleanup browser memerlukan Web Locks; gunakan browser yang mendukungnya');
      return locks.request(lockName(key), { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) throw new Error('Sesi browser masih aktif');
        const s = store();
        if (typeof expectedRaw !== 'string' || s.getItem(key) !== expectedRaw) throw new Error('Cadangan berubah; pilih ulang sebelum menghapus');
        s.removeItem(key);
      });
    },
    async inspect(key) {
      if (key === ownKey || !allowed(key)) throw new Error('ID recovery browser tidak valid');
      const raw = store().getItem(key);
      if (raw === null) throw new Error('Cadangan sudah tidak tersedia');
      return raw;
    },
    async select(key) {
      if (key === ownKey || !allowed(key)) throw new Error('ID recovery browser tidak valid');
      const draft = decode(store().getItem(key), key === DRAFT_KEY);
      if (!draft) throw new Error('Recovery sudah tidak tersedia');
      return draft;
    }
  };
}
