/* AP Service FCM service worker (B3). ใส่ firebase config ชุดเดียวกับ
 * shared/ap-push-config.js ตรง PUSH_FIREBASE_CONFIG เมื่อผู้ใช้พร้อม */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const PUSH_FIREBASE_CONFIG = null; // { apiKey, authDomain, projectId, messagingSenderId, appId }

if (PUSH_FIREBASE_CONFIG) {
  firebase.initializeApp(PUSH_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const title = payload?.notification?.title || 'AP Service';
    const body = payload?.notification?.body || 'มีการแจ้งเตือนใหม่';
    self.registration.showNotification(title, {
      body, icon: './icons/icon-192.png', data: payload?.data || {}
    });
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification?.data?.url) || './orders.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) { if ('focus' in client) { client.navigate?.(target); return client.focus(); } }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
