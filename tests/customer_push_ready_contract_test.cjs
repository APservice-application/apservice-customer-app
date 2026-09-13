const fs = require('fs');
const assert = require('assert');

const app = 'customer';
const lib = fs.readFileSync('shared/ap-push.js', 'utf8');
const config = fs.readFileSync('shared/ap-push-config.js', 'utf8');
const sw = fs.readFileSync('customer/firebase-messaging-sw.js', 'utf8');
const boot = fs.readFileSync('customer/customer-app.js', 'utf8');

assert.match(config, new RegExp(`app: '${app}'`), 'push config ต้องระบุชื่อแอป');
assert.match(config, /firebase: null/, 'ก่อนได้ config ต้องเป็น null');
assert.match(config, /vapidKey: null/, 'ก่อนได้ VAPID key ต้องเป็น null');
assert.match(lib, /no-config/, 'ไม่มี config ต้องจบเงียบ');
assert.match(lib, /firebase-messaging-compat\.js/, 'ต้องโหลด FCM SDK แบบ lazy');
assert.match(lib, /firebase-messaging-sw\.js/, 'ต้องลงทะเบียน service worker');
assert.match(lib, /push_device_tokens\?on_conflict=user_id,app,token/, 'ต้องบันทึก token แบบ upsert');
assert.match(lib, /requestPermission/, 'ต้องขอ permission แยกจากการ init');
assert.match(sw, /PUSH_FIREBASE_CONFIG/, 'SW ต้องมีจุดใส่ config');
assert.match(sw, /onBackgroundMessage/, 'SW ต้องรองรับ background message');
assert.match(boot, /APPush\?\.init/, 'แอปต้องเรียก APPush.init หลังล็อกอิน');

console.log('customer push ready contract: PASS');
