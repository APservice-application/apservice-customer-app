const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('customer/stores.html', 'utf8');
const rows = fs.readFileSync('customer/store-category-rows.js', 'utf8');
const css = fs.readFileSync('customer/store-category-rows.css', 'utf8');

assert.match(html, /store-category-rows\.css\?v=category-rows-v4-inview-tier/, 'หน้าร้านต้องโหลด stylesheet แถวร้านตามหมวดรุ่นประกายต่อเนื่อง');
assert.match(html, /store-category-rows\.js\?v=category-rows-v3-shared-catalog/, 'หน้าร้านต้องโหลด runtime แถวร้านตามหมวดรุ่นประกายต่อเนื่อง');
assert.match(rows, /catalog_stores\?select=\$\{storeFields\}&order=rating\.desc&limit=300/, 'แถวหมวดต้องโหลดร้านจาก catalog จริง');
assert.match(rows, /store_categories\?select=\*&limit=100/, 'แถวหมวดต้องอ่านรายการหมวดจริงเพื่อรองรับหมวดที่ยังไม่มีร้าน');
assert.match(rows, /category_id \|\| store\.category_name/, 'โมดูลต้องจัดกลุ่มจากหมวดหมู่จริงของร้าน');
assert.match(rows, /isStoreReady\(right\).*isStoreReady\(left\)/, 'การจัดอันดับต้องให้ร้านพร้อมให้บริการมาก่อน');
assert.match(rows, /numeric\(right\.rating\) - numeric\(left\.rating\)/, 'การจัดอันดับต้องใช้คะแนนรีวิว');
assert.match(rows, /numeric\(right\.review_count\) - numeric\(left\.review_count\)/, 'การจัดอันดับต้องใช้จำนวนรีวิว');
assert.match(rows, /numeric\(right\.order_count\) - numeric\(left\.order_count\)/, 'การจัดอันดับต้องใช้จำนวนออร์เดอร์ที่ระบบเผยแพร่');
assert.match(rows, /const tierForIndex = index => index < MAX_TIER \? index \+ 1 : 0/, 'Tier 1–5 ต้องคำนวณสดจากอันดับในหน้า Customer');
assert.doesNotMatch(rows, /M\.request\([^\n]*(?:platform_configs|campaigns|campaign_stores)/, 'Tier ต้องไม่บันทึกหรือผูกกับข้อมูลถาวร/แคมเปญ');
assert.match(rows, /href = `store\.html\?id=\$\{encodeURIComponent\(store\.id\)\}`/, 'ทั้งการ์ดต้องเชื่อมไปหน้าเมนูร้านเดิม');
assert.match(rows, /ยังไม่มีร้านค้าที่พร้อมแสดงในหมวดนี้/, 'หมวดที่ยังไม่มีร้านต้องมี empty state ชัดเจน');
assert.match(rows, /classList\.add\('has-tier-sparkle'\)/, 'Tier ทุกใบต้องเปิดเอฟเฟกต์ประกายต่อเนื่อง');
assert.doesNotMatch(rows, /TIER_REMINDER_MS|scheduleTierReminder/, 'Tier แบบต่อเนื่องไม่ควรใช้ระบบเตือนเพื่อเล่นเป็นช่วง ๆ');
assert.match(rows, /is-inview/, 'Tier ต้องเล่นเอฟเฟกต์เฉพาะการ์ดที่อยู่ในจอเพื่อประหยัดแบต');
assert.match(rows, /data-lazy-row/, 'แถวหมวดใต้จอต้องรอโหลดเมื่อผู้ใช้เลื่อนใกล้ถึง');
assert.match(rows, /prefers-reduced-motion/, 'Tier ต้องเคารพการลดการเคลื่อนไหวของอุปกรณ์');
assert.match(css, /\.store-category-row__rail \{\s*display: flex/, 'แต่ละหมวดต้องเป็นแถวเลื่อนแนวนอน');
assert.match(css, /flex: 0 0 144px/, 'การ์ดในหมวดต้องคงขนาดเพื่อเลื่อนแนวนอน');
assert.match(css, /aspect-ratio: 1 \/ 1/, 'การ์ดในหมวดต้องเป็นสี่เหลี่ยมจัตุรัส');
assert.match(css, /store-category-row-card--tier-1/, 'ต้องมีสไตล์เฉพาะสำหรับ Tier 1');
assert.match(css, /has-tier-sparkle::before/, 'การ์ด Tier ต้องมีประกายที่คงอยู่บนการ์ด');
assert.match(css, /tier-sparkle-drift-one .*infinite/, 'ประกายหลักต้องเคลื่อนไหวแบบ infinite');
assert.match(css, /tier-badge-glow .*infinite/, 'ป้าย Tier ต้องมี glow แบบ infinite');
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/, 'เอฟเฟกต์ประกายต้องเล่นเฉพาะเมื่อผู้ใช้ไม่ลดการเคลื่อนไหว');

console.log('customer store category rows contract: PASS');
