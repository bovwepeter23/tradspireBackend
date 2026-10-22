const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const orderController = require('../controllers/orderController');
const { adminOnly } = require('../middleware/auth');
const orderRoutes = require('../routes/orderRoutes');

const orderId = '65a000000000000000000010';
const userId = '65a000000000000000000001';
const originals = [];

const replace = (object, key, value) => {
  if (!originals.some(([target, property]) => target === object && property === key)) {
    originals.push([object, key, object[key]]);
  }
  object[key] = value;
};

const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const makeOrder = ({ rental = true, status = 'pending' } = {}) => ({
  _id: orderId,
  user: userId,
  status,
  items: rental ? [
    { purchaseType: 'buy', quantity: 1 },
    { purchaseType: 'rent', quantity: 1, rentalDays: 3 },
    { purchaseType: 'rent', quantity: 1, rentalDays: 7 }
  ] : [{ purchaseType: 'buy', quantity: 1 }],
  async save() { this.saved = true; }
});

const update = async (order, status, extraBody = {}) => {
  replace(Order, 'findById', async () => order);
  const res = response();
  await orderController.updateOrderStatus({
    params: { id: orderId },
    body: { status, ...extraBody }
  }, res);
  return res;
};

afterEach(() => {
  for (const [object, key, original] of originals) object[key] = original;
  originals.length = 0;
});

test('rental orders progress only through the defined lifecycle and get a confirmed returnDueAt', async () => {
  const order = makeOrder();
  const confirmedBefore = Date.now();

  const processing = await update(order, 'processing');
  assert.equal(processing.statusCode, 200);
  assert.equal(order.status, 'processing');
  assert.ok(order.returnDueAt instanceof Date);
  assert.ok(order.returnDueAt.getTime() >= confirmedBefore + 7 * 24 * 60 * 60 * 1000);
  assert.ok(order.returnDueAt.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000);

  for (const status of ['shipped', 'delivered', 'return_due', 'returned', 'inspection', 'completed']) {
    const res = await update(order, status);
    assert.equal(res.statusCode, 200, `transition to ${status}`);
    assert.equal(order.status, status);
  }
  assert.equal(order.deliveredAt instanceof Date, true);
});

test('rental transitions reject skipped and purchase-only statuses with clear errors', async () => {
  const order = makeOrder();

  const skipped = await update(order, 'shipped');
  assert.equal(skipped.statusCode, 409);
  assert.match(skipped.body.message, /cannot transition from pending to shipped/);
  assert.equal(order.status, 'pending');

  const purchaseStatus = await update(order, 'confirmed');
  assert.equal(purchaseStatus.statusCode, 400);
  assert.match(purchaseStatus.body.message, /Invalid status for a rental order/);
});

test('deposit-refunded status requires explicit confirmation after inspection', async () => {
  const order = makeOrder({ status: 'inspection' });

  const unconfirmed = await update(order, 'deposit_refunded');
  assert.equal(unconfirmed.statusCode, 400);
  assert.equal(order.status, 'inspection');
  assert.equal(order.depositRefundedAt, undefined);

  const confirmed = await update(order, 'deposit_refunded', { refundCompleted: true });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(order.status, 'deposit_refunded');
  assert.ok(order.depositRefundedAt instanceof Date);
});

test('rental cancellation is allowed before dispatch and rejected after dispatch', async () => {
  const pending = makeOrder();
  const cancelled = await update(pending, 'cancelled', { reason: 'Customer request' });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(pending.status, 'cancelled');
  assert.equal(pending.cancellationReason, 'Customer request');

  const shipped = makeOrder({ status: 'shipped' });
  const rejected = await update(shipped, 'cancelled');
  assert.equal(rejected.statusCode, 409);
  assert.equal(shipped.status, 'shipped');
});

