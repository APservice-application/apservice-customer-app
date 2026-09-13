const fs = require('fs');
const assert = require('assert');

const mod = fs.readFileSync('customer/order-chat.js', 'utf8');
assert.match(mod, /APOrderChat/, 'ต้องมีโมดูล APOrderChat');
assert.match(mod, /function mount/, 'ต้องมี mount');
assert.match(mod, /function openDialog/, 'ต้องมี openDialog');
assert.match(mod, /MediaRecorder/, 'ต้องอัดเสียงได้');
assert.match(mod, /chat-voice/, 'เสียงต้องเก็บใน bucket chat-voice');
assert.match(mod, /setInterval\(load/, 'ต้องโหลดข้อความอัตโนมัติ');
assert.match(mod, /ลบอัตโนมัติ/, 'ต้องบอกผู้ใช้ว่าประวัติลบอัตโนมัติ');

const app = fs.readFileSync('customer/customer-app.js', 'utf8');
assert.match(app, /APOrderChat\?\.mount\(\{ M, orderId: id, selfRole: 'customer'/, 'หน้า order ต้อง mount แชท');

const html = fs.readFileSync('customer/order.html', 'utf8');
assert.match(html, /order-chat\.js/, 'order.html ต้องโหลดโมดูลแชท');

console.log('customer order chat UI contract: PASS');
