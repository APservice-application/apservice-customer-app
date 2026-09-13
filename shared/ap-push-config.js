/* AP Service push config (B3: code ready, config pending).
 * ผู้ใช้กรอกค่า Firebase Web App + VAPID key ตรงนี้เมื่อพร้อม แล้ว push จะเริ่มทำงานเอง
 * ก่อนหน้านั้น APPush.init() จะจบเงียบ ไม่โหลด SDK ไม่ขอ permission ไม่พัง */
(function () {
  'use strict';
  window.APPushConfig = Object.freeze({
    app: 'customer',
    firebase: null, // { apiKey, authDomain, projectId, messagingSenderId, appId }
    vapidKey: null // public VAPID key จาก Firebase Console > Cloud Messaging
  });
})();