test('purchase orders retain their existing status behavior and do not get rental dates', async () => {
  const order = makeOrder({ rental: false });
  for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
    const res = await update(order, status);
    assert.equal(res.statusCode, 200);
    assert.equal(order.status, status);
  }
  assert.equal(order.returnDueAt, undefined);

  const lateCancel = await update(order, 'cancelled');
  assert.equal(lateCancel.statusCode, 409);
});

test('admin order listing returns status, rental item details, and returnDueAt', async () => {
  const order = makeOrder({ status: 'return_due' });
  order.returnDueAt = new Date('2026-11-01T12:00:00.000Z');
  replace(Order, 'find', () => ({
    sort: async () => [order]
  }));

  const res = response();
  await orderController.getAllOrders({ query: {} }, res);

  assert.equal(res.body.orders[0].status, 'return_due');
  assert.equal(res.body.orders[0].items[1].purchaseType, 'rent');
  assert.equal(res.body.orders[0].items[1].rentalDays, 3);
  assert.equal(res.body.orders[0].returnDueAt.toISOString(), '2026-11-01T12:00:00.000Z');
});

test('mixed carts submitted to the rental endpoint preserve purchaseType and rentalDays', async () => {
  const rentalProductId = '65a000000000000000000020';
  const purchaseProductId = '65a000000000000000000021';
  const cart = {
    items: [
      { product: purchaseProductId, purchaseType: 'buy', quantity: 2, rentalDays: null },
      { product: rentalProductId, purchaseType: 'rent', quantity: 1, rentalDays: 4 }
    ],
    async save() { this.saved = true; }
  };
  const products = {
    [purchaseProductId]: {
      _id: purchaseProductId, name: 'Lamp', image: 'lamp.jpg',
      price: 20, availableFor: ['buy']
    },
    [rentalProductId]: {
      _id: rentalProductId, name: 'Chair', image: 'chair.jpg',
      rentPricePerDay: 5, availableFor: ['rent']
    }
  };
  const session = {
    startTransaction() {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: async () => {}
  };
  replace(mongoose, 'startSession', async () => session);
  replace(Cart, 'findOne', () => ({
    session: () => ({ then: (resolve, reject) => Promise.resolve(cart).then(resolve, reject) })
  }));
  replace(Product, 'findById', (id) => ({
    session: () => ({
      then: (resolve, reject) => Promise.resolve(products[String(id)]).then(resolve, reject)
    })
  }));
  replace(Order.prototype, 'save', async function () {});

  const res = response();
  await orderController.createOrder({
    user: { _id: userId },
    body: {
      items: [
        { productId: purchaseProductId, purchaseType: 'buy', quantity: 2 },
        { productId: rentalProductId, purchaseType: 'rent', quantity: 1, rentalDays: 4 }
      ],
      deliveryAddress: {
        recipientName: 'Buyer', phone: '123', street: '1 Main St', city: 'Town'
      }
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.order.items[0].purchaseType, 'buy');
  assert.equal(res.body.order.items[0].rentalDays, undefined);
  assert.equal(res.body.order.items[1].purchaseType, 'rent');
  assert.equal(res.body.order.items[1].rentalDays, 4);
  assert.equal(cart.items.length, 0);
  assert.equal(cart.saved, true);
  assert.ok(orderRoutes.stack.some((layer) =>
    layer.route?.path === '/rent' && layer.route.methods.post));
});

test('admin-only authorization rejects users and permits admins', () => {
  let nextCalled = false;
  const forbidden = response();
  adminOnly({ user: { role: 'user' } }, forbidden, () => { nextCalled = true; });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(nextCalled, false);

  const allowed = response();
  adminOnly({ user: { role: 'admin' } }, allowed, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('order schema accepts rental lifecycle statuses and legacy purchase status', () => {
  const allowedStatuses = Order.schema.path('status').enumValues;
  for (const status of [
    'pending', 'processing', 'shipped', 'delivered', 'return_due',
    'returned', 'inspection', 'completed', 'deposit_refunded', 'cancelled', 'confirmed'
  ]) {
    assert.ok(allowedStatuses.includes(status), `${status} is accepted`);
  }
});
