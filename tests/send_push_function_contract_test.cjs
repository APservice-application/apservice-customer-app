const fs = require('fs');
const assert = require('assert');

const fn = fs.readFileSync('supabase/functions/send-push/index.ts', 'utf8');

assert.match(fn, /x-push-secret/, 'ต้องตรวจ shared secret ก่อนส่ง');
assert.match(fn, /FIREBASE_SERVICE_ACCOUNT/, 'ต้องอ่าน service account จาก env');
assert.match(fn, /fcm\.googleapis\.com\/v1\/projects/, 'ต้องส่งผ่าน FCM HTTP v1');
assert.match(fn, /push_device_tokens/, 'ต้องอ่าน token จากตาราง push_device_tokens');
assert.match(fn, /mobile_notifications/, 'ต้องอ่านข้อความจาก mobile_notifications');
assert.match(fn, /UNREGISTERED/, 'token ตายต้องถูกลบออก');
assert.match(fn, /RS256|RSASSA/, 'ต้องเซ็น JWT ด้วย private key');
assert(!/AIzaSy[0-9A-Za-z_-]{20,}/.test(fn), 'ห้ามมี api key จริงในโค้ด');
assert(!/MIIE[A-Za-z0-9+/=\n]{50,}/.test(fn), 'ห้ามมี private key จริงในโค้ด');

console.log('send-push function contract: PASS');
