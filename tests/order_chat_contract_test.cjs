const fs = require('fs');
const assert = require('assert');

const mig = fs.readFileSync('supabase/migrations/20260913_order_chat.sql', 'utf8');
assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.order_chat_messages/, 'ต้องมีตารางแชท');
assert.match(mig, /is_order_chat_participant/, 'ต้องมีฟังก์ชันเช็กผู้ร่วมแชท');
assert.match(mig, /r\.user_id = auth\.uid/, 'ไรเดอร์ต้องได้รับมอบหมายก่อนถึงแชทได้');
assert.match(mig, /sender_id = auth\.uid/, 'ห้ามปลอมคนส่ง');
assert.match(mig, /chat-voice/, 'ต้องมี bucket เสียง');
assert.match(mig, /trg_notify_order_chat/, 'ข้อความใหม่ต้องแจ้งเตือนคู่แชท');
assert.match(mig, /trg_purge_chat_on_order_end/, 'จบออร์เดอร์ต้องลบประวัติ');
assert.match(mig, /purge-order-chat-daily/, 'ต้องมี cron กวาดตกค้าง');
assert.match(mig, /chat-cleanup/, 'ต้องลบไฟล์เสียงผ่าน edge function');
assert(!/x-push-secret', '[A-Za-z0-9]/.test(mig), 'ห้ามมี secret ใน migration');

const fn = fs.readFileSync('supabase/functions/chat-cleanup/index.ts', 'utf8');
assert.match(fn, /x-push-secret/, 'cleanup ต้องตรวจ secret');
assert.match(fn, /chat-voice/, 'cleanup ต้องลบใน bucket chat-voice');
assert.match(fn, /\.remove\(paths\)/, 'cleanup ต้องลบไฟล์จริง');

console.log('order chat contract: PASS');
