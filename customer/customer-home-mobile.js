(() => {
  'use strict';
  const M = window.APServiceMPA;
  if (!M || document.body.dataset.page !== 'home') return;
  const h = value => M.ui.escapeHtml(String(value ?? ''));
  const $ = selector => document.querySelector(selector);
  const safeHref = value => { try { const url = new URL(String(value || ''), location.href); return url.protocol === 'https:' || url.origin === location.origin ? url.href : ''; } catch (_) { return ''; } };
  const safeImage = value => /^https:\/\//i.test(String(value || '').trim()) ? String(value).trim() : '';
  const terminal = new Set(['สำเร็จ', 'ยกเลิก', 'cancelled', 'completed', 'delivered']);
  const storeFields = 'id,name,emoji,description,rating,review_count,eta,icon_url,background_url,category_id,category_name,category_icon,active';

  function renderCart() {
    const cart = $('.customer-cart-fab'); if (!cart) return;
    const count = M.cart.read().reduce((total, item) => total + Number(item.qty || 0), 0);
    cart.classList.add('customer-bottom-cart');
    cart.hidden = !count;
    cart.style.display = count ? 'flex' : 'none';
    cart.innerHTML = `<span aria-hidden="true">🛒</span><strong>ดูตะกร้าสินค้า</strong><b>${count}</b>`;
  }

  function enhanceNavigation(nav) {
    if (!nav || nav.querySelector('a[href*="notifications.html"]')) return;
    const link = document.createElement('a');
    link.href = 'notifications.html';
    link.textContent = 'แจ้งเตือน';
    link.dataset.homeNav = 'notifications';
    link.setAttribute('aria-label', 'การแจ้งเตือน');
    const profile = nav.querySelector('a[href*="profile.html"]');
    nav.insertBefore(link, profile || null);
  }

  async function syncRegisterVisibility() {
    const registerLink = document.querySelector('.customer-home-register');
    if (!registerLink) return;
    registerLink.hidden = false;
    try {
      const user = await M.auth.currentUser();
      if (!user) return;
      const profiles = await M.request(`user_profiles?select=id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { private: true, cacheTtlMs: 20_000, cacheKey: `customer-home-profile-exists:${user.id}` });
      registerLink.hidden = Boolean(profiles?.length);
    } catch (_) {
      registerLink.hidden = false;
    }
  }
  async function loadDelivery() {
    const label = $('#homeDeliveryLabel'); if (!label) return;
    try {
      const user = await M.auth.currentUser();
      if (!user) { label.textContent = 'เข้าสู่ระบบเพื่อเลือกที่อยู่จัดส่ง'; return; }
      const rows = await M.request(`user_profiles?select=address&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { private: true, cacheTtlMs: 20_000, cacheKey: `customer-home-address:${user.id}` });
      label.textContent = String(rows?.[0]?.address || '').trim() || 'ตั้งค่าที่อยู่จัดส่ง';
    } catch (_) { label.textContent = 'ตั้งค่าที่อยู่จัดส่ง'; }
  }

  async function loadActiveOrder() {
    const host = $('#homeOrderTracker'); if (!host) return;
    try {
      const user = await M.auth.currentUser(); if (!user) { host.hidden = true; return; }
      const rows = await M.request(`delivery_orders?select=id,store_name,status,ordered_at&customer_id=eq.${encodeURIComponent(user.id)}&order=ordered_at.desc&limit=10`, { private: true, cacheTtlMs: 12_000, cacheKey: `customer-home-active-order:${user.id}` });
      const order = (rows || []).find(row => !terminal.has(String(row.status || '').trim().toLowerCase()) && !terminal.has(String(row.status || '').trim()));
      if (!order) { host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = `<a class="customer-home-tracker" href="order.html?id=${encodeURIComponent(order.id)}"><span class="customer-home-tracker__icon" aria-hidden="true">🛵</span><span class="customer-home-tracker__copy"><small>ออร์เดอร์ที่กำลังดำเนินการ</small><strong>${h(order.store_name || 'ติดตามสถานะออร์เดอร์')}</strong><small>${h(order.status || 'กำลังอัปเดตสถานะ')}</small></span><span class="customer-home-tracker__go">ดู ›</span></a>`;
    } catch (_) { host.hidden = true; }
  }

  function storeReady(store) {
    if (store?.active === false) return false;
    const status = String(store?.status || '').trim().toLowerCase();
    return !['closed', 'inactive', 'offline', 'unavailable'].includes(status);
  }

  function storeVisual(store, className = 'customer-home-store-card__visual') {
    const background = safeImage(store?.background_url);
    const icon = safeImage(store?.icon_url);
    const emoji = String(store?.emoji || '🍽️').slice(0, 12);
    return `<span class="${className}${background ? ' has-background' : ''}">${background ? `<img class="${className}-background" src="${h(background)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}${icon ? `<img class="${className}-icon" src="${h(icon)}" alt="โลโก้ ${h(store?.name || 'ร้านค้า')}" loading="lazy" decoding="async" onerror="this.remove()">` : `<span class="${className}-emoji" aria-hidden="true">${h(emoji)}</span>`}</span>`;
  }

  function storeCard(store, featured = false) {
    const href = `store.html?id=${encodeURIComponent(store.id)}`;
    const rating = Number(store.rating);
    const ratingLabel = Number.isFinite(rating) && rating > 0 ? `★ ${rating.toFixed(1)}` : 'ยังไม่มีคะแนน';
    const stateLabel = storeReady(store) ? 'เปิด' : 'ปิด';
    return `<a class="customer-home-store-card${featured ? ' customer-home-store-card--featured' : ''}" href="${h(href)}" aria-label="ดูเมนูร้าน ${h(store.name || 'ร้านค้า')}">${storeVisual(store)}<span class="customer-home-store-card__body"><span class="customer-home-store-card__state ${storeReady(store) ? 'is-open' : 'is-closed'}">${stateLabel}</span><strong>${h(store.name || 'ร้านค้า')}</strong><span class="customer-home-store-card__meta">${h(ratingLabel)} · ${h(store.eta || (storeReady(store) ? 'พร้อมให้บริการ' : 'ปิดชั่วคราว'))}</span></span></a>`;
  }

  function renderDiscovery(host, stores, categories) {
    const usable = (stores || []).slice().sort((a, b) => Number(storeReady(b)) - Number(storeReady(a)) || Number(b.rating || 0) - Number(a.rating || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    const featured = usable.slice(0, 8);
    const groups = new Map();
    usable.forEach(store => { const id = String(store.category_id || store.category_name || 'uncategorized'); const current = groups.get(id) || { id, name: String(store.category_name || 'ร้านค้าอื่น ๆ'), icon: String(store.category_icon || '🏪'), stores: [] }; current.stores.push(store); groups.set(id, current); });
    const categoryList = (categories || []).map(item => ({ id: String(item.id || item.category_id || ''), name: String(item.name || item.category_name || item.title || ''), icon: String(item.icon || item.category_icon || '🏷️') })).filter(item => item.id && item.name);
    categoryList.forEach(item => { if (!groups.has(item.id)) groups.set(item.id, { ...item, stores: [] }); });
    const populated = [...groups.values()].filter(group => group.stores.length).sort((a, b) => b.stores.length - a.stores.length || a.name.localeCompare(b.name, 'th')).slice(0, 5);
    if (!featured.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `<section class="customer-home-discovery" aria-labelledby="homeFeaturedTitle"><div class="customer-section-head customer-section-head--home"><div><small class="customer-content-eyebrow">FEATURED STORES</small><h2 id="homeFeaturedTitle">ร้านแนะนำใกล้คุณ</h2><p>คัดเลือกจากข้อมูลร้านจริงในระบบ</p></div><a class="customer-home-see-all" href="stores.html">ดูทั้งหมด <span aria-hidden="true">›</span></a></div><div class="customer-home-featured-rail" aria-label="ร้านแนะนำ">${featured.map(store => storeCard(store, true)).join('')}</div></section><section class="customer-home-categories" aria-labelledby="homeCategoriesTitle"><div class="customer-section-head customer-section-head--home"><div><small class="customer-content-eyebrow">EXPLORE BY CATEGORY</small><h2 id="homeCategoriesTitle">หมวดหมู่ร้านค้า</h2><p>เลือกดูร้านตามสิ่งที่คุณกำลังมองหา</p></div><a class="customer-home-see-all" href="stores.html">ดูทั้งหมด <span aria-hidden="true">›</span></a></div><div class="customer-home-category-rail">${populated.map(group => `<a class="customer-home-category-chip" href="stores.html?category=${encodeURIComponent(group.id)}"><span aria-hidden="true">${h(group.icon)}</span><strong>${h(group.name)}</strong><small>${group.stores.length} ร้าน</small></a>`).join('')}</div></section>`;
  }

  async function loadDiscovery() {
    const host = $('#homeDiscoveryMount'); if (!host) return;
    const attempts = [0, 450, 1200];
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      if (attempts[attempt]) await new Promise(resolve => setTimeout(resolve, attempts[attempt]));
      try {
        const [storeRows, categoryRows] = await Promise.all([
          M.request(`catalog_stores?select=${storeFields}&order=rating.desc&limit=300`, { cacheTtlMs: 30_000, cacheKey: `customer-home-discovery-stores-${attempt}` }),
          M.request('store_categories?select=id,name,icon&active=eq.true&order=sort_order.asc,name.asc', { cacheTtlMs: 60_000, cacheKey: `customer-home-discovery-categories-${attempt}` }).catch(() => []),
        ]);
        renderDiscovery(host, Array.isArray(storeRows) ? storeRows : [], Array.isArray(categoryRows) ? categoryRows : []);
        if (!host.hidden && host.children.length) return;
      } catch (_) {
        if (attempt === attempts.length - 1) host.hidden = true;
      }
    }
  }

  async function loadSponsored() {
    const section = $('.customer-sponsored'); const host = $('#sponsoredList'); if (!section || !host) return;
    const hero = $('.customer-hero'); if (hero && section.parentElement === hero.parentElement) hero.insertAdjacentElement('afterend', section);
    try {
      const rows = await M.request('platform_configs?select=value&key=eq.customer_promotions&limit=1', { cacheTtlMs: 30_000, cacheKey: 'customer-home-sponsored' });
      const value = rows?.[0]?.value; const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []; const now = Date.now();
      const items = list.map((item, index) => { const starts = Date.parse(item?.starts_at || ''), ends = Date.parse(item?.ends_at || ''); const hasStart = Boolean(String(item?.starts_at || '').trim()), hasEnd = Boolean(String(item?.ends_at || '').trim()); const image = String(item?.image_url || item?.imageUrl || '').trim(); const href = safeHref(item?.link_url || item?.linkUrl || item?.href); const legacyApproved = !item?.approval_status || item.approval_status === 'approved'; if (item?.placement !== 'customer_home_sponsored' || !legacyApproved || item?.active === false || (hasStart && (!Number.isFinite(starts) || starts > now)) || (hasEnd && (!Number.isFinite(ends) || ends < now)) || !/^https:\/\//i.test(image)) return null; return { id: String(item.id || index), image, href, title: String(item.title || 'ข้อเสนอพิเศษ'), description: String(item.description || ''), badge: String(item.badge || 'สปอนเซอร์'), priority: Number(item.priority || index + 1) }; }).filter(Boolean).sort((a, b) => a.priority - b.priority);
      if (!items.length) { section.hidden = true; return; }
      section.hidden = false; $('#sponsoredCount').textContent = `${items.length} รายการ`;
      host.innerHTML = items.map((item, index) => { const tag = item.href ? 'a' : 'div'; const href = item.href ? ` href="${h(item.href)}"` : ''; return `<${tag} class="customer-promotion"${href}><img src="${h(item.image)}" alt="${h(item.title)}" loading="${index ? 'lazy' : 'eager'}"><div class="customer-promotion__copy"><small>${h(item.badge)}</small><h2>${h(item.title)}</h2>${item.description ? `<p>${h(item.description)}</p>` : ''}${item.href ? '<span class="mpa-button mpa-button-secondary">ดูรายละเอียด</span>' : ''}</div></${tag}>`; }).join('');
      startSponsoredAutoSlide(host);
    } catch (_) { section.hidden = true; }
  }

  // Do not auto-scroll the sponsored rail. Programmatic smooth scrolling can
  // cause mobile browsers/WebViews to move the page viewport back to the rail
  // when the user is reading above or below it. Users can still swipe the rail.
  function startSponsoredAutoSlide(host) {
    if (host.__sponsoredAutoSlide) window.clearInterval(host.__sponsoredAutoSlide);
    host.__sponsoredAutoSlide = null;
    host.dataset.manualScrollOnly = 'true';
  }

  function enhance() {
    const page = $('.customer-page'); const nav = $('.customer-nav-wrap .mpa-nav'); if (!page || !nav || page.dataset.homeMobileEnhanced) return false;
    page.dataset.homeMobileEnhanced = 'true';
    enhanceNavigation(nav);
    [...nav.querySelectorAll('a')].forEach(link => { link.dataset.homeNav = link.href.includes('stores.html') ? 'stores' : link.href.includes('orders.html') ? 'orders' : link.href.includes('notifications.html') ? 'notifications' : link.href.includes('profile.html') ? 'profile' : 'home'; });
    $('#storeList')?.closest('section')?.remove();
    $('#promotionList')?.closest('.customer-promotions')?.remove();
    $('#sponsoredList')?.closest('.customer-sponsored')?.remove();
    page.insertAdjacentHTML('afterbegin', `<section class="customer-home-tools" aria-label="ค้นหาและที่อยู่จัดส่ง"><a class="customer-delivery-picker" href="profile.html?next=index.html"><span class="customer-delivery-picker__icon" aria-hidden="true">⌖</span><span class="customer-delivery-picker__copy"><small>ส่งไปที่</small><strong id="homeDeliveryLabel">กำลังตรวจสอบที่อยู่จัดส่ง…</strong></span><span class="customer-delivery-picker__chevron" aria-hidden="true">›</span></a><form class="customer-home-search" id="homeStoreSearch"><span aria-hidden="true">⌕</span><input id="homeStoreSearchInput" type="search" maxlength="100" placeholder="ค้นหาร้านค้า หรือเมนูอาหาร" autocomplete="off"><button type="submit" aria-label="ค้นหา">→</button></form><a class="customer-home-register" href="profile.html?mode=register&next=index.html"><span aria-hidden="true">✦</span><span><strong>สมัครสมาชิก Customer</strong><small>สร้างบัญชีเพื่อสั่งซื้อและติดตามออร์เดอร์</small></span><span aria-hidden="true">›</span></a></section>`);
    document.querySelector('.customer-home-register')?.setAttribute('href', 'register.html?next=index.html');
    void syncRegisterVisibility();
    const services = $('.customer-services'); const serviceSection = services?.closest('section'); const hero = page.querySelector('.customer-hero'); const insertionTarget = hero || serviceSection;
    if (insertionTarget) {
      const additions = [];
      if (!page.querySelector('#homeOrderTracker')) additions.push('<section id="homeOrderTracker" hidden></section>');
      if (!page.querySelector('#homeDiscoveryMount')) additions.push('<section id="homeDiscoveryMount" hidden></section>');
      if (!page.querySelector('.customer-sponsored')) additions.push('<section class="customer-promotions customer-sponsored" aria-label="พื้นที่สปอนเซอร์หน้าแรก" hidden><div class="customer-section-head"><div><h2>ข้อเสนอจากร้านสปอนเซอร์</h2><p>โฆษณาที่ผ่านการอนุมัติจาก AP Service</p></div><span id="sponsoredCount" class="mpa-badge">กำลังโหลด</span></div><div id="sponsoredList" class="customer-promotions__track"></div></section>');
      if (additions.length) insertionTarget.insertAdjacentHTML('afterend', additions.join(''));
    }
    $('#homeStoreSearch')?.addEventListener('submit', event => { event.preventDefault(); const needle = $('#homeStoreSearchInput')?.value.trim(); location.assign(`stores.html${needle ? `?search=${encodeURIComponent(needle)}` : ''}`); });
    const enhancementFallback = window.setTimeout(() => { $('#homeDeliveryLabel')?.replaceChildren(document.createTextNode('ตั้งค่าที่อยู่จัดส่ง')); $('#homeDiscoveryMount')?.setAttribute('aria-busy', 'false'); }, 3_500); addEventListener('pagehide', () => window.clearTimeout(enhancementFallback), { once: true }); loadDelivery(); loadActiveOrder(); loadDiscovery(); loadSponsored(); renderCart(); addEventListener('apservice:cart', renderCart);
    return true;
  }
  let attempts = 0;
  const boot = () => { if (!enhance() && attempts++ < 8) setTimeout(boot, 50); };
  boot();
})();
