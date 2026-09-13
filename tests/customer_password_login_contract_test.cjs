const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('customer/customer-app.js', 'utf8');

assert.match(app, /data-auth-mode="magic"/, 'ล็อกอินต้องมีโหมดลิงก์ยืนยัน');
assert.match(app, /data-auth-mode="password"/, 'ล็อกอินต้องมีโหมดรหัสผ่าน');
assert.match(app, /data-password-field/, 'โหมดรหัสผ่านต้องมีช่องกรอกรหัสผ่าน');
assert.match(app, /data-password-submit/, 'โหมดรหัสผ่านต้องมีปุ่มเข้าสู่ระบบ');
assert.match(app, /M\.auth\.signIn\(email, password\)/, 'โหมดรหัสผ่านต้องเรียก signIn');
assert.match(app, /data-password-hint/, 'โหมดรหัสผ่านต้องมีลิงก์ตั้งรหัสผ่านใหม่');
assert.match(app, /กรุณากรอกรหัสผ่าน/, 'ต้องแจ้งเตือนเมื่อไม่กรอกรหัสผ่าน');

const css = fs.readFileSync('customer/customer-auth.css', 'utf8');
assert.match(css, /\.ap-login-mode/, 'ต้องมีสไตล์ปุ่มสลับโหมด');

console.log('customer password login contract: PASS');
