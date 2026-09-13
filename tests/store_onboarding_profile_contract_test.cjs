const fs = require('fs');
const assert = require('assert');

const sql = fs.readFileSync('supabase/migrations/20260913_store_onboarding_profile.sql', 'utf8');
assert.match(sql, /ADD COLUMN IF NOT EXISTS profile_pct/, 'ต้องมีคอลัมน์ profile_pct');
assert.match(sql, /ADD COLUMN IF NOT EXISTS profile_exempt/, 'ต้องมีคอลัมน์ profile_exempt');
assert.match(sql, /ADD COLUMN IF NOT EXISTS profile_missing/, 'ต้องมีคอลัมน์ profile_missing');
assert.match(sql, /compute_store_profile/, 'ต้องมีฟังก์ชันคำนวณ %');
assert.match(sql, /stores_profile_pct_trg/, 'ต้องมี trigger คำนวณ % ที่ตาราง stores');
assert.match(sql, /store_hours_profile_trg/, 'เวลาเปลี่ยนต้องคำนวณ % ใหม่');
assert.match(sql, /menu_items_profile_trg/, 'เมนูเปลี่ยนต้องคำนวณ % ใหม่');
assert.match(sql, /SET profile_exempt = true/, 'ร้านเก่าต้องได้ยกเว้นอัตโนมัติ');
assert.match(sql, /กรอกให้ครบ 100%% ก่อนเปิดรับออร์เดอร์/, 'RPC ต้องปัดเปิดร้านเมื่อไม่ครบ');
assert.match(sql, /profile_pct < 100 AND v_store\.profile_exempt IS NOT TRUE/, 'accepts_orders ต้องเช็ก %');
assert.match(sql, /s\.profile_pct >= 100 OR s\.profile_exempt IS TRUE/, 'catalog ต้องซ่อนร้านไม่ครบ');
assert.match(sql, /nullif\(trim\(s\.image_url\), ''\) IS NOT NULL/, 'catalog ต้องบังคับมีรูป');

console.log('store onboarding profile contract: PASS');
