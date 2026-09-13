(() => {
  'use strict';

  const ORDER_STATUS = Object.freeze({
    ADMIN_REVIEW: 'รอแอดมินตรวจสอบ',
    PAYMENT_REVIEW: 'รอตรวจสอบการชำระเงิน',
    PAYMENT_RETRY: 'ต้องแนบสลิปใหม่',
    CREDIT_REVIEW: 'รอตรวจสอบเครดิต',
    STORE_ACCEPTED: 'ร้านค้ารับออร์เดอร์',
    PREPARING: 'กำลังเตรียมสินค้า',
    RIDER_PICKUP: 'ไรเดอร์กำลังไปรับ',
    ARRIVED_STORE: 'ถึงร้านค้า',
    COLLECTED: 'รับสินค้าแล้ว',
    DELIVERING: 'กำลังไปส่ง',
    COMPLETED: 'สำเร็จแล้ว',
    CANCELLED: 'ยกเลิก'
  });

  const allowedTransitions = Object.freeze({
    [ORDER_STATUS.ADMIN_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.PAYMENT_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.PAYMENT_RETRY, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.PAYMENT_RETRY]: [ORDER_STATUS.PAYMENT_REVIEW, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.CREDIT_REVIEW]: [ORDER_STATUS.STORE_ACCEPTED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.STORE_ACCEPTED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.RIDER_PICKUP, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.PREPARING]: [ORDER_STATUS.RIDER_PICKUP, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.RIDER_PICKUP]: [ORDER_STATUS.ARRIVED_STORE, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.ARRIVED_STORE]: [ORDER_STATUS.COLLECTED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.COLLECTED]: [ORDER_STATUS.DELIVERING, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.DELIVERING]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.COMPLETED]: [],
    [ORDER_STATUS.CANCELLED]: []
  });

  const actorRules = Object.freeze({
    customer: new Set([ORDER_STATUS.PAYMENT_REVIEW, ORDER_STATUS.CANCELLED]),
    merchant: new Set([ORDER_STATUS.PREPARING, ORDER_STATUS.RIDER_PICKUP]),
    rider: new Set([ORDER_STATUS.RIDER_PICKUP, ORDER_STATUS.ARRIVED_STORE, ORDER_STATUS.COLLECTED, ORDER_STATUS.DELIVERING, ORDER_STATUS.COMPLETED]),
    admin: new Set(Object.values(ORDER_STATUS))
  });

  function canTransition({ from, to, actor }) {
    if (!from || !to || from === to) return { ok: false, reason: 'ไม่มีการเปลี่ยนสถานะที่ต้องบันทึก' };
    if (!Object.values(ORDER_STATUS).includes(to)) return { ok: false, reason: 'สถานะปลายทางไม่อยู่ในสัญญากลาง' };
    if (!actorRules[actor]?.has(to)) return { ok: false, reason: 'บทบาทนี้ไม่มีสิทธิ์เปลี่ยนเป็นสถานะดังกล่าว' };
    if (!(allowedTransitions[from] || []).includes(to)) return { ok: false, reason: `ไม่อนุญาตให้เปลี่ยนจาก “${from}” เป็น “${to}”` };
    return { ok: true };
  }

  const MEDIA_POLICY = Object.freeze({
    defaultImageMaxBytes: 1_000_000,
    paymentSlipMaxBytes: 5_242_880,
    acceptedImageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    riderDocumentMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  });

  function validateImageFile(file, { maxBytes = MEDIA_POLICY.defaultImageMaxBytes, allowedMimeTypes = MEDIA_POLICY.acceptedImageMimeTypes } = {}) {
    if (!file) return { ok: false, reason: 'ไม่พบไฟล์ที่อัปโหลด' };
    if (!allowedMimeTypes.includes(file.type)) return { ok: false, reason: 'ชนิดไฟล์ไม่ได้รับอนุญาต' };
    if (file.size > maxBytes) return { ok: false, reason: 'ขนาดไฟล์เกินข้อกำหนดก่อนบีบอัด' };
    return { ok: true };
  }

  window.APServiceCore = Object.freeze({
    version: 'four-client-contract-v2',
    contracts: { orderStatus: ORDER_STATUS, media: MEDIA_POLICY },
    order: { canTransition },
    media: { validateImageFile }
  });
})();
