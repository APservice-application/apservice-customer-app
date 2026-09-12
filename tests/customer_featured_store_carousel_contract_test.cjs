const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('customer/stores.html', 'utf8');
const carousel = fs.readFileSync('customer/featured-stores-carousel.js', 'utf8');
const css = fs.readFileSync('customer/featured-stores-carousel.css', 'utf8');

assert.match(html, /featured-stores-carousel\.css\?v=featured-stores-v4-cover-image/, 'หน้าร้านต้องโหลด stylesheet ของ carousel รุ่นปัจจุบัน');
assert.match(html, /featured-stores-carousel\.js\?v=featured-stores-v3-shared-catalog/, 'หน้าร้านต้องโหลด runtime ของ carousel รุ่นปัจจุบัน');
assert.match(carousel, /key=eq\.customer_promotions/, 'carousel ต้องอ่าน config ที่ Admin จัดการได้');
assert.match(carousel, /if \(mode === 'manual'\) return 'sponsored'/, 'carousel ต้องรองรับชื่อโหมด manual ตาม contract เดิม');
assert.match(carousel, /rating\.desc/, 'โหมดอัตโนมัติต้องเริ่มจากข้อมูลคะแนนร้านจริง');
assert.match(carousel, /numeric\(right\.review_count\) - numeric\(left\.review_count\)/, 'โหมดอัตโนมัติต้องใช้จำนวนรีวิวเป็นลำดับรอง');
assert.match(carousel, /campaign_type=eq\.store_sponsored/, 'โหมดเลือกเฉพาะร้านต้องใช้ campaign ประเภท store_sponsored');
assert.match(carousel, /campaign_stores\?select=campaign_id,store_id,active&active=eq\.true/, 'carousel ต้องอ่านเฉพาะร้านที่เปิดใช้ใน campaign');
assert.match(carousel, /ยังไม่มีร้านค้าที่พร้อมแสดงในพื้นที่โปรโมตขณะนี้/, 'เมื่อไม่มีข้อมูลต้องมี empty state ที่ชัดเจน');
assert.match(carousel, /href = `store\.html\?id=\$\{encodeURIComponent\(store\.id\)\}`/, 'การ์ดร้านเด่นต้องเชื่อมไปหน้าเมนูร้านเดิม');
assert.match(css, /overflow-x:\s*auto/, 'rail ของ carousel ต้องเลื่อนแนวนอน');
assert.match(css, /\.featured-store-carousel__rail \{\s*display:\s*flex/, 'การ์ด carousel ต้องจัดเรียงเป็นแถวแนวนอน');
assert.match(css, /flex:\s*0\s+0\s+144px/, 'การ์ด carousel ต้องคงขนาดใน rail แนวนอน');
assert.match(css, /aspect-ratio:\s*1\s*\/\s*1/, 'การ์ดร้านเด่นต้องเป็นสี่เหลี่ยมจัตุรัส');

console.log('customer featured store carousel contract: PASS');
