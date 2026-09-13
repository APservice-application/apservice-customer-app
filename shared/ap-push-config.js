/* AP Service push config (B3: code ready, config pending).
 * ผู้ใช้กรอกค่า Firebase Web App + VAPID key ตรงนี้เมื่อพร้อม แล้ว push จะเริ่มทำงานเอง
 * ก่อนหน้านั้น APPush.init() จะจบเงียบ ไม่โหลด SDK ไม่ขอ permission ไม่พัง */
(function () {
  'use strict';
  window.APPushConfig = Object.freeze({
    app: 'customer',
    firebase: { apiKey: 'AIzaSyCfHiF7jEbwGX1wf8aVMbjS7oxZBlyJgiM', authDomain: 'ap-service-2addf.firebaseapp.com', projectId: 'ap-service-2addf', storageBucket: 'ap-service-2addf.firebasestorage.app', messagingSenderId: '295638354458', appId: '1:295638354458:web:3ff55dcf3ae561aba31fa3' },
    vapidKey: 'BL06FF3LtEIDuXZC-_uMO9RVI0tNxRLg5F44lEj85qyQocaole8NjPULFOPbyMPF8OKT5jG6ag9YMI110sU8tDM'
  });
})();
