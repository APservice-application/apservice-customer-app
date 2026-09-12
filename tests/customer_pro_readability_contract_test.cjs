const fs = require('node:fs');
const assert = require('node:assert/strict');

const theme = fs.readFileSync('customer/customer-design-system.css', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');

assert.match(theme, /--customer-muted:#5f7672/, 'สีตัวอักษรรองต้องเข้มพอผ่านคอนทราสต์ตัวเล็ก');
assert.match(theme, /text-wrap:balance/, 'หัวข้อต้องตัดคำแบบสมดุล');
assert.match(theme, /text-wrap:pretty/, 'เนื้อความต้องตัดคำแบบสวยไม่ทิ้งคำโดด');
assert.match(theme, /letter-spacing:0/, 'หัวข้อภาษาไทยห้ามบีบระยะตัวอักษรติดลบ');
assert.match(theme, /:focus-visible/, 'ปุ่มและลิงก์ต้องมีโฟกัสสำหรับคีย์บอร์ด');
assert.match(theme, /customer-notice-card/, 'การแจ้งเตือนต้องมีสไตล์การ์ดเฉพาะ');
assert.match(theme, /customer-notice-unread/, 'การแจ้งเตือนที่ยังไม่อ่านต้องเด่นกว่าที่อ่านแล้ว');
assert.match(app, /customer-notice-card/, 'มาร์กอัปแจ้งเตือนต้องใช้คลาสการ์ด ไม่ใช่สไตล์ฝังในโค้ด');
assert.doesNotMatch(app, /data-notification-id=.*style="padding:13px/, 'การ์ดแจ้งเตือนห้ามฝังสไตล์ในโค้ด');
assert.match(theme, /\.customer-store-background\{position:absolute;inset:0/, 'รูปปกต้องเต็มกรอบช่องรูป');
assert.match(theme, /has-background img:not\(\.customer-store-background\)/, 'มีรูปปกแล้วต้องซ่อนรูปซ้อน');
assert.match(theme, /not\(\.has-background\) img\{width:64px/, 'ไม่มีรูปปกต้องโชว์ไอคอนกลางกรอบ');

console.log('customer pro readability contract: PASS');
