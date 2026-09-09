(() => {
  'use strict';

  const M = window.APServiceMPA;
  if (!M) return;

  const h = value => M.ui.escapeHtml(String(value ?? ''));
  const validImage = value => { const raw = String(value || '').trim(); return /^https:\/\//i.test(raw) ? raw : ''; };
  const validHref = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.protocol === 'https:' || url.origin === location.origin) return raw;
    } catch (_) {}
    return '';
  };
  const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback;
  const validOverlay = value => {
    const raw = String(value || '').trim();
    return /^(?:rgba?\([0-9 .,%]+\)|#[0-9a-f]{6,8})$/i.test(raw) ? raw : 'rgba(3, 91, 84, .34)';
  };
  const overlayForClarity = (value, clarity) => {
    const overlay = validOverlay(value); const match = overlay.match(/^rgba\(([^)]+)\)$/i); if (!match) return overlay;
    const parts = match[1].split(',').map(part => part.trim()); const alpha = Number(parts[3]); if (parts.length !== 4 || !Number.isFinite(alpha)) return overlay;
    parts[3] = String(Math.max(0, Math.min(1, alpha * (1 - Math.max(0, Math.min(100, Number(clarity))) / 100)))); return `rgba(${parts.join(',')})`;
  };
  const bool = value => value !== false;
  const now = Date.now();

  const fallbackCards = [
    { id: 'food', enabled: true, sortOrder: 10, icon: '🍜', title: 'สั่งอาหาร', description: 'เลือกเฉพาะร้านอาหารและเมนูพร้อมขายใกล้คุณ', href: 'stores.html?service=food', actionLabel: 'เปิดบริการ', altText: 'สั่งอาหาร', textColor: '#102a2a', backgroundColor: '#ffffff' },
    { id: 'supermarket', enabled: true, sortOrder: 20, icon: '🛒', title: 'ซูเปอร์มาร์เก็ต', description: 'ของกิน ของใช้ และสินค้ารีเทลจากร้านที่ตรวจสต๊อกจริง', href: 'retail.html', actionLabel: 'เลือกซื้อสินค้า', altText: 'ซูเปอร์มาร์เก็ตและสินค้าทั่วไป', textColor: '#102a2a', backgroundColor: '#ffffff' },
    { id: 'parcel', enabled: true, sortOrder: 30, icon: '🛵', title: 'ส่งของ A → B', description: 'เรียกไรเดอร์รับของจากจุดหนึ่งไปส่งยังอีกจุดหนึ่ง', href: 'parcel.html', actionLabel: 'สร้างรายการส่งของ', altText: 'ส่งของจากจุด A ไปจุด B', textColor: '#102a2a', backgroundColor: '#ffffff' },
    { id: 'orders', enabled: true, sortOrder: 40, icon: '🧺', title: 'ออเดอร์ของฉัน', description: 'ติดตามสถานะและดูประวัติการใช้บริการ', href: 'orders.html', actionLabel: 'ดูออเดอร์', altText: 'ออเดอร์ของฉัน', textColor: '#102a2a', backgroundColor: '#ffffff' },
    { id: 'marketplace', enabled: true, sortOrder: 50, icon: '🛍️', title: 'ตลาดชุมชน', description: 'เลือกซื้อ ขาย และแชตกับสมาชิก AP Service', href: 'marketplace.html', actionLabel: 'เข้าสู่ตลาดชุมชน', altText: 'ตลาดชุมชน', textColor: '#102a2a', backgroundColor: '#ffffff' },
  ];

  function normalizeHome(value) {
    const source = value && typeof value === 'object' ? value : {};
    const rawCards = Array.isArray(source.serviceCards) ? source.serviceCards : []; const configured = new Map(rawCards.map(card => [String(card?.id || ''), card])); const extras = rawCards.filter(card => card && card.id && !fallbackCards.some(item => item.id === String(card.id)));
    const hero = source.hero && typeof source.hero === 'object' ? source.hero : {};
    return {
      hero: { eyebrow: String(hero.eyebrow || 'AP SERVICE · DELIVERY & EVERYDAY SERVICES'), title: String(hero.title || 'อร่อยถึงบ้าน ทุกบริการถึงใจ'), description: String(hero.description || 'สั่งอาหารจากร้านโปรด ติดตามออร์เดอร์ และเลือกบริการของ AP Service ได้ในไม่กี่ขั้นตอน'), backgroundUrl: validImage(hero.backgroundUrl), artUrl: validImage(hero.artUrl), overlay: validOverlay(hero.overlay), textColor: validColor(hero.textColor, '#ffffff'), primaryAction: { label: String(hero.primaryAction?.label || 'เริ่มสั่งอาหาร →'), href: validHref(hero.primaryAction?.href) || 'stores.html?service=food', enabled: bool(hero.primaryAction?.enabled) }, secondaryAction: { label: String(hero.secondaryAction?.label || 'เลือกซูเปอร์มาร์เก็ต'), href: validHref(hero.secondaryAction?.href) || 'retail.html', enabled: bool(hero.secondaryAction?.enabled) } },
      serviceSection: { ...(source.serviceSection || {}), eyebrow: String(source.serviceSection?.eyebrow || ''), title: String(source.serviceSection?.title || 'เลือกบริการ'), description: String(source.serviceSection?.description || 'ครบทุกความต้องการในวันของคุณ'), enabled: bool(source.serviceSection?.enabled) },
      serviceCards: [...fallbackCards.map(card => { const configuredCard = configured.get(card.id) || {}; return { ...card, ...configuredCard, id: card.id, enabled: bool(configuredCard.enabled ?? card.enabled), sortOrder: Number(configuredCard.sortOrder ?? card.sortOrder), title: String(configuredCard.title || card.title), description: String(configuredCard.description || card.description), href: validHref(configuredCard.href) || card.href, target: configuredCard.target === '_blank' ? '_blank' : '_self', actionLabel: String(configuredCard.actionLabel || card.actionLabel), icon: String(configuredCard.icon || card.icon).slice(0, 12), iconUrl: validImage(configuredCard.iconUrl), backgroundUrl: validImage(configuredCard.backgroundUrl), altText: String(configuredCard.altText || card.altText), textColor: validColor(configuredCard.textColor, card.textColor), backgroundColor: validColor(configuredCard.backgroundColor, card.backgroundColor) }; }), ...extras.map(card => ({ id: String(card.id), enabled: card.enabled !== false, sortOrder: Number(card.sortOrder) || 100, icon: String(card.icon || '✦').slice(0, 12), title: String(card.title || card.id), description: String(card.description || ''), href: validHref(card.href) || 'index.html', target: card.target === '_blank' ? '_blank' : '_self', actionLabel: String(card.actionLabel || 'ดูรายละเอียด'), iconUrl: validImage(card.iconUrl), backgroundUrl: validImage(card.backgroundUrl), altText: String(card.altText || card.title || card.id), textColor: validColor(card.textColor, '#102a2a'), backgroundColor: validColor(card.backgroundColor, '#ffffff') }))].sort((a, b) => a.sortOrder - b.sortOrder),
      storeSection: { ...(source.storeSection || {}), title: String(source.storeSection?.title || 'ร้านค้ายอดนิยม'), description: String(source.storeSection?.description || 'ดีลดี อาหารอร่อย ส่งตรงถึงมือ'), viewAllLabel: String(source.storeSection?.viewAllLabel || 'ดูทั้งหมด'), viewAllHref: validHref(source.storeSection?.viewAllHref) || 'stores.html', enabled: bool(source.storeSection?.enabled) },
      floatingCart: { ...(source.floatingCart || {}), enabled: bool(source.floatingCart?.enabled), icon: String(source.floatingCart?.icon || '🛒').slice(0, 12), label: String(source.floatingCart?.label || 'ตะกร้าสินค้า'), href: validHref(source.floatingCart?.href) || 'checkout.html' },
      navigation: { ...(source.navigation || {}), supportLabel: String(source.navigation?.supportLabel || 'ติดต่อเจ้าหน้าที่'), notificationLabel: String(source.navigation?.notificationLabel || 'การแจ้งเตือน'), profileLabel: String(source.navigation?.profileLabel || 'เข้าสู่ระบบหรือดูโปรไฟล์') },
    };
  }

  function normalizePromotions(value) {
    const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
    return list.map((item, index) => {
      const hasStart = Boolean(item?.starts_at); const hasEnd = Boolean(item?.ends_at);
      const starts = hasStart ? Date.parse(item.starts_at) : NaN;
      const ends = hasEnd ? Date.parse(item.ends_at) : NaN;
      const active = item?.placement === 'customer_home_sponsored' && item?.active !== false && (!hasStart || Number.isFinite(starts) && starts <= now) && (!hasEnd || Number.isFinite(ends) && now <= ends);
      const imageUrl = validImage(item?.image_url || item?.imageUrl || item?.banner_url || item?.bannerUrl);
      const href = validHref(item?.link_url || item?.linkUrl || item?.destination_url || item?.destinationUrl || item?.href);
      if (!active || !imageUrl) return null;
      const clarity = Math.max(0, Math.min(100, Number(item?.clarity ?? 100)));
      return { id: String(item?.id || `promotion-${index + 1}`), imageUrl, href, openInNewTab: item?.open_in_new_tab === true, badge: String(item?.badge || 'AD'), eyebrow: String(item?.eyebrow || ''), title: String(item?.title || item?.name || 'บริการพิเศษจาก AP Service'), description: String(item?.description || ''), altText: String(item?.alt_text || item?.title || 'ภาพโฆษณา'), icon: String(item?.icon || ''), clarity, overlay: overlayForClarity(item?.overlay, clarity), backgroundColor: validColor(item?.background_color, '#0b8c7c'), textColor: validColor(item?.text_color, '#ffffff'), borderColor: validColor(item?.border_color, ''), fit: ['cover', 'contain', 'fill', 'none', 'scale-down'].includes(item?.fit) ? item.fit : 'cover', position: String(item?.position || 'center'), buttonEnabled: item?.button_enabled !== false, buttonLabel: String(item?.button_label || 'ดูรายละเอียด'), priority: Number(item?.priority || index + 1), maxWidth: Math.max(280, Math.min(1200, Number(item?.max_width || 720))), minHeight: Math.max(160, Math.min(720, Number(item?.min_height || 300))) };
    }).filter(Boolean).sort((a, b) => a.priority - b.priority);
  }

  function setAction(anchor, action) {
    if (!anchor) return;
    anchor.hidden = !action.enabled;
    anchor.textContent = action.label;
    anchor.href = action.href;
  }

  function applyHome(home) {
    const hero = home.hero;
    const heroHost = document.querySelector('.customer-hero');
    if (heroHost) {
      heroHost.style.color = hero.textColor;
      if (hero.backgroundUrl) { heroHost.style.backgroundImage = `linear-gradient(${hero.overlay},${hero.overlay}),url("${hero.backgroundUrl}")`; heroHost.style.backgroundSize = 'cover'; heroHost.style.backgroundPosition = 'center'; }
      const eyebrow = heroHost.querySelector('.customer-eyebrow'); if (eyebrow) eyebrow.textContent = hero.eyebrow;
      const title = heroHost.querySelector('h1'); if (title) title.textContent = hero.title;
      const description = heroHost.querySelector('p'); if (description) description.textContent = hero.description;
      const actions = heroHost.querySelectorAll('.customer-hero-actions a'); setAction(actions[0], hero.primaryAction); setAction(actions[1], hero.secondaryAction);
      const art = heroHost.querySelector('.customer-hero-art'); if (art && hero.artUrl) { art.innerHTML = `<img src="${h(hero.artUrl)}" alt="ภาพประกอบหน้าแรก" loading="eager">`; art.setAttribute('data-admin-art', 'true'); art.setAttribute('aria-hidden', 'false'); } else if (art) { art.removeAttribute('data-admin-art'); art.setAttribute('aria-hidden', 'true'); if (hero.backgroundUrl) art.setAttribute('data-configured-background', 'true'); else art.removeAttribute('data-configured-background'); }
    }

    const serviceHost = document.querySelector('.customer-services');
    const serviceSection = serviceHost?.closest('section');
    if (serviceSection) {
      serviceSection.hidden = !home.serviceSection.enabled;
      const heading = serviceSection.querySelector('.customer-section-head h2'); if (heading) heading.textContent = home.serviceSection.title;
      const description = serviceSection.querySelector('.customer-section-head p'); if (description) description.textContent = home.serviceSection.description;
      if (home.serviceSection.eyebrow) { const head = serviceSection.querySelector('.customer-section-head'); if (head && !head.querySelector('.customer-content-eyebrow')) head.insertAdjacentHTML('afterbegin', `<small class="customer-content-eyebrow">${h(home.serviceSection.eyebrow)}</small>`); }
    }
    if (serviceHost) {
      serviceHost.innerHTML = home.serviceCards.filter(card => card.enabled).map(card => { const visual = card.iconUrl ? `<img src="${h(card.iconUrl)}" alt="${h(card.altText)}" loading="lazy">` : `<span aria-hidden="true">${h(card.icon)}</span>`; const style = `color:${card.textColor};background-color:${card.backgroundColor}${card.backgroundUrl ? `;background-image:linear-gradient(rgba(255,255,255,.72),rgba(255,255,255,.84)),url("${card.backgroundUrl}");background-size:cover;background-position:center` : ''}`; return `<a class="customer-service" href="${h(card.href)}" target="${card.target === '_blank' ? '_blank' : '_self'}"${card.target === '_blank' ? ' rel="noopener noreferrer"' : ''} style="${style}" aria-label="${h(card.title)}"><span class="customer-service-icon">${visual}</span><h3>${h(card.title)}</h3><p>${h(card.description)}</p><small class="customer-service-action">${h(card.actionLabel)}</small></a>`; }).join('') || `<div class="customer-promotion-empty" role="status"><strong>ยังไม่มีบริการที่เปิดใช้งาน</strong><span>ผู้ดูแลระบบกำลังเตรียมบริการสำหรับคุณ</span></div>`;
    }

    const storeSection = document.querySelector('#storeList')?.closest('section');
    if (storeSection) {
      storeSection.hidden = !home.storeSection.enabled;
      const heading = storeSection.querySelector('.customer-section-head h2'); if (heading) heading.textContent = home.storeSection.title;
      const description = storeSection.querySelector('.customer-section-head p'); if (description) description.textContent = home.storeSection.description;
      const viewAll = storeSection.querySelector('.customer-section-head a'); if (viewAll) { viewAll.textContent = home.storeSection.viewAllLabel; viewAll.href = home.storeSection.viewAllHref; }
    }

    window.__APServiceCustomerHomeConfig = home;
    window.dispatchEvent(new CustomEvent('apservice:customer-home-config', { detail: home }));

    const cart = document.querySelector('.customer-cart-fab');
    if (cart) { cart.hidden = !home.floatingCart.enabled; cart.href = home.floatingCart.href; cart.setAttribute('aria-label', home.floatingCart.label); const badge = cart.querySelector('[data-cart-count]'); cart.firstChild?.remove(); cart.insertBefore(document.createTextNode(home.floatingCart.icon), badge || null); }

    const support = document.querySelector('.customer-top-actions a[href="support.html"]'); if (support) support.setAttribute('aria-label', home.navigation.supportLabel);
    const notification = document.querySelector('.customer-top-actions a[href="notifications.html"]'); if (notification) notification.setAttribute('aria-label', home.navigation.notificationLabel);
    const profile = document.querySelector('.customer-top-actions a[href="profile.html"]'); if (profile) profile.setAttribute('aria-label', home.navigation.profileLabel);
  }

  function applyPromotions(items) {
    const host = document.querySelector('#sponsoredList');
    if (!host) return;
    const section = host.closest('.customer-sponsored');
    const count = document.querySelector('#sponsoredCount'); if (count) count.textContent = `${items.length} รายการ`;
    if (!items.length) { if (section) section.hidden = true; return; }
    if (section) section.hidden = false;
    const slides = items.map((item, index) => { const visual = item.imageUrl ? `<img src="${h(item.imageUrl)}" alt="${h(item.altText)}" loading="${index === 0 ? 'eager' : 'lazy'}" style="object-fit:${h(item.fit)};object-position:${h(item.position)};filter:contrast(${(1 + item.clarity / 100 * .15).toFixed(3)}) saturate(${(1 + item.clarity / 100 * .1).toFixed(3)}) brightness(${(1 + item.clarity / 100 * .03).toFixed(3)})">` : `<span class="customer-promotion__legacy-icon" aria-hidden="true">${h(item.icon || 'AD')}</span>`; const inner = `${visual}<div class="customer-promotion__copy" style="color:${item.textColor}"><small>${h(item.badge)}</small>${item.eyebrow ? `<em>${h(item.eyebrow)}</em>` : ''}<h2>${h(item.title)}</h2>${item.description ? `<p>${h(item.description)}</p>` : ''}${item.buttonEnabled && item.href ? `<span class="mpa-button mpa-button-secondary">${h(item.buttonLabel)}</span>` : ''}</div>`; const style = `background-color:${item.backgroundColor};min-height:${item.minHeight}px;max-width:${item.maxWidth}px;border-color:${item.borderColor || 'transparent'};${item.imageUrl ? `background-image:linear-gradient(${item.overlay},${item.overlay}),url("${item.imageUrl}");background-size:cover;background-position:${item.position}` : ''}`; const card = item.href ? `<a class="customer-promotion customer-promotion-slide" data-promotion-slide="${index}" href="${h(item.href)}" style="${style}"${item.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>` : `<article class="customer-promotion customer-promotion-slide" data-promotion-slide="${index}" style="${style}">${inner}</article>`; return `<div class="customer-promotion-frame" role="group" aria-roledescription="slide" aria-label="${index + 1} จาก ${items.length}">${card}</div>`; }).join('');
    const controls = items.length > 1 ? `<div class="customer-promotion-controls" aria-label="ควบคุมแบนเนอร์"><button type="button" data-promotion-prev aria-label="แบนเนอร์ก่อนหน้า">‹</button><div class="customer-promotion-dots">${items.map((_, index) => `<button type="button" data-promotion-dot="${index}" aria-label="ดูแบนเนอร์ที่ ${index + 1}" aria-current="${index === 0 ? 'true' : 'false'}"></button>`).join('')}</div><button type="button" data-promotion-next aria-label="แบนเนอร์ถัดไป">›</button></div>` : '';
    host.innerHTML = `<div class="customer-promotion-carousel" data-promotion-carousel>${slides}</div>${controls}`;
    const frames = [...host.querySelectorAll('[data-promotion-slide]')]; let active = 0; let timer;
    const show = next => { active = (next + frames.length) % frames.length; frames.forEach((frame, index) => { const wrapper = frame.closest('.customer-promotion-frame'); if (wrapper) wrapper.hidden = index !== active; }); host.querySelectorAll('[data-promotion-dot]').forEach((dot, index) => dot.setAttribute('aria-current', index === active ? 'true' : 'false')); };
    const stop = () => { if (timer) window.clearInterval(timer); };
    const start = () => { stop(); /* Banner changes only by user interaction; never move the page automatically. */ };
    show(0);
    if (items.length > 1) { host.querySelector('[data-promotion-prev]')?.addEventListener('click', () => { show(active - 1); start(); }); host.querySelector('[data-promotion-next]')?.addEventListener('click', () => { show(active + 1); start(); }); host.querySelectorAll('[data-promotion-dot]').forEach(dot => dot.addEventListener('click', () => { show(Number(dot.dataset.promotionDot)); start(); })); host.addEventListener('mouseenter', stop); host.addEventListener('mouseleave', start); host.addEventListener('focusin', stop); host.addEventListener('focusout', start); start(); }
    host.querySelectorAll('img').forEach(image => image.addEventListener('error', () => image.remove(), { once: true }));
  }

  async function hydrateHome(options = {}) {
    if (!document.querySelector('.customer-hero')) return;
    window.__APServiceCustomerContentScope?.abort?.();
    const controller = new AbortController();
    window.__APServiceCustomerContentScope = controller;
    if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    const request = (path, extra = {}) => M.request(path, { signal: controller.signal, ...extra });
    try {
      const [brandResult, promotionResult] = await Promise.allSettled([
        request('platform_configs?select=value&key=eq.brand_public&limit=1', { cacheTtlMs: 60_000, cacheKey: 'customer-brand-public' }),
        request('platform_configs?select=value&key=eq.customer_promotions&limit=1', { cacheTtlMs: 60_000, cacheKey: 'customer-promotions' }),
      ]);
      if (controller.signal.aborted) return;
      if (brandResult.status === 'fulfilled') applyHome(normalizeHome(brandResult.value?.[0]?.value?.customerHome));
      if (promotionResult.status === 'fulfilled') applyPromotions(normalizePromotions(promotionResult.value?.[0]?.value));
    } catch (error) {
      if (!controller.signal.aborted) console.warn('Customer content hydration failed', error);
    }
  }

  window.APServiceCustomerContent = Object.freeze({ hydrateHome });
})();
