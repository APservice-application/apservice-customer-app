const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync('customer/order.html', 'utf8');
const script = fs.readFileSync('customer/customer-order-slip-resubmit.js', 'utf8');

assert.match(page, /customer-order-slip-resubmit\.js/, 'หน้า order ต้องโหลดสคริปต์แนบสลิปใหม่');
assert.match(script, /ต้องแนบสลิปใหม่/, 'ต้องแสดงฟอร์มเฉพาะออร์เดอร์ที่ถูกขอสลิปใหม่');
assert.match(script, /reviewer_note/, 'ต้องแสดงเหตุผลจากผู้ดูแลให้ลูกค้าเห็น');
assert.match(script, /uploadPrivateImage/, 'ต้องอัปโหลดสลิปผ่าน Shared Media Service');
assert.match(script, /bucket: 'payment-slips'/, 'สลิปต้องเก็บใน bucket payment-slips');
assert.match(script, /rpc\/resubmit_transfer_slip/, 'ต้องส่งสลิปใหม่ผ่าน RPC resubmit');
assert.match(script, /p_checkout_group_id/, 'ต้องอ้างกลุ่มคำสั่งซื้อที่ถูกต้อง');
assert.match(script, /capture="environment"/, 'ต้องรองรับถ่ายสลิปด้วยกล้อง');

console.log('customer order slip resubmit contract: PASS');
