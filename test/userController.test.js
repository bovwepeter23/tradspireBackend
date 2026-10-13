const assert = require('node:assert/strict');
const { test } = require('node:test');

const userController = require('../controllers/userController');

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

test('updates and returns delivery address through the profile endpoint', async () => {
  const user = {
    _id: '65a000000000000000000001',
    name: 'Buyer',
    email: 'buyer@example.com',
    deliveryAddress: null,
    save: async () => { user.saved = true; }
  };
  const address = {
    recipientName: 'Buyer',
    phone: '123',
    street: '1 Main St',
    city: 'Town',
    country: 'US'
  };
  const updateResponse = response();

  await userController.updateMyProfile({ user, body: { deliveryAddress: address } }, updateResponse);
  const profileResponse = response();
  await userController.getMyProfile({ user }, profileResponse);

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(user.saved, true);
  assert.deepEqual(profileResponse.body.user.deliveryAddress, address);
});

test('accepts delivery addresses without country and supports apartment and delivery instructions aliases', async () => {
  const user = {
    _id: '65a000000000000000000001',
    name: 'Buyer',
    email: 'buyer@example.com',
    deliveryAddress: null,
    save: async () => { user.saved = true; }
  };
  const address = {
    name: 'Buyer',
    phone: '123',
    street: '1 Main St',
    city: 'Town',
    apartment: 'Apt 5B',
    deliveryInstructions: 'Ring the bell'
  };
  const res = response();

  await userController.updateMyProfile({ user, body: { deliveryAddress: address } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(user.saved, true);
  assert.deepEqual(user.deliveryAddress, {
    recipientName: 'Buyer',
    phone: '123',
    street: '1 Main St',
    city: 'Town',
    apartment: 'Apt 5B',
    instructions: 'Ring the bell'
  });
});

test('rejects incomplete delivery addresses without saving profile changes', async () => {
  let saved = false;
  const user = {
    _id: '65a000000000000000000001',
    name: 'Buyer',
    email: 'buyer@example.com',
    save: async () => { saved = true; }
  };
  const res = response();

  await userController.updateMyProfile({
    user,
    body: { deliveryAddress: { street: '1 Main St' } }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(saved, false);
});