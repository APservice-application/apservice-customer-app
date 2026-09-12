const fs = require('node:fs');
const assert = require('node:assert/strict');

const css = fs.readFileSync('shared/ap-service-mpa.css', 'utf8');
const runtime = fs.readFileSync('shared/ap-service-mpa.js', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');

assert.match(css, /@keyframes mpa-toast-enter/, 'โทสต์ต้องมีอนิเมชันขาเข้า');
assert.match(css, /translateY\(-5px\)/, 'ขาเข้าต้องเด้งนุ่มแบบฟองน้ำ');
assert.match(css, /@keyframes mpa-toast-exit/, 'โทสต์ต้องมีอนิเมชันขาออกค่อยๆ จาง');
assert.match(css, /\.mpa-toast\.is-leaving/, 'ขาออกต้องเล่นผ่านคลาสก่อนซ่อน');
assert.match(css, /safe-area-inset-bottom/, 'โทสต์ต้องพ้นขอบจอมือถือและแถบล่าง');
assert.match(css, /prefers-reduced-motion/, 'ต้องเคารพโหมดลดการเคลื่อนไหว');
assert.match(runtime, /host\.onclick/, 'จิ้มที่โทสต์ต้องปิดทันที');
assert.match(runtime, /setTimeout\(close, duration\)/, 'ไม่จิ้มต้องหายเองตามเวลา');
assert.match(runtime, /is-leaving/, 'รันไทม์ต้องสั่งเล่นอนิเมชันขาออกก่อนซ่อน');
assert.match(app, /setTimeout\(\(\) => location\.assign\(`orders\.html\?group=/, 'สั่งสำเร็จต้องโชว์แจ้งเตือนก่อนพาไปหน้าออร์เดอร์');

console.log('customer toast motion contract: PASS');
