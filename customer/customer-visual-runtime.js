(() => {
  'use strict';
  const M = window.APServiceMPA;
  if (!M || window.__APServiceCustomerVisualRuntime) return;
  window.__APServiceCustomerVisualRuntime = true;

  const validImage = value => /^https:\/\//i.test(String(value || '').trim()) ? String(value).trim() : '';
  const pickImage = input => validImage(input?.backgroundUrl || input?.background_url || input?.background || input?.imageUrl || input?.url);
  const normalize = value => {
    const source = value && typeof value === 'object' ? value : {};
    const base = { backgroundUrl: '', overlay: 0.86, position: 'center', size: 'cover', motion: 'none' };
    const slot = input => ({ ...base, ...(input && typeof input === 'object' ? input : {}), backgroundUrl: pickImage(input), overlay: Math.max(0, Math.min(1, Number.isFinite(Number(input?.overlay)) ? Number(input.overlay) : base.overlay)), position: String(input?.position || base.position), size: String(input?.size || base.size), motion: String(input?.motion || base.motion) });
    const pages = source.pages && typeof source.pages === 'object' ? Object.fromEntries(Object.entries(source.pages).map(([key, item]) => [key, slot(item)])) : {};
    return { default: slot(source.default), festival: { key: String(source.festival?.key || ''), motion: String(source.festival?.motion || 'none'), active: source.festival?.active === true, startsAt: source.festival?.startsAt || '', endsAt: source.festival?.endsAt || '' }, pages };
  };
  const apply = value => {
    const visuals = normalize(value);
    const page = String(document.body?.dataset?.page || 'home');
    const selected = visuals.pages[page]?.backgroundUrl ? { ...visuals.default, ...visuals.pages[page] } : visuals.default;
    const host = document.querySelector('.customer-page');
    const body = document.body;
    if (body) {
      delete body.dataset.adminBackground;
      body.style.removeProperty('--customer-admin-background-url');
      body.style.removeProperty('--customer-admin-background-overlay');
      body.style.removeProperty('--customer-admin-background-size');
      body.style.removeProperty('--customer-admin-background-position');
    }
    if (host && selected.backgroundUrl && body) {
      const safeUrl = selected.backgroundUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\)/g, '\\)');
      const overlay = `rgba(255,255,255,${selected.overlay})`;
      body.dataset.adminBackground = 'true';
      body.style.setProperty('--customer-admin-background-url', `url("${safeUrl}")`);
      body.style.setProperty('--customer-admin-background-overlay', overlay);
      body.style.setProperty('--customer-admin-background-size', selected.size);
      body.style.setProperty('--customer-admin-background-position', selected.position);
      host.dataset.adminBackground = 'true';
    }
    const starts = visuals.festival.startsAt ? Date.parse(visuals.festival.startsAt) : NaN;
    const ends = visuals.festival.endsAt ? Date.parse(visuals.festival.endsAt) : NaN;
    const active = visuals.festival.active && (!Number.isFinite(starts) || Date.now() >= starts) && (!Number.isFinite(ends) || Date.now() <= ends);
    document.body.dataset.customerMotion = active ? visuals.festival.motion : selected.motion;
    window.__APServiceCustomerVisuals = visuals;
    window.dispatchEvent(new CustomEvent('apservice:customer-visuals', { detail: visuals }));
  };
  const hydrate = async () => {
    try {
      const rows = await M.request('platform_configs?select=value&key=eq.customer_visuals&limit=1', { cacheTtlMs: 60_000, cacheKey: 'customer-visuals-public' });
      apply(rows?.[0]?.value);
    } catch (_) {
      // Visual configuration is optional; the existing Customer UI remains unchanged.
    }
  };
  const mount = () => {
    if (document.querySelector('.customer-page')) void hydrate();
    else {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.customer-page')) return;
        observer.disconnect();
        void hydrate();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 12_000);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
