(() => {
  'use strict';

  const PAGE_NAME = 'stores';
  const DEFAULT_CONFIG = Object.freeze({ mode: 'auto', limit: 5, fallbackToAuto: true });
  const storeFields = 'id,name,emoji,description,rating,review_count,eta,icon_url,background_url,category_id,category_name,category_icon';

  const escapeHtml = value => window.APServiceMPA?.ui?.escapeHtml(String(value ?? '')) ?? String(value ?? '');
  const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const imageUrl = value => {
    const raw = String(value || '').trim();
    return /^(https?:|data:image\/)/i.test(raw) ? raw : '';
  };
  const sharedCatalogStores = async () => {
    try {
      const rows = await (window.__AP_CUSTOMER_STORE_CATALOG__ || Promise.resolve(null));
      return Array.isArray(rows) && rows.length ? rows : null;
    } catch (_) { return null; }
  };
  const normaliseMode = value => {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'manual') return 'sponsored';
    return ['auto', 'sponsored', 'hybrid'].includes(mode) ? mode : 'auto';
  };

  const normaliseConfig = value => {
    const root = asObject(value);
    const source = asObject(root.featuredStores);
    return {
      mode: normaliseMode(source.mode),
      limit: Math.max(1, Math.min(5, Math.floor(numeric(source.limit) || DEFAULT_CONFIG.limit))),
      fallbackToAuto: source.fallbackToAuto !== false,
    };
  };

  const isCurrentCampaign = campaign => {
    const now = Date.now();
    const startsAt = campaign?.starts_at ? Date.parse(campaign.starts_at) : NaN;
    const endsAt = campaign?.ends_at ? Date.parse(campaign.ends_at) : NaN;
    return (!Number.isFinite(startsAt) || startsAt <= now) && (!Number.isFinite(endsAt) || endsAt >= now);
  };

  const campaignRank = campaign => {
    const metadata = asObject(campaign?.metadata);
    return numeric(metadata.featured_rank) || 9999;
  };

  const featuredCard = (store, eager = false) => {
    const background = imageUrl(store.background_url);
    const icon = imageUrl(store.icon_url) || imageUrl(store.emoji);
    const emoji = icon ? '🏪' : String(store.emoji || '🏪').slice(0, 12);
    const rating = numeric(store.rating);
    const reviewCount = numeric(store.review_count);
    const ratingText = rating > 0 ? `★ ${rating.toFixed(1)}` : 'ร้านแนะนำ';
    const reviewText = reviewCount > 0 ? `${reviewCount.toLocaleString('th-TH')} รีวิว` : (store.eta || 'พร้อมให้บริการ');
    const href = `store.html?id=${encodeURIComponent(store.id)}`;

    return `<a class="featured-store-carousel-card" data-store-id="${escapeHtml(store.id)}" href="${escapeHtml(href)}" aria-label="ดูเมนูร้านเด่น ${escapeHtml(store.name)}"><span class="featured-store-carousel-card__visual${background ? ' has-background' : ''}">${background ? `<img class="featured-store-carousel-card__background" src="${escapeHtml(background)}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async" onerror="this.closest('.featured-store-carousel-card__visual')?.classList.remove('has-background');this.remove()">` : ''}${!background && icon ? `<img class="featured-store-carousel-card__icon" src="${escapeHtml(icon)}" alt="โลโก้ ${escapeHtml(store.name)}" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'featured-store-carousel-card__emoji',textContent:'${escapeHtml(emoji)}'}))">` : ''}${!background && !icon ? `<span class="featured-store-carousel-card__emoji">${escapeHtml(emoji)}</span>` : ''}</span><span class="featured-store-carousel-card__copy"><strong>${escapeHtml(store.name)}</strong><span class="featured-store-carousel-card__meta"><span>${escapeHtml(ratingText)}</span><span>${escapeHtml(reviewText)}</span></span></span></a>`;
  };

  const render = (host, stores, config) => {
    if (!stores.length) {
      host.innerHTML = `<section class="featured-store-carousel featured-store-carousel--empty" aria-labelledby="featuredStoresTitle"><div class="featured-store-carousel__heading"><div><p class="featured-store-carousel__eyebrow">FEATURED STORES</p><h2 id="featuredStoresTitle">ร้านค้าเด่น</h2><p>คัดเลือกจากข้อมูลร้านจริงและช่วงเวลาโปรโมตที่เปิดใช้งาน</p></div></div><div class="featured-store-carousel__empty">ยังไม่มีร้านค้าที่พร้อมแสดงในพื้นที่โปรโมตขณะนี้</div></section>`;
      return;
    }

    const modeLabel = config.mode === 'sponsored' ? 'ร้านค้าที่ร่วมโปรโมชัน' : config.mode === 'hybrid' ? 'ร้านแนะนำและโปรโมชัน' : 'คัดเลือกจากข้อมูลร้านจริง';
    host.innerHTML = `<section class="featured-store-carousel" aria-labelledby="featuredStoresTitle"><div class="featured-store-carousel__heading"><div><p class="featured-store-carousel__eyebrow">FEATURED STORES</p><h2 id="featuredStoresTitle">ร้านค้าเด่น</h2><p>${escapeHtml(modeLabel)}</p></div><span class="featured-store-carousel__hint" aria-hidden="true">เลื่อนเพื่อดูเพิ่ม <b>→</b></span></div><div class="featured-store-carousel__rail" aria-label="รายชื่อร้านค้าเด่น">${stores.map((store, index) => featuredCard(store, index < 2)).join('')}</div></section>`;
  };

  async function loadConfig(M) {
    try {
      const rows = await M.request('platform_configs?select=value&key=eq.customer_promotions&limit=1', { cacheTtlMs: 60_000, cacheKey: 'customer-featured-stores-config' });
      return normaliseConfig(rows?.[0]?.value);
    } catch (_) {
      return { ...DEFAULT_CONFIG };
    }
  }

  async function loadAutomaticStores(M, limit) {
    const shared = await sharedCatalogStores();
    const rows = shared || await M.request(`catalog_stores?select=${storeFields}&order=rating.desc&limit=100`, { cacheTtlMs: 30_000, cacheKey: 'customer-featured-stores-auto' });
    return (rows || [])
      .slice()
      .sort((left, right) => numeric(right.rating) - numeric(left.rating) || numeric(right.review_count) - numeric(left.review_count) || String(left.name || '').localeCompare(String(right.name || ''), 'th'))
      .slice(0, limit);
  }

  async function loadSponsoredStores(M, limit) {
    const [campaigns, links] = await Promise.all([
      M.request('campaigns?select=id,starts_at,ends_at,metadata&campaign_type=eq.store_sponsored&active=eq.true&order=starts_at.asc', { cacheTtlMs: 30_000, cacheKey: 'customer-featured-campaigns' }),
      M.request('campaign_stores?select=campaign_id,store_id,active&active=eq.true', { cacheTtlMs: 60_000, cacheKey: 'customer-public-campaign-stores' }),
    ]);
    const activeCampaigns = (campaigns || []).filter(isCurrentCampaign).sort((left, right) => campaignRank(left) - campaignRank(right) || Date.parse(left.starts_at || 0) - Date.parse(right.starts_at || 0));
    const campaignOrder = new Map(activeCampaigns.map((campaign, index) => [String(campaign.id), index]));
    const sponsoredIds = (links || [])
      .filter(link => campaignOrder.has(String(link.campaign_id)) && link.store_id)
      .sort((left, right) => campaignOrder.get(String(left.campaign_id)) - campaignOrder.get(String(right.campaign_id)))
      .map(link => String(link.store_id))
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, limit);

    if (!sponsoredIds.length) return [];
    const sharedStores = await sharedCatalogStores();
    const rows = sharedStores || await M.request(`catalog_stores?select=${storeFields}&id=in.(${sponsoredIds.join(',')})`, { cacheTtlMs: 30_000, cacheKey: `customer-featured-sponsored:${sponsoredIds.join(',')}` });
    const byId = new Map((rows || []).map(store => [String(store.id), store]));
    return sponsoredIds.map(id => byId.get(id)).filter(Boolean);
  }

  async function initialise() {
    if (document.body?.dataset?.page !== PAGE_NAME || document.getElementById('featuredStoresMount')) return;
    const M = window.APServiceMPA;
    const target = document.querySelector('.customer-filters');
    if (!M?.request || !target) return;

    const host = document.createElement('div');
    host.id = 'featuredStoresMount';
    host.innerHTML = '<section class="featured-store-carousel featured-store-carousel--loading" aria-live="polite"><div class="featured-store-carousel__heading"><div><p class="featured-store-carousel__eyebrow">FEATURED STORES</p><h2>ร้านค้าเด่น</h2><p>กำลังคัดเลือกร้านจากข้อมูลล่าสุด…</p></div></div></section>';
    target.before(host);

    try {
      const config = await loadConfig(M);
      let sponsored = [];
      let automatic = [];
      if (config.mode === 'sponsored' || config.mode === 'hybrid') sponsored = await loadSponsoredStores(M, config.limit);
      if (config.mode === 'auto' || config.mode === 'hybrid' || (config.fallbackToAuto && sponsored.length < config.limit)) automatic = await loadAutomaticStores(M, config.limit);
      const selected = config.mode === 'auto'
        ? automatic
        : [...sponsored, ...automatic.filter(store => !sponsored.some(item => String(item.id) === String(store.id)))].slice(0, config.limit);
      render(host, selected, config);
    } catch (error) {
      console.warn('ไม่สามารถโหลดร้านค้าเด่นได้', error);
      render(host, [], { ...DEFAULT_CONFIG });
    }
  }

  const start = () => {
    if (document.body?.dataset?.page !== PAGE_NAME) return;
    const observer = new MutationObserver(() => {
      if (document.querySelector('.customer-filters')) {
        observer.disconnect();
        void initialise();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    void initialise();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
