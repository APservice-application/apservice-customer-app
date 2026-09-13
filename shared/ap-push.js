/* AP Service web push (B3). เรียก APPush.init() หลังล็อกอินเพื่อเตรียม FCM;
 * ถ้ายังไม่มี config ใน ap-push-config.js จะจบเงียบ ไม่โหลด SDK ไม่ขอ permission */
(function () {
  'use strict';
  const SDK_VERSION = '10.12.2';
  let state = 'idle';
  let messaging = null;
  let registration = null;
  let hooks = {};

  const loadScript = src => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('โหลด push SDK ไม่สำเร็จ'));
    document.head.appendChild(el);
  });

  async function init(options = {}) {
    if (state !== 'idle') return state;
    state = 'starting';
    hooks = options;
    const config = window.APPushConfig;
    if (!config?.firebase || !config?.vapidKey) { state = 'no-config'; return state; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { state = 'unsupported'; return state; }
    try {
      if (!window.firebase?.messaging) {
        await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`);
        await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-messaging-compat.js`);
      }
      if (!window.firebase.apps?.length) window.firebase.initializeApp(config.firebase);
      registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      messaging = window.firebase.messaging();
      messaging.onMessage(payload => {
        try { hooks.onMessage?.(payload); } catch (_) {}
        const title = payload?.notification?.title || 'AP Service';
        const body = payload?.notification?.body || 'มีการแจ้งเตือนใหม่';
        try { hooks.notify?.(title, body); } catch (_) {}
        if (registration?.showNotification && document.visibilityState === 'visible') {
          registration.showNotification(title, { body, data: payload?.data || {}, icon: './icons/icon-192.png' }).catch(() => {});
        }
      });
      state = 'ready';
      return state;
    } catch (error) {
      state = 'failed';
      try { hooks.onError?.(error); } catch (_) {}
      return state;
    }
  }

  async function requestPermission(options = {}) {
    const merged = { ...hooks, ...options };
    if (state === 'no-config' || state === 'unsupported' || state === 'failed') return state;
    if (state === 'idle' || state === 'starting') await init(merged);
    if (state !== 'ready') return state;
    const config = window.APPushConfig;
    let permission = Notification.permission;
    if (permission === 'default') { try { permission = await Notification.requestPermission(); } catch (_) { permission = 'denied'; } }
    if (permission !== 'granted') { state = 'denied'; return state; }
    const token = await messaging.getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
    const user = await merged.currentUser?.();
    if (!user?.id) throw new Error('ต้องเข้าสู่ระบบก่อนเปิดการแจ้งเตือน');
    await merged.request('push_device_tokens?on_conflict=user_id,app,token', {
      method: 'POST', private: true,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, app: config.app, token, platform: 'web', updated_at: new Date().toISOString() })
    });
    try { localStorage.setItem('apservice_push_token_v1', token); } catch (_) {}
    state = 'subscribed';
    return state;
  }

  const status = () => state;

  window.APPush = Object.freeze({ init, requestPermission, status });
})();
