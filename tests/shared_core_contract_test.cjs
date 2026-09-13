const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('shared/ap-service-core.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const core = context.window.APServiceCore;
assert.ok(core, 'ต้อง expose Shared Core');
assert.equal(core.version, 'four-client-contract-v2');

const status = core.contracts.orderStatus;
assert.equal(core.order.canTransition({ from: status.STORE_ACCEPTED, to: status.PREPARING, actor: 'merchant' }).ok, true);
assert.equal(core.order.canTransition({ from: status.PREPARING, to: status.RIDER_PICKUP, actor: 'rider' }).ok, true);
assert.equal(core.order.canTransition({ from: status.RIDER_PICKUP, to: status.COMPLETED, actor: 'rider' }).ok, false);
assert.equal(core.order.canTransition({ from: status.PREPARING, to: status.COMPLETED, actor: 'merchant' }).ok, false);
assert.equal(core.order.canTransition({ from: status.COMPLETED, to: status.DELIVERING, actor: 'admin' }).ok, false);
assert.equal(status.ADMIN_REVIEW, 'รอแอดมินตรวจสอบ');
assert.equal(core.order.canTransition({ from: status.ADMIN_REVIEW, to: status.STORE_ACCEPTED, actor: 'admin' }).ok, true);
assert.equal(core.order.canTransition({ from: status.ADMIN_REVIEW, to: status.CANCELLED, actor: 'admin' }).ok, true);
assert.equal(core.order.canTransition({ from: status.ADMIN_REVIEW, to: status.STORE_ACCEPTED, actor: 'merchant' }).ok, false);
assert.equal(core.order.canTransition({ from: status.ADMIN_REVIEW, to: status.RIDER_PICKUP, actor: 'rider' }).ok, false);
assert.equal(core.order.canTransition({ from: status.ADMIN_REVIEW, to: status.PREPARING, actor: 'merchant' }).ok, false);

assert.equal(core.media.validateImageFile({ type: 'image/jpeg', size: 900000 }).ok, true);
assert.equal(core.media.validateImageFile({ type: 'image/gif', size: 1000 }).ok, false);
assert.equal(core.media.validateImageFile({ type: 'image/jpeg', size: 1000001 }).ok, false);

console.log('shared core contract: PASS');
