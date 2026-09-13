(() => {
  'use strict';

  const M = window.APServiceMPA;
  if (!M) return;

  const q = new URLSearchParams(location.search);
  const h = M.ui.escapeHtml;
  const $ = selector => document.querySelector(selector);
  const safeNext = value => {
    const candidate = String(value || '').trim();
    return /^[a-z0-9-]+\.html(?:\?[^#]*)?$/i.test(candidate) ? candidate : 'index.html';
  };
  const destination = safeNext(q.get('next'));
  const loginHref = `profile.html?next=${encodeURIComponent(destination)}`;
  const callback = new URL('auth-callback.html', document.baseURI);
  try { localStorage.setItem('apservice_auth_next', destination); } catch (_) {}

  document.body.innerHTML = `<main class="customer-register-shell"><a class="customer-register-back" href="${h(loginHref)}" aria-label="กลับไปหน้าเข้าสู่ระบบ"><span aria-hidden="true">←</span><span>กลับเข้าสู่ระบบ</span></a><header class="customer-register-head"><small>AP SERVICE · CUSTOMER</small><h1>เริ่มใช้งานด้วยอีเมล</h1><p>ไม่ต้องสร้างหรือจำรหัสผ่าน ระบบจะส่งลิงก์ยืนยันไปที่อีเมลของคุณ กด Verify เพียงครั้งเดียว แล้วกลับมากรอกข้อมูลสำหรับการจัดส่ง</p></header><section class="customer-register-card"><div class="customer-register-progress" aria-label="ขั้นตอนการสมัคร"><span class="is-active"></span><span></span><span></span></div><form id="customerRegisterForm" novalidate><section class="customer-register-section"><h2>สมัครสมาชิก</h2><p>กรอกอีเมลที่คุณเปิดดูได้ตอนนี้ เราจะส่งลิงก์ Verify ให้กดเพียงครั้งเดียว</p><label class="customer-register-field customer-register-wide"><span>อีเมล <b aria-hidden="true">*</b></span><input id="registerEmail" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required></label></section><section class="customer-register-section"><h2>หลังจากกด Verify</h2><p>ระบบจะพากลับมาที่ AP Service เพื่อกรอกชื่อ เบอร์โทรศัพท์ และที่อยู่จัดส่งที่จำเป็นต่อการใช้งาน</p></section><label class="customer-register-check"><input id="registerConsent" type="checkbox" required><span>ฉันยอมรับ <a href="privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a> และเงื่อนไขการใช้งานของ AP Service <b aria-hidden="true">*</b></span></label><button class="customer-register-submit" type="submit">ส่งลิงก์ Verify</button><p id="customerRegisterStatus" class="customer-register-status" role="status" aria-live="polite"></p></form><p class="customer-register-login">มีบัญชีอยู่แล้ว? <a href="${h(loginHref)}">เข้าสู่ระบบด้วยอีเมล</a></p></section></main>`;

  const form = $('#customerRegisterForm');
  const status = $('#customerRegisterStatus');
  const submit = form.querySelector('button[type="submit"]');
  const setStatus = (message, kind = '') => { status.textContent = message || ''; status.dataset.kind = kind; };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#registerEmail').value.trim().toLowerCase();
    if (!email || !$('#registerConsent').checked) return setStatus('กรุณากรอกอีเมลและยอมรับนโยบายความเป็นส่วนตัว', 'error');
    submit.disabled = true;
    setStatus('กำลังส่งลิงก์ยืนยันไปที่อีเมลของคุณ…', 'loading');
    try {
      await M.auth.sendMagicLink(email, callback.href);
      M.ui.cooldownSubmit(submit, 60);
      setStatus('ส่งลิงก์แล้ว กรุณาเปิดอีเมลล่าสุดแล้วกด Verify เพื่อกลับมาเริ่มใช้งาน', 'success');
    } catch (error) {
      const raw = String(error?.message || error || '').toLowerCase();
      const message = /redirect|url/.test(raw) ? 'ระบบยังไม่อนุญาตปลายทางของลิงก์ยืนยัน กรุณาติดต่อผู้ดูแลระบบ' : /rate|too many/.test(raw) ? 'ส่งลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' : 'ยังส่งลิงก์ไม่ได้ กรุณาตรวจสอบอีเมลและการเชื่อมต่อแล้วลองใหม่';
      setStatus(message, 'error');
      if (/rate|too many/.test(raw)) M.ui.cooldownSubmit(submit, 60); else submit.disabled = false;
    }
  });
})();
