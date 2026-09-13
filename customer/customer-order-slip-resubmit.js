(() => {
  'use strict';
  const M = window.APServiceMPA;
  if (!M || document.body.dataset.page !== 'order' || window.__APServiceOrderDetailCore) return;
  const $ = selector => document.querySelector(selector);
  const orderId = new URLSearchParams(location.search).get('id') || '';
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const fetchContext = async user => {
    const orders = await M.request(`delivery_orders?select=id,status,payment_method,checkout_group_id&customer_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(orderId)}&limit=1`, { private: true, forceFresh: true, cacheKey: `customer-order-slip-order:${user.id}:${orderId}` });
    const order = orders?.[0] || null;
    if (!order?.checkout_group_id) return { order, payment: null };
    const payments = await M.request(`checkout_group_payments?select=status,expected_amount,reviewer_note,slip_path&checkout_group_id=eq.${encodeURIComponent(order.checkout_group_id)}&limit=1`, { private: true, forceFresh: true, cacheKey: `customer-order-slip-payment:${user.id}:${order.checkout_group_id}` });
    return { order, payment: payments?.[0] || null };
  };
  const render = (user, { order, payment }) => {
    const host = $('#orderDetail');
    if (!host || host.querySelector('[data-slip-resubmit]')) return;
    if (!order || order.status !== 'ต้องแนบสลิปใหม่' || !payment || payment.status !== 'rejected') return;
    const section = document.createElement('section');
    section.className = 'mpa-card'; section.dataset.slipResubmit = 'true'; section.style.marginTop = '16px';
    section.innerHTML = `<h2 style="margin-top:0">แนบสลิปใหม่</h2><p class="mpa-muted">ผู้ดูแลขอให้แนบสลิปใหม่ ยอดที่ต้องชำระ ${M.ui.baht(Number(payment.expected_amount || 0))}</p>${payment.reviewer_note ? `<p class="mpa-notice" style="margin:0 0 12px">เหตุผลจากผู้ดูแล: ${esc(payment.reviewer_note)}</p>` : ''}<form id="customerSlipResubmitForm"><div class="mpa-field"><label for="slipResubmitLibrary">เลือกสลิปจากอัลบั้ม</label><input id="slipResubmitLibrary" type="file" accept="image/jpeg,image/png,image/webp"></div><div class="mpa-field"><label for="slipResubmitCamera">ถ่ายสลิปใหม่</label><input id="slipResubmitCamera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></div><p id="slipResubmitStatus" class="mpa-muted" role="status" aria-live="polite"></p><button class="mpa-button" type="submit">ส่งสลิปใหม่เพื่อตรวจสอบ</button></form>`;
    host.append(section);
    let slipFile = null;
    const status = $('#slipResubmitStatus');
    const pick = input => { const file = input.files?.[0]; if (!file) return; slipFile = file; status.textContent = `เลือก ${file.name} แล้ว ระบบจะบีบอัดและตรวจสอบเมื่อกดส่ง`; };
    $('#slipResubmitLibrary').addEventListener('change', event => pick(event.target));
    $('#slipResubmitCamera').addEventListener('change', event => pick(event.target));
    $('#customerSlipResubmitForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('[type="submit"]');
      if (!slipFile) { M.ui.setNotice('กรุณาเลือกไฟล์สลิปก่อนส่ง', 'error'); return; }
      if (!window.APServiceMedia?.uploadPrivateImage) { M.ui.setNotice('ระบบอัปโหลดสลิปยังโหลดไม่พร้อม กรุณารีเฟรชแล้วลองใหม่', 'error'); return; }
      button.disabled = true; status.textContent = 'กำลังบีบอัดและอัปโหลดสลิป…';
      try {
        const session = await M.auth.refreshSession(false);
        if (!session?.access_token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const uploaded = await window.APServiceMedia.uploadPrivateImage(slipFile, { url: M.config.url, publishableKey: M.config.publishableKey, accessToken: session.access_token, actorId: user.id, bucket: 'payment-slips', scope: `resubmit-${Date.now()}`, mediaType: 'PAYMENT_SLIP' });
        status.textContent = 'อัปโหลดแล้ว กำลังส่งให้ผู้ดูแลตรวจสอบ…';
        await M.request('rpc/resubmit_transfer_slip', { method: 'POST', private: true, body: JSON.stringify({ p_checkout_group_id: order.checkout_group_id, p_slip_path: uploaded.storageRef }) });
        M.ui.setNotice('ส่งสลิปใหม่แล้ว รอผู้ดูแลตรวจสอบอีกครั้ง');
        setTimeout(() => location.reload(), 1200);
      } catch (err) { button.disabled = false; status.textContent = ''; M.ui.setNotice(err.message || 'ส่งสลิปใหม่ไม่สำเร็จ กรุณาลองใหม่', 'error'); }
    });
  };
  const mount = async () => {
    if (!orderId) return;
    const host = $('#orderDetail');
    if (!host || host.querySelector('.mpa-loading') || host.querySelector('[data-slip-resubmit]')) return;
    const user = await M.auth.currentUser();
    if (!user) return;
    render(user, await fetchContext(user));
  };
  const observer = new MutationObserver(() => { void mount().catch(() => {}); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void mount().catch(() => {});
})();
