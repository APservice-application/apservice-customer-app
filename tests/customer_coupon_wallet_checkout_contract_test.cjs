const fs = require('fs');
const assert = require('assert');

const migration = fs.readFileSync('supabase/migrations/20260913_coupon_wallet_claim_grant.sql', 'utf8');
const profile = fs.readFileSync('customer/profile-account-center.js', 'utf8');
const profilePage = fs.readFileSync('customer/profile.html', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');
const checkoutPage = fs.readFileSync('customer/checkout.html', 'utf8');

assert.match(migration, /customer_coupons_owner_read/, 'กระเป๋าคูปองต้องมี RLS ให้เจ้าของอ่านของตัวเอง');
assert.match(migration, /merchant_coupon_requests_owner_insert/, 'ร้านต้องส่งคำขอได้เฉพาะร้านตัวเอง');
assert.match(migration, /coupons_merchant_read_own/, 'ร้านต้องอ่านได้เฉพาะคูปองร้านตัวเอง');
assert.match(migration, /sync_coupon_active_status_after_change/, 'ต้องมี trigger ซิงก์ active กับ status สองทาง');
assert.match(migration, /ระบุคูปองได้ร้านละ 1 ใบเท่านั้น/, 'checkout ต้องบังคับร้านละ 1 ใบ');
assert.match(migration, /กรุณากดรับคูปอง % ก่อนใช้/, 'คูปองแบบกดรับต้องอยู่ในกระเป๋าก่อนใช้');
assert.match(migration, /INSERT INTO public\.coupon_redemptions\(coupon_id, customer_id, order_id, discount_amount\)/, 'ใช้คูปองต้องบันทึกประวัติพร้อมยอดส่วนลด');
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_customer_coupon\(uuid\) TO authenticated/, 'RPC กดรับต้องเปิดเฉพาะผู้เข้าสู่ระบบ');

assert.match(profile, /customer_coupons\?select=.*coupons\(/, 'โปรไฟล์ต้องดึงกระเป๋าคูปองพร้อมรายละเอียด');
assert.match(profile, /rpc\/claim_customer_coupon/, 'ต้องมีปุ่มกดรับคูปองเรียก RPC');
assert.match(profile, /data-claim-coupon/, 'การ์ดคูปองรอรับต้องมีปุ่มรับ');
assert.match(profile, /walletAvailable/, 'ต้องแยกคูปองพร้อมใช้');
assert.match(profile, /walletHistory/, 'ต้องมีประวัติคูปองที่ใช้/หมดอายุแล้ว');
assert.match(profilePage, /profile-account-center\.js\?v=account-center-v3-coupon-wallet/, 'หน้าโปรไฟล์ต้องโหลด JS กระเป๋าคูปองรุ่นใหม่');

assert.match(app, /id="couponPicker"/, 'หน้า checkout ต้องมีตัวเลือกคูปองแยกร้าน');
assert.match(app, /data-coupon-store/, 'ตัวเลือกคูปองต้องผูกเป็นรายร้าน');
assert.match(app, /p_coupons: selectedCoupons\(\)/, 'checkout ต้องส่งคูปองที่เลือกไปเซิร์ฟเวอร์');
assert.match(app, /coupons: selectedCoupons\(\)/, 'ลายนิ้วมือ idempotency ต้องรวมคูปองที่เลือก');
assert.match(app, /couponSaved/, 'ต้องแสดงยอดประหยัดจากคูปองหลังสั่งซื้อ');
assert.match(checkoutPage, /coupon=checkout-coupon-v1/, 'หน้า checkout ต้อง cache-bust JS คูปอง');

console.log('customer coupon wallet checkout contract: PASS');
