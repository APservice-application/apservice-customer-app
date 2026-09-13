const fs = require('fs');
const assert = require('assert');

const mpa = fs.readFileSync('shared/ap-service-mpa.js', 'utf8');
const app = fs.readFileSync('customer/customer-app.js', 'utf8');
const register = fs.readFileSync('customer/customer-register.js', 'utf8');
const recover = fs.readFileSync('customer/customer-recover.js', 'utf8');

assert.match(mpa, /function cooldownSubmit\(button/, 'Shared MPA ต้องมี helper cooldown ปุ่มส่งอีเมล');
assert.match(mpa, /ส่งอีกครั้งใน/, 'cooldown ต้องแสดงเวลานับถอยหลังภาษาไทย');
assert.match(mpa, /setNotice, cooldownSubmit/, 'ต้อง export cooldown ผ่าน M.ui');
assert.match(app, /cooldownSubmit\(submit, 60\)/, 'ล็อกอินต้อง cooldown หลังส่งลิงก์');
assert.match(register, /cooldownSubmit\(submit, 60\)/, 'สมัครต้อง cooldown หลังส่งลิงก์');
assert.match(recover, /cooldownSubmit\(submit, 60\)/, 'กู้รหัสต้อง cooldown หลังส่งลิงก์');
assert.match(app, /too many\|rate limit\/i\.test/, 'ล็อกอินต้อง cooldown เมื่อติด rate limit');
assert.match(register, /\/rate\|too many\/\.test\(raw\)\) M\.ui\.cooldownSubmit/, 'สมัครต้อง cooldown เมื่อติด rate limit');
assert.match(recover, /ส่งคำขอบ่อยเกินไป/, 'กู้รหัสต้องมีข้อความไทยตอนติด rate limit');

console.log('customer email cooldown contract: PASS');
