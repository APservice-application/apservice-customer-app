(() => {
  'use strict';

  const root = window;
  const SUPABASE_URL = 'https://abtsctwfkgzciseppach.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_TyJWnKkbS8vKcQKKAzoqSg_BOguwKRv';
  const AUTH = root.APServiceSupabaseAuth;
  const authClient = AUTH?.client;
  const authReady = AUTH?.ready || Promise.resolve(null);
  const STALE_RESPONSE = 'AP_SERVICE_STALE_RESPONSE';
  const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
  const withTimeoutSignal = (signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) => {
    const duration = Math.max(1_000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    const controller = new AbortController();
    const forward = () => { try { controller.abort(signal?.reason); } catch (_) { controller.abort(); } };
    if (signal) { if (signal.aborted) forward(); else signal.addEventListener('abort', forward, { once: true }); }
    const timer = setTimeout(() => controller.abort(), duration);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return controller.signal;
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>\'\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[char]));
  const baht = value => Number(value || 0).toLocaleString('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
  const nowIso = () => new Date().toISOString();
  const normalizePath = path => String(path || '').replace(/^\/+/, '');
  function getSession() { return AUTH?.status?.session || null; }
  function hasStoredSession() { return Boolean(getSession()?.access_token); }
  function token() { return getSession()?.access_token || ''; }
  function actorCacheKey() { return getSession()?.user?.id || 'anon'; }
  async function refreshSession(force = false) {
    await authReady;
    if (!authClient) return null;
    if (force) {
      const { data, error } = await authClient.auth.refreshSession();
      if (error) throw error;
      return data.session || null;
    }
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  const lifecycle = (() => {
    const cache = new Map();
    const inFlight = new Map();
    const syncJobs = new Map();
    const metrics = { requests: 0, cacheHits: 0, deduped: 0, failures: 0, aborted: 0, backgroundRuns: 0 };
    const keyFor = (method, path, options) => options.cacheKey || `${method}:${path}:${options.private ? actorCacheKey() : 'public'}:${options.forceSession ? 'session' : 'anon'}`;
    const isAbort = error => error?.name === 'AbortError' || error?.code === STALE_RESPONSE;
    function cached(key, ttl) {
      const entry = cache.get(key);
      if (!entry || !ttl || Date.now() - entry.at > ttl) return null;
      return entry.value;
    }
    function makeStaleError() { const error = new Error('ข้อมูลที่โหลดมาช้ากว่าหน้าปัจจุบันจึงไม่ถูกนำมาแสดง'); error.code = STALE_RESPONSE; return error; }
    function createScope(name = 'page') {
      const controller = new AbortController(); let active = true;
      return Object.freeze({
        name, signal: controller.signal,
        isActive: () => active && !controller.signal.aborted,
        dispose: () => { active = false; controller.abort(); },
        request: (path, options = {}) => request(path, { ...options, signal: controller.signal }).then(value => { if (!active) throw makeStaleError(); return value; }),
        requestCount: (path, options = {}) => requestCount(path, { ...options, signal: controller.signal }).then(value => { if (!active) throw makeStaleError(); return value; }),
      });
    }
    function startBackgroundSync({ key, task, onData, onError, intervalMs = 15_000, runImmediately = false } = {}) {
      if (!key || typeof task !== 'function') throw new Error('background sync ต้องกำหนด key และ task');
      syncJobs.get(key)?.stop();
      let stopped = false; let timer = null; const cadence = Math.max(15_000, Number(intervalMs) || 15_000);
      const schedule = () => { if (!stopped) timer = setTimeout(tick, cadence); };
      const tick = async () => {
        if (stopped) return;
        if (!document.hidden) {
          try { metrics.backgroundRuns += 1; const result = await task(); if (result?.changed !== false) onData?.(result?.data ?? result); }
          catch (error) { if (!isAbort(error)) onError?.(error); }
        }
        schedule();
      };
      const visibility = () => { if (!document.hidden && !stopped && !timer) void tick(); };
      document.addEventListener('visibilitychange', visibility);
      const stop = () => { stopped = true; clearTimeout(timer); timer = null; document.removeEventListener('visibilitychange', visibility); syncJobs.delete(key); };
      syncJobs.set(key, { stop });
      if (runImmediately) void tick(); else schedule();
      return stop;
    }
    function snapshotMetrics() { return Object.freeze({ ...metrics, cacheEntries: cache.size, inFlight: inFlight.size, backgroundJobs: syncJobs.size }); }
    function clearCache(prefix = '') { [...cache.keys()].filter(key => !prefix || key.startsWith(prefix)).forEach(key => cache.delete(key)); }

    async function request(path, rawOptions = {}) {
      const { cacheTtlMs = 0, cacheKey, forceFresh = false, signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, private: privateRequest = false, forceSession = false, skipRefreshRetry = false, ...fetchOptions } = rawOptions;
      const method = String(fetchOptions.method || 'GET').toUpperCase();
      const publicRead = method === 'GET' && !privateRequest;
      const key = keyFor(method, path, { cacheKey, private: privateRequest, forceSession });
      const ttl = method === 'GET' ? Math.max(0, Number(cacheTtlMs) || 0) : 0;
      if (!forceFresh) {
        const cachedValue = cached(key, ttl);
        if (cachedValue !== null) { metrics.cacheHits += 1; return cachedValue; }
      }
      if (method === 'GET' && inFlight.has(key)) { metrics.deduped += 1; return inFlight.get(key); }
      const promise = (async () => {
        metrics.requests += 1;
        const run = () => {
          const headers = { apikey: SUPABASE_KEY, ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}), ...(fetchOptions.headers || {}) };
          if (token() && (!publicRead || forceSession)) headers.Authorization = `Bearer ${token()}`;
          return fetch(`${SUPABASE_URL}/rest/v1/${normalizePath(path)}`, { ...fetchOptions, method, headers, signal: withTimeoutSignal(signal, timeoutMs) });
        };
        let response;
        try { response = await run(); } catch (error) { if (isAbort(error)) metrics.aborted += 1; else metrics.failures += 1; throw error; }
        if (response.status === 401 && token() && !skipRefreshRetry) { await refreshSession(true); response = await run(); }
        const text = await response.text(); let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!response.ok) { metrics.failures += 1; throw new Error(data?.message || data?.hint || `ไม่สามารถโหลดข้อมูลได้ (${response.status})`); }
        if (ttl) cache.set(key, { at: Date.now(), value: data });
        return data;
      })();
      if (method === 'GET') inFlight.set(key, promise);
      try { return await promise; } finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
    }
    async function requestCount(path, rawOptions = {}) {
      const { cacheTtlMs = 0, cacheKey, forceFresh = false, signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, private: privateRequest = false, forceSession = false, skipRefreshRetry = false, ...fetchOptions } = rawOptions;
      const method = 'HEAD'; const publicRead = !privateRequest; const key = keyFor(method, path, { cacheKey, private: privateRequest, forceSession }); const ttl = Math.max(0, Number(cacheTtlMs) || 0);
      if (!forceFresh) { const cachedValue = cached(key, ttl); if (cachedValue !== null) { metrics.cacheHits += 1; return cachedValue; } }
      if (inFlight.has(key)) { metrics.deduped += 1; return inFlight.get(key); }
      const promise = (async () => {
        metrics.requests += 1;
        const run = () => { const headers = { apikey: SUPABASE_KEY, Prefer: 'count=exact', ...(fetchOptions.headers || {}) }; if (token() && (!publicRead || forceSession)) headers.Authorization = `Bearer ${token()}`; return fetch(`${SUPABASE_URL}/rest/v1/${normalizePath(path)}`, { ...fetchOptions, method, headers, signal: withTimeoutSignal(signal, timeoutMs) }); };
        let response;
        try { response = await run(); } catch (error) { if (isAbort(error)) metrics.aborted += 1; else metrics.failures += 1; throw error; }
        if (response.status === 401 && token() && !skipRefreshRetry) { await refreshSession(true); response = await run(); }
        const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!response.ok) { metrics.failures += 1; throw new Error(data?.message || data?.hint || `ไม่สามารถนับข้อมูลได้ (${response.status})`); }
        const match = String(response.headers.get('content-range') || '').match(/\/(\d+)$/); if (!match) throw new Error('ไม่พบจำนวนข้อมูลจากเซิร์ฟเวอร์'); const total = Number(match[1]);
        if (ttl) cache.set(key, { at: Date.now(), value: total }); return total;
      })();
      inFlight.set(key, promise); try { return await promise; } finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
    }
    return Object.freeze({ request, requestCount, createScope, startBackgroundSync, snapshotMetrics, clearCache, STALE_RESPONSE });
  })();

  const AUTH_CODE_VERIFIER_KEY = 'apservice_auth_code_verifier_v1';
  const requireAuthClient = async () => { await authReady; if (!authClient) throw new Error('ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน'); return authClient; };
  const throwAuthError = error => { if (error) throw error; };
  const readCodeVerifier = () => { try { return localStorage.getItem(AUTH_CODE_VERIFIER_KEY) || ''; } catch (_) { return ''; } };
  const clearCodeVerifier = () => { try { localStorage.removeItem(AUTH_CODE_VERIFIER_KEY); } catch (_) {} };
  async function signIn(email, password) { const client = await requireAuthClient(); const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password }); throwAuthError(error); return data; }
  async function signInWithUsername(username, password, role) { const identifier = String(username || '').trim().toLowerCase(); if (!identifier || !password || !role) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน'); const response = await fetch(`${SUPABASE_URL}/functions/v1/role-access`, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', role, identifier, password }) }); const body = await response.json().catch(() => null); if (!response.ok || !body?.session?.access_token) throw new Error(body?.error || 'ไม่สามารถยืนยันชื่อผู้ใช้และรหัสผ่านได้'); const client = await requireAuthClient(); const result = await client.auth.setSession({ access_token: body.session.access_token, refresh_token: body.session.refresh_token }); throwAuthError(result.error); return result.data; }
  async function signInWithOAuth(provider, redirectTo, options = {}) { const client = await requireAuthClient(); const result = await client.auth.signInWithOAuth({ provider: String(provider || '').trim().toLowerCase(), options: { redirectTo, ...options } }); throwAuthError(result.error); if (result.data?.url) location.assign(result.data.url); return result.data; }
  async function sendMagicLink(email, redirectTo, { createUser = true } = {}) { const client = await requireAuthClient(); const { data, error } = await client.auth.signInWithOtp({ email: String(email || '').trim().toLowerCase(), options: { emailRedirectTo: redirectTo, shouldCreateUser: createUser !== false } }); throwAuthError(error); return data; }
  async function signUp({ email, password, data = {} } = {}) { const client = await requireAuthClient(); const result = await client.auth.signUp({ email, password, options: { data } }); throwAuthError(result.error); return result.data; }
  async function sendPasswordRecovery(email, redirectTo) { const client = await requireAuthClient(); const result = await client.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), { redirectTo }); throwAuthError(result.error); return result.data; }
  async function resetPassword(email, redirectTo) { return sendPasswordRecovery(email, redirectTo); }
  async function exchangeCodeForSession(code) { const client = await requireAuthClient(); if (!String(code || '').trim()) throw new Error('ไม่พบรหัสยืนยันจากลิงก์'); const result = await client.auth.exchangeCodeForSession(String(code).trim()); throwAuthError(result.error); clearCodeVerifier(); return result.data.session; }
  async function verifyMagicLinkTokenHash(tokenHash) { const client = await requireAuthClient(); if (!String(tokenHash || '').trim()) throw new Error('ไม่พบ token ยืนยันอีเมล'); const result = await client.auth.verifyOtp({ token_hash: String(tokenHash).trim(), type: 'email' }); throwAuthError(result.error); return result.data.session; }
  async function acceptRecoveryFromHash() { const client = await requireAuthClient(); const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); const accessToken = hash.get('access_token'); const refreshToken = hash.get('refresh_token'); if (!accessToken || !refreshToken) return null; const result = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }); throwAuthError(result.error); history.replaceState(null, '', `${location.pathname}${location.search}`); return result.data.session; }
  const clearAuthUrl = url => { const clean = new URL(url.href); ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type'].forEach(key => clean.searchParams.delete(key)); history.replaceState(null, '', `${clean.pathname}${clean.search}`); };
  async function processCallback() { const client = await requireAuthClient(); const url = new URL(location.href); const hash = new URLSearchParams(String(url.hash || '').replace(/^#/, '')); const errorCode = hash.get('error') || url.searchParams.get('error'); const errorDescription = hash.get('error_description') || url.searchParams.get('error_description'); if (errorCode) { clearAuthUrl(url); throw new Error(errorDescription || errorCode); } const code = url.searchParams.get('code'); if (code) { const session = await exchangeCodeForSession(code); clearAuthUrl(url); return session; } const tokenHash = url.searchParams.get('token_hash'); if (tokenHash) { const session = await verifyMagicLinkTokenHash(tokenHash); clearAuthUrl(url); return session; } const accessToken = hash.get('access_token'); const refreshToken = hash.get('refresh_token'); if (accessToken && refreshToken) { const result = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }); throwAuthError(result.error); clearAuthUrl(url); return result.data.session; } const { data, error } = await client.auth.getSession(); throwAuthError(error); return data.session || null; }
  async function acceptMagicLinkFromHash() { return processCallback(); }
  async function updatePassword(password) { if (String(password || '').length < 8) throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); const client = await requireAuthClient(); const result = await client.auth.updateUser({ password }); throwAuthError(result.error); return result.data.user; }
  let currentUserInFlight = null;
  function currentUser() {
    if (currentUserInFlight) return currentUserInFlight;
    const pending = (async () => {
      const client = await requireAuthClient();
      const readUser = async () => { const { data, error } = await client.auth.getUser(); if (error) throw error; return data.user || null; };
      try {
        const user = await readUser();
        if (user) return user;
        return null;
      } catch (error) {
        const raw = String(error?.message || '');
        if (!/invalid|expired|refresh|session/i.test(raw)) throw error;
        try { await client.auth.refreshSession(); return await readUser(); } catch (refreshError) {
          if (/invalid|expired|refresh|session/i.test(String(refreshError?.message || ''))) return null;
          throw refreshError;
        }
      }
    })();
    currentUserInFlight = pending;
    pending.then(() => { if (currentUserInFlight === pending) currentUserInFlight = null; }, () => { if (currentUserInFlight === pending) currentUserInFlight = null; });
    return pending;
  }
  async function rolesFor(userId, { forceFresh = false } = {}) { if (!userId || !token()) return []; const rows = await lifecycle.request(`user_roles?select=role&user_id=eq.${encodeURIComponent(userId)}`, { private: true, forceFresh, cacheTtlMs: 10_000, cacheKey: `customer-roles:${userId}` }); return (rows || []).map(row => row.role).filter(Boolean); }
  async function customerRolesFor(userId) { let roles = []; for (let attempt = 0; attempt < 8; attempt += 1) { roles = await rolesFor(userId, { forceFresh: attempt > 0 }); if (roles.includes('customer') || attempt === 7) return roles; await new Promise(resolve => setTimeout(resolve, 250)); } return roles; }
  async function requireRole(role, { loginUrl = 'index.html', container = document.querySelector('[data-page-content]'), renderLoading = true } = {}) { if (container && renderLoading) container.innerHTML = loading('กำลังตรวจสอบสิทธิ์การใช้งาน…'); const user = await currentUser(); if (!user) { location.replace(loginUrl); return null; } let roles; try { roles = await rolesFor(user.id); } catch (_) { return { user, roles: null }; } if (!roles.includes(role)) { lifecycle.clearCache(); location.replace(loginUrl); return null; } return { user, roles }; }
  async function signOut(next = 'index.html') { lifecycle.clearCache(); const client = await requireAuthClient(); await client.auth.signOut(); location.assign(next); }
  function defaultLoginUrl() { const path = String(location.pathname || '').toLowerCase(); return path.includes('/merchant/') || path.includes('/rider/') ? 'login.html' : 'index.html'; }
  function confirmSignOut(next = defaultLoginUrl()) { return new Promise(resolve => { document.getElementById('mpa-signout-confirm')?.remove(); const modal = document.createElement('div'); modal.id = 'mpa-signout-confirm'; modal.setAttribute('role', 'presentation'); modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:end center;padding:16px;background:rgba(11,46,37,.45)'; modal.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="mpa-signout-title" style="width:min(100%,440px);background:#fff;border-radius:22px;padding:22px;box-shadow:0 20px 55px rgba(0,0,0,.24)"><h2 id="mpa-signout-title" style="margin:0;color:#143B31;font-size:20px">ยืนยันการออกจากระบบ</h2><p style="margin:10px 0 20px;color:#61766F;line-height:1.55">คุณต้องการออกจากระบบในอุปกรณ์นี้ใช่หรือไม่</p><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="mpa-button mpa-button-secondary" data-cancel>ยกเลิก</button><button type="button" class="mpa-button" data-confirm data-logout-bypass="true">ออกจากระบบ</button></div></section>'; document.body.append(modal); const close = value => { modal.remove(); resolve(value); }; modal.addEventListener('click', event => { if (event.target === modal) close(false); }); modal.querySelector('[data-cancel]').onclick = () => close(false); modal.querySelector('[data-confirm]').onclick = () => { close(true); signOut(next); }; }); }
  function installLogoutConfirmation() { document.addEventListener('click', event => { const control = event.target?.closest?.('button,a,[role="button"]'); const label = String(control?.textContent || '').replace(/\s+/g, ' ').trim(); if (!control || control.closest?.('#mpa-signout-confirm') || control.dataset.logoutBypass === 'true' || !/^ออกจากระบบ$/.test(label)) return; event.preventDefault(); event.stopImmediatePropagation(); void confirmSignOut(defaultLoginUrl()); }, true); }
  if (typeof document !== 'undefined') installLogoutConfirmation();
  const DEVICE_AUTH_KEY = 'apservice_customer_device_auth_v1';
  const deviceAuth = (() => {
    const read = () => { try { const value = JSON.parse(localStorage.getItem(DEVICE_AUTH_KEY) || 'null'); return value && typeof value === 'object' ? value : null; } catch (_) { return null; } };
    const write = value => { try { localStorage.setItem(DEVICE_AUTH_KEY, JSON.stringify(value)); } catch (_) {} return value; };
    const clear = () => { try { localStorage.removeItem(DEVICE_AUTH_KEY); } catch (_) {} };
    const validPin = pin => /^\d{4}$/.test(String(pin || ''));
    const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    async function hash(pin, salt) { if (!root.crypto?.subtle || !root.crypto?.getRandomValues) throw new Error('อุปกรณ์นี้ไม่รองรับการตั้ง PIN อย่างปลอดภัย'); const key = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']); const bits = await root.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(String(salt)), iterations: 100000, hash: 'SHA-256' }, key, 256); return hex(bits); }
    async function setPin(pin, email = '') { if (!validPin(pin)) throw new Error('PIN ต้องเป็นตัวเลข 4 หลัก'); const saltBytes = new Uint8Array(16); root.crypto.getRandomValues(saltBytes); const salt = hex(saltBytes); const now = new Date().toISOString(); write({ version: 1, email: String(email || '').trim().toLowerCase(), salt, pinHash: await hash(pin, salt), failedAttempts: 0, lastActivityAt: now }); return { configured: true }; }
    async function verifyPin(pin) { const state = read(); if (!state?.pinHash || !state?.salt) return { ok: false, reason: 'not-configured' }; const candidate = await hash(pin, state.salt); if (candidate === state.pinHash) { write({ ...state, failedAttempts: 0, lastActivityAt: new Date().toISOString() }); return { ok: true, attempts: 0 }; } const failedAttempts = Math.min(10, Number(state.failedAttempts || 0) + 1); write({ ...state, failedAttempts }); return { ok: false, attempts: failedAttempts, attemptsLeft: Math.max(0, 10 - failedAttempts), locked: failedAttempts >= 10 }; }
    const configured = (email = '') => { const state = read(); const expected = String(email || '').trim().toLowerCase(); return Boolean(state?.pinHash && (!expected || state.email === expected)); };
    const needsUnlock = (maxAgeDays = 7, email = '') => { const state = read(); const expected = String(email || '').trim().toLowerCase(); if (!state?.pinHash || (expected && state.email !== expected)) return false; const last = Date.parse(state.lastActivityAt || ''); return !Number.isFinite(last) || Date.now() - last >= Math.max(1, Number(maxAgeDays) || 7) * 86_400_000; };
    const touch = () => { const state = read(); if (state?.pinHash) write({ ...state, lastActivityAt: new Date().toISOString() }); };
    const email = () => String(read()?.email || '');
    return Object.freeze({ read, clear, configured, needsUnlock, setPin, verifyPin, touch, email });
  })();
  function loading(label = 'กำลังโหลดข้อมูล…') { return `<div class="mpa-state mpa-loading"><span class="mpa-spinner" aria-hidden="true"></span><p>${escapeHtml(label)}</p></div>`; }
  function error(title, detail = '') { return `<div class="mpa-state mpa-error"><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}<button class="mpa-button mpa-button-secondary" type="button" onclick="location.reload()">ลองใหม่</button></div>`; }
  function empty(label = 'ยังไม่มีข้อมูลในขณะนี้') { return `<div class="mpa-state"><p>${escapeHtml(label)}</p></div>`; }
  function setNotice(message, kind = 'success') { let host = document.getElementById('mpa-toast'); if (!host) { host = document.createElement('div'); host.id = 'mpa-toast'; host.className = 'mpa-toast'; host.setAttribute('role', 'alertdialog'); host.setAttribute('aria-live', 'polite'); document.body.append(host); } const title = kind === 'error' ? 'ยังดำเนินการต่อไม่ได้' : kind === 'warning' ? 'กรุณาตรวจสอบข้อมูล' : kind === 'welcome' ? 'ยินดีต้อนรับกลับมา' : 'ดำเนินการสำเร็จ'; const duration = kind === 'welcome' ? 2000 : 15000; clearTimeout(setNotice.timer); clearInterval(setNotice.countdown); host.className = `mpa-toast ${kind}`; host.hidden = false; host.style.animation = 'none'; void host.offsetWidth; host.style.animation = ''; host.innerHTML = `<div class="mpa-toast-icon" aria-hidden="true">${kind === 'error' ? '!' : kind === 'warning' ? '?' : kind === 'welcome' ? '✓' : '✓'}</div><div class="mpa-toast-body"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p><button type="button" class="mpa-toast-ok">ตกลง</button></div><small class="mpa-toast-countdown" aria-label="เวลาที่เหลือ"></small>`; const close = () => { clearTimeout(setNotice.timer); clearInterval(setNotice.countdown); if (host.hidden || host.classList.contains('is-leaving')) return; host.classList.add('is-leaving'); setTimeout(() => { host.hidden = true; host.classList.remove('is-leaving'); }, 260); }; host.querySelector('.mpa-toast-ok').onclick = close; host.onclick = event => { if (event.target.closest('.mpa-toast-ok')) return; close(); }; let remaining = Math.ceil(duration / 1000); const countdown = host.querySelector('.mpa-toast-countdown'); countdown.textContent = `${remaining}s`; setNotice.countdown = setInterval(() => { remaining -= 1; countdown.textContent = `${Math.max(0, remaining)}s`; if (remaining <= 0) clearInterval(setNotice.countdown); }, 1000); setNotice.timer = setTimeout(close, duration); }
  const cart = { key: 'apservice_mpa_cart_v1', read() { try { return JSON.parse(sessionStorage.getItem(this.key) || '[]'); } catch { return []; } }, write(items) { sessionStorage.setItem(this.key, JSON.stringify(items)); root.dispatchEvent(new CustomEvent('apservice:cart')); }, add(item) { const items = this.read(); const optionKey = String(item.optionKey || ''); const cartItem = { ...item, optionKey, cartKey: `${item.storeId || ''}:${item.id || ''}:${optionKey}`, qty: 1 }; const index = items.findIndex(row => row.id === cartItem.id && row.storeId === cartItem.storeId && String(row.optionKey || '') === optionKey); if (index >= 0) items[index].qty += 1; else items.push(cartItem); this.write(items); }, clear() { this.write([]); }, total() { return this.read().reduce((sum, row) => sum + Number(row.price || 0) * Number(row.qty || 0), 0); } };

  const sessionRestoreReady = authReady;
  root.APServiceMPA = Object.freeze({ version: 'mpa-runtime-v6-supabase-auth-client', config: { url: SUPABASE_URL, publishableKey: SUPABASE_KEY }, request: lifecycle.request, requestCount: lifecycle.requestCount, network: lifecycle, STALE_RESPONSE, auth: { getSession, refreshSession, signIn, signInWithUsername, signUp, sendMagicLink, signInWithOAuth, sendPasswordRecovery, resetPassword, exchangeCodeForSession, verifyMagicLinkTokenHash, processCallback, acceptMagicLinkFromHash, acceptRecoveryFromHash, updatePassword, signOut, confirmSignOut, currentUser, hasStoredSession, sessionRestoreReady, rolesFor, customerRolesFor, requireRole, device: deviceAuth }, ui: { escapeHtml, baht, nowIso, loading, error, empty, setNotice }, cart });
  function installImageSourceChoices() {
    const isImageInput = input => input?.matches?.('input[type="file"]') && /image\//i.test(String(input.getAttribute('accept') || ''));
    const existingSourceControl = input => /^(เลือกจากคลัง|ถ่ายรูป|เปลี่ยนจากคลัง|ถ่ายรูปใหม่)/.test(String(input.closest('label')?.textContent || '').replace(/\s+/g, ' ').trim()) || Boolean(input.closest('[data-image-source-choices]'));
    const enhance = input => {
      if (!isImageInput(input) || input.dataset.imageSourceChoices === 'true' || existingSourceControl(input)) return;
      input.dataset.imageSourceChoices = 'true'; input.hidden = true; input.tabIndex = -1;
      const controls = document.createElement('span'); controls.dataset.imageSourceChoices = 'true'; controls.style.cssText = 'display:inline-flex;gap:8px;flex-wrap:wrap;vertical-align:middle';
      const choose = (label, camera) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'mpa-button mpa-button-secondary'; button.textContent = label; button.addEventListener('click', () => { if (camera) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture'); input.click(); }); return button; };
      controls.append(choose('เลือกจากคลังภาพ', false), choose('ถ่ายรูปด้วยกล้อง', true));
      const anchor = input.closest('label') || input; anchor.insertAdjacentElement('afterend', controls);
    };
    const scan = node => { if (!(node instanceof Element || node instanceof Document)) return; if (node instanceof Element && isImageInput(node)) enhance(node); node.querySelectorAll?.('input[type="file"][accept*="image/"]').forEach(enhance); };
    const start = () => { scan(document); new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
  function installCustomerVisuals() {
    if (typeof document === 'undefined' || !document.body?.dataset?.page) return;
    const safe = value => String(value || '').trim();
    const validUrl = value => /^https:\/\//i.test(safe(value)) ? safe(value) : '';
    const motions = new Set(['none','summer','rainy','spring','songkran','loy_krathong','christmas','new_year','valentines','halloween','lunar_new_year','ramadan_eid','diwali','winter']);
    const directions = new Set(['down','left','right','diagonal','up']);
    const clamp = (value, fallback = .86) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; };
    const inWindow = item => { const now = Date.now(); const start = Date.parse(item?.startsAt || ''); const end = Date.parse(item?.endsAt || ''); return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now); };
    const addMotion = (key, direction = 'down', effectUrl = '') => {
      const motion = motions.has(key) ? key : 'none'; if (motion === 'none') return;
      const flow = directions.has(direction) ? direction : 'down';
      const layer = document.createElement('div'); layer.className = `ap-customer-motion ap-motion-${motion} ap-motion-direction-${flow}`; layer.setAttribute('aria-hidden', 'true');
      if (validUrl(effectUrl)) layer.style.setProperty('--ap-motion-effect-url', `url("${effectUrl.replace(/"/g, '')}")`);
      for (let i = 0; i < 18; i += 1) { const particle = document.createElement('i'); particle.style.setProperty('--i', i); particle.style.setProperty('--x', `${(i * 37) % 100}%`); particle.style.setProperty('--delay', `${(i % 9) * -1.2}s`); particle.style.setProperty('--size', `${6 + (i % 5) * 3}px`); layer.append(particle); }
      document.body.append(layer); document.body.dataset.customerMotion = motion; document.body.dataset.customerMotionDirection = flow;
    };
    const apply = value => {
      const source = value && typeof value === 'object' ? value : {}; const pageKey = document.body.dataset.page; const page = source.pages?.[pageKey] && typeof source.pages[pageKey] === 'object' ? source.pages[pageKey] : {}; const fallback = source.default && typeof source.default === 'object' ? source.default : {}; const selected = { ...fallback, ...page };
      let motion = selected.motion === 'inherit' || !motions.has(selected.motion) ? fallback.motion : selected.motion; const festival = source.festival && typeof source.festival === 'object' ? source.festival : {};
      let direction = selected.direction === 'inherit' || !directions.has(selected.direction) ? (fallback.direction || 'down') : selected.direction; const effectUrl = validUrl(selected.effectUrl || fallback.effectUrl); if (festival.active && festival.motion && inWindow(festival)) { motion = festival.motion; direction = festival.direction === 'inherit' || !directions.has(festival.direction) ? direction : festival.direction; } const background = validUrl(selected.backgroundUrl || fallback.backgroundUrl); const root = document.documentElement;
      root.style.setProperty('--ap-customer-overlay', String(clamp(selected.overlay, .86))); if (background) { document.body.dataset.customerVisual = 'true'; document.body.style.setProperty('--ap-customer-background', `url("${background.replace(/"/g, '')}")`); document.body.style.setProperty('--ap-customer-background-position', safe(selected.position) || 'center'); document.body.style.setProperty('--ap-customer-background-size', safe(selected.size) || 'cover'); }
      addMotion(motion, direction, effectUrl);
    };
    lifecycle.request('platform_configs?select=value&key=eq.customer_visuals&limit=1', { cacheTtlMs: 60_000, cacheKey: 'customer-visuals-public' }).then(rows => apply(rows?.[0]?.value)).catch(() => {});
  }
  if (typeof document !== 'undefined') { installImageSourceChoices(); installCustomerVisuals(); }
})();
