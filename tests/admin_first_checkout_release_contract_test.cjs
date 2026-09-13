const fs = require('fs');
const assert = require('assert');

const migration = fs.readFileSync('supabase/migrations/20260913_admin_first_food_checkout_release.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/role-access/index.ts', 'utf8');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_food_checkout_group_v3\(/, 'ต้องออก migration แทนที่ฟังก์ชัน checkout กลุ่มอาหารเวอร์ชันปัจจุบัน');
assert.match(migration, /THEN 'รอตรวจสอบการชำระเงิน' ELSE 'รอแอดมินตรวจสอบ' END/, 'ออเดอร์ไม่แนบสลิปต้องเกิดใหม่ที่สถานะรอแอดมินตรวจสอบ');
assert.match(migration, /INSERT INTO public\.order_status_events\(order_id, status, actor_id, actor_label\) VALUES \(v_order\.id, v_status/, 'ต้องคงประวัติสถานะเริ่มต้นของออเดอร์');
assert.match(edge, /ADMIN_REVIEW: 'รอแอดมินตรวจสอบ'/, 'edge ต้องรู้จักสถานะรอแอดมินตรวจสอบ');
assert.match(edge, /\[ORDER_STATUS\.ADMIN_REVIEW\]: \[ORDER_STATUS\.STORE_ACCEPTED, ORDER_STATUS\.CANCELLED\]/, 'edge ต้องอนุญาตให้แอดมินปล่อยออเดอร์หรือยกเลิกจากคิวตรวจเท่านั้น');
assert.match(edge, /ORDER_STATUS\.ADMIN_REVIEW, ORDER_STATUS\.STORE_ACCEPTED/, 'edge ต้องให้แอดมินแก้ไขออเดอร์ระหว่างรอตรวจได้');

console.log('admin-first checkout release contract: PASS');
