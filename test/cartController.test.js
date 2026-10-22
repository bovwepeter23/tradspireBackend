const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { afterEach, test } = require('node:test');

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const cartController = require('../controllers/cartController');
const orderController = require('../controllers/orderController');
const { protect } = require('../middleware/auth');

const userId = '65a000000000000000000001';
const productId = '65a000000000000000000002';
const cartItemId = '65a000000000000000000003';
const originalJwtSecret = process.env.JWT_SECRET;
const product = {
  _id: productId,
  name: 'Desk',
  image: 'desk.jpg',
  price: 1000,
  rentPricePerDay: 25,
  availableFor: ['buy', 'rent']
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

const makeCart = (items = []) => {
  const cart = {
    user: userId,
    items,
    save: async () => { cart.saved = true; }
  };
  cart.items.id = (id) => cart.items.find((item) => item._id.toString() === id);
  return cart;
};

const originals = [];
const replace = (object, key, value) => {
  if (!originals.some(([target, property]) => target === object && property === key)) {
    originals.push([object, key, object[key]]);
  }
  object[key] = value;
};

afterEach(() => {
  for (const [object, key, original] of originals) object[key] = original;
  originals.length = 0;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test('requires authentication before reaching a protected route', async () => {
  const res = response();
  let continued = false;
  await protect({ get: () => undefined }, res, () => { continued = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(continued, false);

  process.env.JWT_SECRET = 'test-secret';
  replace(User, 'findById', async () => ({ _id: userId, tokenVersion: 0 }));
  const token = jwt.sign({ id: userId, tokenVersion: 0 }, process.env.JWT_SECRET);
  const authorizedResponse = response();
  await protect({ get: () => `Bearer ${token}` }, authorizedResponse, () => { continued = true; });
  assert.equal(continued, true);
});

test('persists, merges compatible cart items, and returns current product price', async () => {
  const item = { _id: cartItemId, product: productId, purchaseType: 'buy', quantity: 2, rentalDays: null };
  const cart = makeCart([item]);
  replace(Cart, 'findOne', async () => cart);
  replace(Product, 'findById', async () => product);
  replace(Product, 'find', async () => [product]);

  const res = response();
  await cartController.addCartItem({
    user: { _id: userId },
    body: { productId, quantity: 3, purchaseType: 'buy', price: 0 }
  }, res);

  assert.equal(item.quantity, 5);
  assert.equal(cart.saved, true);
  assert.equal(res.body.cart.items[0].price, 1000);
  assert.equal(res.body.cart.items[0].name, 'Desk');
  assert.equal(res.body.cart.items[0].image, 'desk.jpg');
  assert.equal(res.body.cart.items[0].productId._id, productId);
});

test('adds rental cart items with server price and rental details', async () => {
  const cart = makeCart();
  replace(Cart, 'findOne', async () => cart);
  replace(Product, 'findById', async () => product);
  replace(Product, 'find', async () => [product]);

  const res = response();
  await cartController.addCartItem({
    user: { _id: userId },
    body: { productId, quantity: 2, purchaseType: 'rent', rentalDays: 5, price: 0 }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(cart.items[0].purchaseType, 'rent');
  assert.equal(cart.items[0].rentalDays, 5);
  assert.equal(res.body.cart.items[0].price, 25);
  assert.equal(res.body.cart.items[0].quantity, 2);
  assert.equal(res.body.cart.items[0].name, 'Desk');
  assert.equal(res.body.cart.items[0].image, 'desk.jpg');
});

test('rejects invalid rental durations and products unavailable for rent', async () => {
  const invalidDuration = response();
  await cartController.addCartItem({
    user: { _id: userId },
    body: { productId, quantity: 1, purchaseType: 'rent', rentalDays: 366 }
  }, invalidDuration);
  assert.equal(invalidDuration.statusCode, 400);

  replace(Product, 'findById', async () => ({ ...product, availableFor: ['buy'] }));
  const unavailable = response();
  await cartController.addCartItem({
    user: { _id: userId },
    body: { productId, quantity: 1, purchaseType: 'rent', rentalDays: 1 }
  }, unavailable);
  assert.equal(unavailable.statusCode, 400);
  assert.match(unavailable.body.message, /not available to rent/);
});

test('creates an empty persisted cart for a first-time cart read', async () => {
  let createdFor;
  replace(Cart, 'findOne', async () => null);
  replace(Cart, 'create', async (data) => {
    createdFor = data.user;
    return makeCart();
  });
  replace(Product, 'find', async () => []);

  const res = response();
  await cartController.getCart({ user: { _id: userId } }, res);
  assert.equal(createdFor, userId);
  assert.deepEqual(res.body, { cart: { items: [] } });
});

test('rejects invalid item values and enforces cart-item ownership', async () => {
  const cart = makeCart([{ _id: cartItemId, product: productId, purchaseType: 'buy', quantity: 1 }]);
  replace(Cart, 'findOne', async () => cart);

  const invalidResponse = response();
  await cartController.addCartItem({
    user: { _id: userId },
    body: { productId, quantity: 100, purchaseType: 'buy' }
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);

  const foreignResponse = response();
  await cartController.updateCartItem({
    user: { _id: userId },
    params: { cartItemId: '65a000000000000000000099' },
    body: { quantity: 2 }
  }, foreignResponse);
  assert.equal(foreignResponse.statusCode, 404);
  assert.equal(cart.saved, undefined);
});

test('creates orders from stored cart prices and clears the cart after success', async () => {
  const cart = makeCart([{
    _id: cartItemId, product: productId, purchaseType: 'buy', quantity: 2, rentalDays: null
  }]);
  const session = {
    startTransaction() {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: async () => {},
    inTransaction: () => true
  };
  replace(require('mongoose'), 'startSession', async () => session);
  replace(Cart, 'findOne', () => ({
    session: () => ({ then: (resolve, reject) => Promise.resolve(cart).then(resolve, reject) })
  }));
  replace(Product, 'findById', () => ({
    session: () => ({ then: (resolve, reject) => Promise.resolve(product).then(resolve, reject) })
  }));
  replace(Order.prototype, 'save', async function () { this.savedForTest = true; });

  const res = response();
  await orderController.createOrder({
    user: { _id: userId, deliveryAddress: null },
    body: {
      items: [{ productId, quantity: 2, purchaseType: 'buy', price: 0 }],
      deliveryAddress: {
        recipientName: 'Buyer', phone: '123', street: '1 Main St', city: 'Town', country: 'US'
      }
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.order.items[0].unitPrice, 1000);
  assert.equal(res.body.order.total, 2000);
  assert.equal(res.body.order.customerPhone, '123');
  assert.equal(res.body.order.deliveryAddress.phone, '123');
  assert.equal(res.body.order.savedForTest, true);
  assert.equal(cart.items.length, 0);
  assert.equal(cart.saved, true);
});

test('does not clear the cart when order persistence fails', async () => {
  const cart = makeCart([{
    _id: cartItemId, product: productId, purchaseType: 'buy', quantity: 1, rentalDays: null
  }]);
  const session = {
    startTransaction() {},
    abortTransaction: async () => {},
    endSession: async () => {},
    inTransaction: () => true
  };
  replace(require('mongoose'), 'startSession', async () => session);
  replace(Cart, 'findOne', () => ({
    session: () => ({ then: (resolve, reject) => Promise.resolve(cart).then(resolve, reject) })
  }));
  replace(Product, 'findById', () => ({
    session: () => ({ then: (resolve, reject) => Promise.resolve(product).then(resolve, reject) })
  }));
  replace(Order.prototype, 'save', async () => { throw new Error('Order persistence failed'); });

  await assert.rejects(orderController.createOrder({
    user: { _id: userId },
    body: {
      items: [{ productId, quantity: 1, purchaseType: 'buy' }],
      deliveryAddress: {
        recipientName: 'Buyer', phone: '123', street: '1 Main St', city: 'Town', country: 'US'
      }
    }
  }, response()), /Order persistence failed/);

  assert.equal(cart.items.length, 1);
  assert.equal(cart.saved, undefined);
});
