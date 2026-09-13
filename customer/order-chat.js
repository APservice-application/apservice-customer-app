/* AP Order Chat — ห้องแชทผูกกับออร์เดอร์ (ลูกค้า/ร้าน/ไรเดอร์/แอดมิน).
 * ข้อความ + ข้อความเสียง ผ่าน Supabase ล้วน ไม่พึ่งเซิร์ฟเวอร์นอก
 * ประวัติลบอัตโนมัติเมื่อออร์เดอร์จบ (trigger ฝั่ง DB)
 * ใช้: APOrderChat.mount({ M, orderId, selfRole, userId, target, position })
 *      APOrderChat.openDialog({ M, orderId, selfRole, userId }) */
(function () {
  'use strict';

  const ROLE_LABEL = { customer: 'ลูกค้า', store_owner: 'ร้านค้า', rider: 'ไรเดอร์', admin: 'แอดมิน' };
  const MAX_VOICE_SECONDS = 180;
  const POLL_MS = 5000;

  const pickMime = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return cands.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } }) || '';
  };
  const extFor = mime => (mime.includes('mp4') ? 'mp4' : 'webm');

  function createPanel(M, opts) {
    const h = M.ui.escapeHtml;
    const el = document.createElement('section');
    el.className = 'mpa-card ap-order-chat';
    el.dataset.chatOrder = opts.orderId;
    el.innerHTML = `
      <div class="ap-order-chat__head"><div><strong>แชทออร์เดอร์นี้</strong>
      <p class="mpa-muted" style="margin:2px 0 0;font-size:12px">คุยได้เฉพาะลูกค้า ร้านค้า และไรเดอร์ของออร์เดอร์นี้ · ประวัติลบอัตโนมัติเมื่อออร์เดอร์จบ</p></div>
      <span class="mpa-badge ap-order-chat__sync" aria-live="polite">กำลังโหลด…</span></div>
      <div class="ap-order-chat__list" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;margin:10px 0;padding:10px;background:#f7fbfa;border:1px solid var(--ap-line,#d9e8e4);border-radius:12px;min-height:120px"></div>
      <div class="ap-order-chat__composer" style="display:flex;gap:8px;align-items:center">
        <input class="ap-order-chat__input" type="text" maxlength="2000" placeholder="พิมพ์ข้อความ…" aria-label="พิมพ์ข้อความ" style="flex:1;font:inherit;border:1px solid var(--ap-line,#d9e8e4);border-radius:12px;padding:10px">
        <button class="mpa-button ap-order-chat__send" type="button">ส่ง</button>
        <button class="mpa-button mpa-button-secondary ap-order-chat__mic" type="button" aria-label="อัดข้อความเสียง">🎙️</button>
      </div>
      <p class="mpa-muted ap-order-chat__status" aria-live="polite" style="margin:6px 0 0;font-size:12px"></p>`;
    return el;
  }

  function bubble(M, row, userId) {
    const h = M.ui.escapeHtml;
    const mine = row.sender_id === userId;
    const who = mine ? 'คุณ' : (ROLE_LABEL[row.sender_role] || row.sender_role);
    const time = row.created_at ? new Date(row.created_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
    const inner = row.kind === 'voice'
      ? `<button type="button" data-play-voice="${h(row.id)}" data-voice-path="${h(row.voice_path || '')}" style="font:inherit;border:0;background:transparent;cursor:pointer;color:inherit">▶️ ฟังข้อความเสียง (${h(String(row.voice_seconds || 0))} วิ)</button>`
      : `<div>${h(row.body || '')}</div>`;
    return `<article data-chat-id="${h(row.id)}" style="max-width:85%;padding:9px 12px;border-radius:14px;background:${mine ? 'var(--ap-brand,#0f7a5f)' : '#fff'};color:${mine ? '#fff' : 'var(--ap-ink,#1f332e)'};border:1px solid ${mine ? 'var(--ap-brand,#0f7a5f)' : 'var(--ap-line,#d9e8e4)'};align-self:${mine ? 'flex-end' : 'flex-start'}"><small style="display:block;opacity:.75;margin-bottom:3px">${h(who)} · ${h(time)}</small>${inner}</article>`;
  }

  async function accessToken(M) {
    const session = await M.auth.refreshSession(false).catch(() => M.auth.getSession());
    const token = session?.access_token || M.auth.getSession?.()?.access_token || '';
    if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    return token;
  }

  function wire(M, panel, opts) {
    const h = M.ui.escapeHtml;
    const list = panel.querySelector('.ap-order-chat__list');
    const input = panel.querySelector('.ap-order-chat__input');
    const sendBtn = panel.querySelector('.ap-order-chat__send');
    const micBtn = panel.querySelector('.ap-order-chat__mic');
    const status = panel.querySelector('.ap-order-chat__status');
    const sync = panel.querySelector('.ap-order-chat__sync');
    let lastSignature = '';
    let stopped = false;
    let recorder = null;
    let recChunks = [];
    let recTimer = null;
    let recStartedAt = 0;

    const path = `order_chat_messages?select=id,order_id,sender_id,sender_role,kind,body,voice_path,voice_seconds,created_at&order_id=eq.${encodeURIComponent(opts.orderId)}&order=created_at.asc&limit=200`;
    const nearBottom = () => (list.scrollHeight - list.scrollTop - list.clientHeight) < 80;

    const load = async () => {
      if (stopped || !document.contains(panel)) { stop(); return; }
      try {
        const rows = await M.request(path, { private: true, forceFresh: true, cacheTtlMs: 0, cacheKey: `order-chat:${opts.orderId}:${Date.now()}` });
        const signature = JSON.stringify((rows || []).map(r => r.id));
        if (signature !== lastSignature) {
          lastSignature = signature;
          const stick = nearBottom() || !list.children.length;
          list.innerHTML = (rows || []).length ? rows.map(r => bubble(M, r, opts.userId)).join('') : '<p class="mpa-muted" style="margin:auto">ยังไม่มีข้อความ เริ่มคุยได้เลย</p>';
          if (stick) list.scrollTop = list.scrollHeight;
        }
        if (sync) sync.textContent = 'อัปเดตอัตโนมัติ';
      } catch (error) {
        if (error && error.code === M.network.STALE_RESPONSE) return;
        if (sync) sync.textContent = 'อัปเดตไม่สำเร็จ · ลองใหม่';
      }
    };

    const sendText = async () => {
      const body = input.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        await M.request('order_chat_messages', {
          method: 'POST', private: true, headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ order_id: opts.orderId, sender_id: opts.userId, sender_role: opts.selfRole, kind: 'text', body: body.slice(0, 2000) })
        });
        input.value = '';
        status.textContent = '';
        await load();
      } catch (error) {
        status.textContent = error?.message || 'ส่งข้อความไม่สำเร็จ';
      }
      sendBtn.disabled = false;
    };

    const stopRecording = (cancelled) => {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      micBtn.textContent = '🎙️';
      micBtn.disabled = false;
      if (!recorder) return;
      const rec = recorder; recorder = null;
      if (cancelled) {
        try { rec.stop(); } catch (_) {}
        recChunks = [];
        status.textContent = 'ยกเลิกการอัดเสียงแล้ว';
        return;
      }
      rec.stop();
    };

    const uploadVoice = async (blob, seconds) => {
      const token = await accessToken(M);
      const mime = blob.type || 'audio/webm';
      const name = `${opts.orderId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extFor(mime)}`;
      const res = await fetch(`${M.config.url}/storage/v1/object/chat-voice/${name}`, {
        method: 'POST',
        headers: { apikey: M.config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': mime, 'x-upsert': 'false' },
        body: blob
      });
      if (!res.ok) throw new Error(`อัปโหลดเสียงไม่สำเร็จ (${res.status})`);
      await M.request('order_chat_messages', {
        method: 'POST', private: true, headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ order_id: opts.orderId, sender_id: opts.userId, sender_role: opts.selfRole, kind: 'voice', voice_path: name, voice_seconds: Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round(seconds))) })
      });
    };

    const startRecording = async () => {
      if (recorder) { stopRecording(false); return; }
      const mime = pickMime();
      if (!mime || !navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'อุปกรณ์นี้อัดเสียงไม่ได้ กรุณาพิมพ์ข้อความแทน';
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recChunks = [];
        recorder = new MediaRecorder(stream, { mimeType: mime });
        recStartedAt = Date.now();
        recorder.ondataavailable = e => { if (e.data?.size) recChunks.push(e.data); };
        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const seconds = (Date.now() - recStartedAt) / 1000;
          if (!recChunks.length || seconds < 1) { status.textContent = 'เสียงสั้นเกินไป ลองใหม่อีกครั้ง'; return; }
          micBtn.disabled = true;
          status.textContent = 'กำลังส่งข้อความเสียง…';
          try {
            await uploadVoice(new Blob(recChunks, { type: mime }), seconds);
            recChunks = [];
            status.textContent = '';
            await load();
          } catch (error) {
            status.textContent = error?.message || 'ส่งข้อความเสียงไม่สำเร็จ';
          }
          micBtn.disabled = false;
        };
        recorder.start();
        micBtn.textContent = '⏹️';
        status.textContent = 'กำลังอัด… กดอีกครั้งเพื่อส่ง (สูงสุด 3 นาที)';
        recTimer = setInterval(() => {
          const left = MAX_VOICE_SECONDS - Math.floor((Date.now() - recStartedAt) / 1000);
          if (left <= 0) stopRecording(false);
          else status.textContent = `กำลังอัด… เหลือ ${left} วินาที (กด ⏹️ เพื่อส่ง)`;
        }, 1000);
      } catch (error) {
        recorder = null;
        status.textContent = /denied|permission|NotAllowed/i.test(String(error?.message || error)) ? 'ต้องอนุญาตใช้ไมโครโฟนก่อนอัดเสียง' : 'เปิดไมโครโฟนไม่สำเร็จ';
      }
    };

    const playVoice = async button => {
      const voicePath = button.dataset.voicePath;
      if (!voicePath) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '⏳ กำลังโหลดเสียง…';
      try {
        const token = await accessToken(M);
        const res = await fetch(`${M.config.url}/storage/v1/object/authenticated/chat-voice/${voicePath}`, {
          headers: { apikey: M.config.publishableKey, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`โหลดเสียงไม่สำเร็จ (${res.status})`);
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        button.textContent = '⏸️ กำลังเล่น… กดเพื่อหยุด';
        button.disabled = false;
        let done = false;
        const finish = () => { if (done) return; done = true; try { audio.pause(); } catch (_) {} URL.revokeObjectURL(url); button.textContent = original; button.onclick = () => playVoice(button); };
        audio.onended = finish;
        audio.onerror = () => { button.textContent = 'เล่นเสียงไม่ได้'; button.disabled = false; };
        button.onclick = () => finish();
        await audio.play().catch(() => { button.textContent = 'เล่นเสียงไม่ได้'; button.disabled = false; });
      } catch (error) {
        button.textContent = original;
        button.disabled = false;
        status.textContent = error?.message || 'โหลดเสียงไม่สำเร็จ';
      }
    };

    sendBtn.addEventListener('click', sendText);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });
    micBtn.addEventListener('click', startRecording);
    list.addEventListener('click', e => {
      const btn = e.target.closest('[data-play-voice]');
      if (btn) playVoice(btn);
    });

    const timer = setInterval(load, POLL_MS);
    const stop = () => { stopped = true; clearInterval(timer); if (recTimer) clearInterval(recTimer); try { recorder?.stop(); } catch (_) {} };
    addEventListener('pagehide', stop, { once: true });
    void load();
    return { stop, reload: load };
  }

  function mount(opts) {
    const M = opts.M || window.APServiceMPA;
    if (!M || !opts.orderId || !opts.userId) return null;
    const host = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    if (!host) return null;
    if (host.parentElement?.querySelector(`[data-chat-order="${CSS.escape(String(opts.orderId))}"]`)) {
      return host.parentElement.querySelector(`[data-chat-order="${CSS.escape(String(opts.orderId))}"]`);
    }
    const panel = createPanel(M, opts);
    if (opts.position === 'after') host.insertAdjacentElement('afterend', panel);
    else host.insertAdjacentElement(opts.position === 'prepend' ? 'afterbegin' : 'beforeend', panel);
    wire(M, panel, opts);
    return panel;
  }

  function openDialog(opts) {
    const M = opts.M || window.APServiceMPA;
    if (!M) return null;
    document.querySelector('dialog[data-order-chat-dialog]')?.remove();
    const dialog = document.createElement('dialog');
    dialog.dataset.orderChatDialog = 'true';
    dialog.style.cssText = 'border:0;border-radius:16px;padding:0;max-width:min(560px,94vw);width:560px';
    dialog.innerHTML = `<div style="padding:14px"><div style="display:flex;justify-content:flex-end"><button type="button" data-close-chat class="mpa-button mpa-button-secondary">ปิด ✕</button></div><div data-chat-slot></div></div>`;
    document.body.appendChild(dialog);
    const slot = dialog.querySelector('[data-chat-slot]');
    const panel = createPanel(M, opts);
    slot.appendChild(panel);
    const api = wire(M, panel, opts);
    dialog.querySelector('[data-close-chat]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { try { api.stop(); } catch (_) {} dialog.remove(); }, { once: true });
    dialog.showModal();
    return dialog;
  }

  window.APOrderChat = Object.freeze({ mount, openDialog });
})();
