const fs = require('node:fs');
const assert = require('node:assert/strict');

const theme = fs.readFileSync('customer/customer-design-system.css', 'utf8');
const rows = fs.readFileSync('customer/store-category-rows.css', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');
const html = fs.readFileSync('customer/stores.html', 'utf8');
const featured = fs.readFileSync('customer/featured-stores-carousel.js', 'utf8');
const rowsJs = fs.readFileSync('customer/store-category-rows.js', 'utf8');

assert.match(theme, /#storeList \.customer-store-card:nth-child\(n\+7\)/, 'การ์ดร้านใต้จอแรกต้องเลื่อนการเรนเดอร์');
assert.match(theme, /contain-intrinsic-size:auto 320px/, 'การ์ดที่เลื่อนการเรนเดอร์ต้องมีขนาดสำรองกันหน้ากระโดด');
assert.match(rows, /store-category-row:nth-child\(n\+3\)/, 'แถวหมวดหมู่ใต้จอแรกต้องเลื่อนการเรนเดอร์');
assert.match(app, /eager: index < 4/, 'รูป 4 ใบแรกต้องโหลดทันที ที่เหลือโหลดขี้เกียจ');
assert.match(app, /setTimeout\(render, 150\)/, 'ช่องค้นหาต้องหน่วงก่อนเรนเดอร์ใหม่');
assert.match(html, /customer-design-v8-store-cover/, 'หน้าร้านต้องโหลดธีมรุ่นใหม่');
assert.match(html, /category-rows-v4-inview-tier/, 'หน้าร้านต้องโหลดสไตล์แถวรุ่นใหม่');
assert.match(html, /featured-stores-v4-cover-image/, 'หน้าร้านต้องโหลดสไตล์ร้านเด่นรุ่นใหม่');
assert.match(html, /category-rows-v3-shared-catalog/, 'หน้าร้านต้องโหลด runtime แถวหมวดรุ่นข้อมูลชุดเดียว');
assert.match(html, /featured-stores-v3-shared-catalog/, 'หน้าร้านต้องโหลด runtime ร้านเด่นรุ่นข้อมูลชุดเดียว');
assert.match(html, /perf=stores-shared-catalog-v2/, 'หน้าร้านต้องโหลด runtime หลักรุ่นข้อมูลชุดเดียว');
assert.match(app, /customer-stores-catalog-v1/, 'ต้องดึง catalog ร้านชุดเดียวแล้วแชร์ให้ทุกส่วน');
assert.match(featured, /__AP_CUSTOMER_STORE_CATALOG__/, 'ร้านเด่นต้องใช้ข้อมูลชุดเดียวกับหน้าร้าน');
assert.match(rowsJs, /__AP_CUSTOMER_STORE_CATALOG__/, 'แถวหมวดต้องใช้ข้อมูลชุดเดียวกับหน้าร้าน');
assert.match(app, /data-store-more-sentinel/, 'รายการร้านหลักต้องโหลดเพิ่มทีละชุด ไม่เรนเดอร์ทั้งหมดทันที');
assert.match(app, /!background && icon/, 'มีรูปปกแล้วต้องไม่ซ้อนไอคอนทับในรายการหลัก');
assert.match(featured, /!background && icon/, 'มีรูปปกแล้วต้องไม่ซ้อนไอคอนทับในร้านเด่น');
assert.match(rowsJs, /!background && icon/, 'มีรูปปกแล้วต้องไม่ซ้อนไอคอนทับในแถวหมวด');
assert.match(rows, /has-tier-sparkle\.is-inview::before/, 'ประกาย Tier ต้องเล่นเฉพาะการ์ดที่อยู่ในจอ');

console.log('customer stores perf contract: PASS');
