// Offline-first sync for the Finanzen app (adapted from Stretch & Gym).
//
// Every document lives on the phone first (the app keeps it in IndexedDB and calls mark()).
// When there is internet, run() brings the phone and a private GitHub repo in line:
//   1. pull: files that changed in the repo since the last run are copied to the phone
//      (unless the phone has its own unsent change; then the phone wins, except `tx` months,
//      which are merged booking by booking so nothing imported on either side is lost),
//   2. push: all unsent documents go up together as ONE commit (Git Data API).
// Repo layout: tx/<YYYY-MM>.json (bookings, already anonymised), rules/<id>.json (personal rules),
// settings/<name>.json, prompts/<screen>.json (change requests for Claude, names already replaced by Kürzel).
// The list name ↔ Kürzel is never synced (it is not a path this file knows).
//
// Works in browsers and in Node 18+ (tests): needs fetch, crypto.subtle, TextEncoder, atob.
(function (root) {
  'use strict';
  const PATH_RE = /^(tx|rules|settings|prompts)\/([^/]+)\.json$/;
  const FILE_RE = /^$/; // no binary files in this app
  const API = 'https://api.github.com/repos/';

  const enc = new TextEncoder();
  const toText = doc => JSON.stringify(doc, null, 2) + '\n';

  // Git's blob id: sha1("blob <bytes>\0<content>"). Lets us know what the repo holds without asking it.
  async function blobSha(text) {
    const body = enc.encode(text), head = enc.encode('blob ' + body.length + '\0');
    const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
  }
  function toB64(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64Text(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  // Union of two versions of the same month, keyed by booking id; the phone's version of a booking wins.
  function mergeMonth(local, remote) {
    return { ...remote, ...local, tx: { ...(remote.tx || {}), ...(local.tx || {}) } };
  }

  function message(paths) {
    const n = paths.length, names = paths.slice(0, 3).join(', ');
    return 'App: ' + names + (n > 3 ? ` (+${n - 3} more)` : '');
  }

  function explain(e) {
    if (!e) return null;
    if (!e.status) return null; // network error: we are simply offline, nothing to fix
    if (e.status === 401) return 'Token nicht akzeptiert (falsch oder abgelaufen). Bitte neu eingeben.';
    if (e.status === 403 && /rate limit/i.test(e.detail || '')) return 'GitHub-Limit erreicht. Neuer Versuch später.';
    if (e.status === 403) return 'Token darf nicht in dieses Repo schreiben. Es braucht „Contents: Read and write“.';
    if (e.status === 404) return 'Repo nicht gefunden, oder das Token hat keinen Zugriff.';
    if (e.status === 409) return 'Das Repo ist leer. Es braucht mindestens eine Datei.';
    return `GitHub-Fehler ${e.status}${e.detail ? ': ' + e.detail : ''}`;
  }

  function createSync(o) {
    // o: { load(key, def), save(key, val), getDoc(path), setDoc(path, doc|null), onChange(paths), onState(status),
    //      onTree?(entries) – every file in the repo, after each pull (used for the machine photos),
    //      getFile?(path) – bytes of a marked images/… file, onFile?(path, sha) – it is in the repo now,
    //      fetch?, isOnline?, debounce? }
    const fetchFn = o.fetch || ((...a) => fetch(...a));
    const isOnline = o.isOnline || (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    const debounce = o.debounce ?? 20000;
    let cfg = o.load('sync.cfg', null);
    let dirty = o.load('sync.dirty', {});
    const meta = Object.assign({ sha: {}, head: null, tree: null, last: null, error: null }, o.load('sync.meta', {}));
    let running = false, again = false, timer = null, offline = false;

    const saveDirty = () => o.save('sync.dirty', dirty);
    const saveMeta = () => o.save('sync.meta', meta);
    const status = () => ({
      configured: !!(cfg && cfg.token && cfg.repo), repo: cfg && cfg.repo, running,
      pending: Object.keys(dirty).length, last: meta.last, error: meta.error,
      offline: offline || !isOnline(),
    });
    const emit = () => { try { o.onState && o.onState(status()); } catch (e) { console.warn(e); } };

    async function api(method, path, body, raw) {
      const r = await fetchFn(API + cfg.repo + '/' + path, {
        method, cache: raw ? 'default' : 'no-store',
        headers: { Authorization: 'Bearer ' + cfg.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        const e = new Error('GitHub ' + r.status); e.status = r.status;
        try { e.detail = (await r.json()).message; } catch {}
        throw e;
      }
      return raw ? r.arrayBuffer() : r.status === 204 ? null : r.json();
    }

    // Copy repo changes to the phone. Returns the paths that changed locally.
    async function pull(head) {
      const commit = await api('GET', 'git/commits/' + head);
      const tree = await api('GET', 'git/trees/' + commit.tree.sha + '?recursive=1');
      const changed = [], seen = new Set();
      try { o.onTree && o.onTree(tree.tree); } catch (e) { console.warn(e); }
      for (const e of tree.tree) {
        if (e.type !== 'blob' || !PATH_RE.test(e.path)) continue;
        const path = e.path.slice(0, -5);
        seen.add(path);
        if (meta.sha[path] === e.sha) continue;
        const coll = path.split('/')[0];
        if (!dirty[path] || coll === 'tx') {
          const remote = JSON.parse(b64Text((await api('GET', 'git/blobs/' + e.sha)).content));
          const local = dirty[path] ? o.getDoc(path) : null;
          o.setDoc(path, local ? mergeMonth(local, remote) : remote);
          changed.push(path);
        }
        meta.sha[path] = e.sha;
      }
      // Removed in the repo (e.g. a rule deleted on the Mac): remove here too.
      for (const path of Object.keys(meta.sha)) {
        if (seen.has(path)) continue;
        delete meta.sha[path];
        if (!dirty[path]) { o.setDoc(path, null); changed.push(path); }
      }
      meta.head = head; meta.tree = commit.tree.sha;
      saveMeta();
      return changed;
    }

    async function push(head) {
      const snap = { ...dirty }, entries = [], texts = {}, files = {}, removed = [];
      for (const path of Object.keys(snap)) {
        if (FILE_RE.test(path)) {
          const bytes = o.getFile ? await o.getFile(path) : null;
          if (!bytes) { delete dirty[path]; continue; }
          files[path] = (await api('POST', 'git/blobs', { content: toB64(bytes), encoding: 'base64' })).sha;
          entries.push({ path, mode: '100644', type: 'blob', sha: files[path] });
          continue;
        }
        const doc = o.getDoc(path);
        if (!doc && meta.sha[path] && PATH_RE.test(path + '.json')) { // deleted on the phone (e.g. a rule): delete in the repo too
          entries.push({ path: path + '.json', mode: '100644', type: 'blob', sha: null }); removed.push(path); continue;
        }
        if (!doc || !PATH_RE.test(path + '.json')) { delete dirty[path]; continue; }
        texts[path] = toText(doc);
        entries.push({ path: path + '.json', mode: '100644', type: 'blob', content: texts[path] });
      }
      saveDirty();
      if (!entries.length) return true;
      const tree = await api('POST', 'git/trees', { base_tree: meta.tree, tree: entries });
      const commit = await api('POST', 'git/commits', { message: message([...Object.keys(texts), ...Object.keys(files), ...removed]), tree: tree.sha, parents: [head] });
      try { await api('PATCH', 'git/refs/heads/' + cfg.branch, { sha: commit.sha }); }
      catch (e) { if (e.status === 422 || e.status === 409) return false; throw e; } // someone else pushed first: pull again, retry
      for (const path of Object.keys(texts)) {
        meta.sha[path] = await blobSha(texts[path]);
        if (dirty[path] === snap[path]) delete dirty[path];
      }
      for (const path of removed) {
        delete meta.sha[path];
        if (dirty[path] === snap[path]) delete dirty[path];
      }
      for (const [path, sha] of Object.entries(files)) {
        if (dirty[path] === snap[path]) delete dirty[path];
        try { o.onFile && o.onFile(path, sha); } catch (e) { console.warn(e); }
      }
      meta.head = commit.sha; meta.tree = tree.sha;
      saveDirty(); saveMeta();
      return true;
    }

    async function run() {
      clearTimeout(timer); timer = null;
      if (running) { again = true; return; }
      if (!cfg || !cfg.token || !isOnline()) { emit(); return; }
      running = true; emit();
      const changed = [];
      try {
        for (let i = 0; i < 5; i++) {
          const ref = await api('GET', 'git/ref/heads/' + cfg.branch);
          const head = ref.object.sha;
          if (head !== meta.head || !meta.tree) changed.push(...await pull(head));
          if (!Object.keys(dirty).length) break;
          if (!(await push(head))) { meta.head = null; continue; }
          if (!Object.keys(dirty).length) break;
        }
        offline = false; meta.error = null; meta.last = new Date().toISOString();
      } catch (e) {
        offline = !e.status; meta.error = explain(e);
        if (!offline) console.warn('sync', e);
      } finally {
        running = false; saveMeta();
        if (changed.length) { try { await o.onChange(changed); } catch (e) { console.warn(e); } }
        emit();
        if (again) { again = false; schedule(1000); }
      }
    }

    function schedule(ms = debounce) { clearTimeout(timer); timer = setTimeout(run, ms); }

    return {
      status, run, schedule, blobSha, mergeMonth,
      // Every file in the repo right now (for photos the phone hasn't seen yet).
      async tree() {
        if (!cfg || !cfg.token) return null;
        const ref = await api('GET', 'git/ref/heads/' + cfg.branch);
        const commit = await api('GET', 'git/commits/' + ref.object.sha);
        return (await api('GET', 'git/trees/' + commit.tree.sha + '?recursive=1')).tree;
      },
      // One file's bytes by its id (ids never change, so the browser may cache these).
      blob(sha) { return api('GET', 'git/blobs/' + sha, null, true); },
      get cfg() { return cfg && { repo: cfg.repo, branch: cfg.branch, hasToken: !!cfg.token }; },
      mark(path) { dirty[path] = (dirty[path] || 0) + 1; saveDirty(); emit(); if (cfg) schedule(); },
      // Mark every document on the phone as unsent (first connect, or after a reset).
      markAll(paths) { for (const p of paths) dirty[p] = (dirty[p] || 0) + 1; saveDirty(); emit(); },
      configure({ repo, token, branch = 'main' }) {
        const changedRepo = !cfg || cfg.repo !== repo;
        cfg = { repo: repo.trim(), token: (token || (cfg && cfg.token) || '').trim(), branch };
        o.save('sync.cfg', cfg);
        if (changedRepo) { meta.sha = {}; meta.head = null; meta.tree = null; meta.last = null; }
        meta.error = null; saveMeta(); emit();
      },
      disconnect() { cfg = null; o.save('sync.cfg', null); meta.error = null; saveMeta(); emit(); },
    };
  }

  root.createSync = createSync;
  root.SyncInternals = { blobSha, mergeMonth, b64Text, toB64, toText, explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSync, SyncInternals: root.SyncInternals };
})(typeof window !== 'undefined' ? window : globalThis);
