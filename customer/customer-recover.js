(() => {
  'use strict';
  const M = window.APServiceMPA;
  if (!M) return;

  const q = new URLSearchParams(location.search);
  const h = M.ui.escapeHtml;
  const $ = selector => document.querySelector(selector);
  const emailHint = String(q.get('email') || '').trim().toLowerCase();

  function recoveryRedirectUrl() {
    const configured = document.querySelector('meta[name="apservice-customer-recovery-url"]')?.content?.trim();
    if (configured) return new URL(configured, document.baseURI).href;

    const current = new URL(location.href);
    const customerPath = current.pathname.match(/^(.*\/customer\/)(?:recover\.html)?$/i)?.[1];
    if (/github\.io$/i.test(current.hostname)) {
      const basePath = customerPath?.includes('/apservice-customer-app/') ? customerPath : '/apservice-customer-app/customer/';
      return new URL('update-password.html', `${current.origin}${basePath}`).href;
    }
    if (customerPath) return new URL('update-password.html', `${current.origin}${customerPath}`).href;

    return new URL('customer/update-password.html', current.origin).href;
  }

  document.body.innerHTML = `<main class="customer-register-shell"><a class="customer-register-back" href="profile.html" aria-label="กลับไปหน้าเข้าสู่ระบบ"><span aria-hidden="true">←</span><span>กลับเข้าสู่ระบบ</span></a><header class="customer-register-head"><small>AP SERVICE · ACCOUNT RECOVERY</small><h1>ตั้งรหัสผ่านใหม่</h1><p>หากอีเมลนี้มีบัญชีอยู่ ระบบจะส่งลิงก์ที่ปลอดภัยให้คุณตั้งรหัสผ่านใหม่</p></header><section class="customer-register-card"><form id="customerRecoveryForm" novalidate><section class="customer-register-section"><h2>ยืนยันอีเมล</h2><p>เพื่อความเป็นส่วนตัว หน้านี้จะแสดงผลเหมือนกัน ไม่ว่าอีเมลนั้นจะมีบัญชีอยู่หรือไม่</p><label class="customer-register-field"><span>อีเมล</span><input id="recoveryEmail" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required value="${h(emailHint)}"></label></section><button class="customer-register-submit" type="submit">ส่งลิงก์ตั้งรหัสผ่านใหม่</button><p id="customerRecoveryStatus" class="customer-register-status" role="status" aria-live="polite"></p></form><p class="customer-register-login">นึก รหัสผ่านได้แล้ว? <a href="profile.html">เข้าสู่ระบบ</a></p></section></main>`;

  const form = $('#customerRecoveryForm');
  const status = $('#customerRecoveryStatus');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#recoveryEmail').value.trim().toLowerCase();
    if (!email) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = 'กำลังส่งคำขอ…';
    try {
      const redirectTo = recoveryRedirectUrl();
      await M.auth.sendPasswordRecovery(email, redirectTo);
      M.ui.cooldownSubmit(submit, 60);
      status.textContent = 'หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว กรุณาตรวจ Inbox และ Spam.';
      status.dataset.kind = 'success';
    } catch (error) {
      const detail = String(error?.message || '');
      const rateLimited = /too many|rate limit/i.test(detail);
      status.textContent = /redirect|url/i.test(detail) ? 'ยังตั้งค่าปลายทางอีเมลไม่สมบูรณ์ กรุณาลองใหม่ภายหลังหรือติดต่อผู้ดูแล' : rateLimited ? 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' : 'ยังส่งคำขอไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่';
      status.dataset.kind = 'error';
      if (rateLimited) { M.ui.cooldownSubmit(submit, 60); return; }
    } finally {
      if (!submit.disabled || submit.textContent.indexOf('ส่งอีกครั้งใน') !== 0) submit.disabled = false;
    }
  });
})();
