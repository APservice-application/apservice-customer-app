const fs = require('fs');
const assert = require('assert');

const migration = fs.readFileSync('supabase/migrations/20260818_customer_promotions_public_read.sql', 'utf8');
const customer = fs.readFileSync('customer/customer-app.js', 'utf8');
const contentRuntime = fs.readFileSync('customer/customer-content-runtime.js', 'utf8');
const homeMobile = fs.readFileSync('customer/customer-home-mobile.js', 'utf8');

assert.match(migration, /TO anon, authenticated/, 'promotion public-read policy ต้องรองรับ Customer ที่ยังไม่ login');
assert.match(migration, /key = 'customer_promotions'/, 'policy ต้องเปิดเผยเฉพาะ customer promotions');
assert.match(customer, /platform_configs\?select=value&key=eq.customer_promotions/, 'Customer home ต้องอ่าน promotion configuration ที่ Admin บันทึกเป็น source กลาง');
assert.match(customer, /campaigns\?select=id,name,description,campaign_type,active,starts_at,ends_at,metadata/, 'Customer home ต้องมี campaign fallback เมื่อ config หลักว่าง');
assert.doesNotMatch(customer, /legacyDefaultPromotions/, 'Customer home ห้ามสร้าง promotion fallback เทียมเมื่อยังไม่มีข้อมูลจริง');
assert.match(customer, /customer-promotion--legacy/, 'legacy promotion ที่มาจากข้อมูลจริงต้อง render เป็น card visual ไม่ใช่ Data URL');
assert.match(customer, /customer-promotion-empty/, 'Customer home ต้องคงพื้นที่ AD พร้อม empty state');
assert.match(customer, /promotionLink/, 'Customer home ต้องตรวจปลายทาง banner ก่อน render ลิงก์');
assert.match(customer, /void promotions\(scope.request\)/, 'การโหลด AD ต้องไม่ block การแสดงร้านค้า');
assert.doesNotMatch(customer, /scrollIntoView/, 'ห้ามใช้ scrollIntoView กับแบนเนอร์ เพราะดึงหน้าจอของผู้ใช้กลับมาที่แบนเนอร์แม้ผู้ใช้อ่านอยู่ด้านบนหรือด้านล่าง');
assert.match(customer, /__sponsoredAutoSlide/, 'รางสปอนเซอร์ต้องมีตัวสไลด์อัตโนมัติตัวเดียวต่อราง');
assert.match(customer, /, 5000\)/, 'รางสปอนเซอร์ต้องสไลด์ทุก 5 วินาที');
assert.match(customer, /getBoundingClientRect/, 'สไลด์อัตโนมัติต้องตรวจว่าแบนเนอร์อยู่ในจอก่อนเลื่อน');
assert.match(customer, /\.scrollTo\(\{ left:/, 'สไลด์อัตโนมัติต้องเลื่อนเฉพาะรางด้านใน ห้ามดึงหน้าจอทั้งหน้า');
assert.match(contentRuntime, /key=eq\.customer_promotions/, 'Customer content runtime ต้องอ่าน banner จาก central platform config เดียวกับ Admin');
assert.match(contentRuntime, /cacheKey: 'customer-promotions'/, 'Customer content runtime ต้องใช้ cache key เฉพาะเพื่อลด request storm');
assert.match(contentRuntime, /item\?\.active !== false/, 'Customer ต้องไม่แสดง banner ที่ Admin ปิดไว้');
assert.match(contentRuntime, /\.sort\(\(a, b\) => a\.priority - b\.priority\)/, 'Customer carousel ต้องเรียงตาม priority จาก Admin');
assert.match(contentRuntime, /data-promotion-prev/, 'Customer carousel ต้องมีปุ่มก่อนหน้าเมื่อมีหลาย banner');
assert.match(contentRuntime, /data-promotion-next/, 'Customer carousel ต้องมีปุ่มถัดไปเมื่อมีหลาย banner');
assert.match(contentRuntime, /data-promotion-dot/, 'Customer carousel ต้องมีตัวบอกตำแหน่งของแต่ละ banner');
assert.match(contentRuntime, /items\.length > 1/, 'Customer ต้องเปิด controls เฉพาะเมื่อมี banner มากกว่าหนึ่งใบ');
assert.match(contentRuntime, /setInterval\(/, 'แบนเนอร์ต้องสไลด์อัตโนมัติเมื่อมีหลายใบ');
assert.match(contentRuntime, /wrapper\.hidden = index !== active/, 'แบนเนอร์ต้องสลับด้วยการซ่อนเฟรม ไม่เลื่อนหน้าจอ');
assert.match(contentRuntime, /document\.hidden/, 'สไลด์อัตโนมัติต้องหยุดเมื่อแท็บอยู่เบื้องหลัง');

assert.match(homeMobile, /__sponsoredAutoSlide/, 'รางสปอนเซอร์บนมือถือต้องมีตัวสไลด์อัตโนมัติตัวเดียวต่อราง');
assert.match(homeMobile, /, 5000\)/, 'รางสปอนเซอร์บนมือถือต้องสไลด์ทุก 5 วินาที');
assert.doesNotMatch(homeMobile, /scrollIntoView/, 'รางสปอนเซอร์บนมือถือห้ามใช้คำสั่งที่ดึงหน้าจอทั้งหน้า');

console.log('customer promotions contract: PASS');
