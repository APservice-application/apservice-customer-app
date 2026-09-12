const fs = require('node:fs');
const assert = require('node:assert/strict');

const theme = fs.readFileSync('customer/customer-design-system.css', 'utf8');
const rows = fs.readFileSync('customer/store-category-rows.css', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');
const html = fs.readFileSync('customer/stores.html', 'utf8');

assert.match(theme, /#storeList \.customer-store-card:nth-child\(n\+7\)/, 'การ์ดร้านใต้จอแรกต้องเลื่อนการเรนเดอร์');
assert.match(theme, /contain-intrinsic-size:auto 320px/, 'การ์ดที่เลื่อนการเรนเดอร์ต้องมีขนาดสำรองกันหน้ากระโดด');
assert.match(rows, /store-category-row:nth-child\(n\+3\)/, 'แถวหมวดหมู่ใต้จอแรกต้องเลื่อนการเรนเดอร์');
assert.match(app, /eager: index < 4/, 'รูป 4 ใบแรกต้องโหลดทันที ที่เหลือโหลดขี้เกียจ');
assert.match(app, /setTimeout\(render, 150\)/, 'ช่องค้นหาต้องหน่วงก่อนเรนเดอร์ใหม่');
assert.match(html, /customer-design-v6-smooth-scroll/, 'หน้าร้านต้องโหลดธีมรุ่นใหม่');
assert.match(html, /category-rows-v3-smooth-scroll/, 'หน้าร้านต้องโหลดสไตล์แถวรุ่นใหม่');

console.log('customer stores perf contract: PASS');
