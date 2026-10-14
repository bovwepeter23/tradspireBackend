const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const mongoose = require('mongoose');

const Category = require('../models/Category');
const Product = require('../models/Product');
const categoryController = require('../controllers/categoryController');
const { adminOnly, protect } = require('../middleware/auth');

const mainId = '65a000000000000000000001';
const otherMainId = '65a000000000000000000002';
const subId = '65a000000000000000000003';
const childId = '65a000000000000000000004';
const makeCategory = (id, name, parentId = null, sortOrder = 0) => ({
  _id: id,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  parentId,
  sortOrder,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  save: async () => {},
  deleteOne: async () => {}
});
const categories = [
  makeCategory(mainId, 'Main'),
  makeCategory(otherMainId, 'Other Main', null, 1),
  makeCategory(subId, 'Sub', mainId),
  makeCategory(childId, 'Child', subId)
];
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

afterEach(() => {
  for (const [object, key, original] of originals) object[key] = original;
  originals.length = 0;
});

test('category reads sort by sortOrder and name and expose hierarchy fields', async () => {
  let sort;
  replace(Category, 'find', () => ({
    sort(value) {
      sort = value;
      return Promise.resolve(categories);
    }
  }));
  const res = response();
  await categoryController.getCategories({}, res);
  assert.deepEqual(sort, { sortOrder: 1, name: 1 });
  assert.equal(res.body.categories[2].parentId, mainId);
  assert.equal(res.body.categories[0].id, mainId);
});

test('creates trimmed categories, allows same child name under another parent, and rejects duplicates case-insensitively', async () => {
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)));
  replace(Category, 'findOne', (filter) => {
    if (filter.nameKey) {
      return Promise.resolve(categories.find((category) =>
        String(category.parentId) === String(filter.parentId) &&
        category.name.toLowerCase() === filter.nameKey
      ) || null);
    }
    return { sort: async () => null };
  });
  replace(Category, 'create', async (data) => makeCategory('65a000000000000000000005', data.name, data.parentId, data.sortOrder));

  const duplicateResponse = response();
  await categoryController.createCategory({ body: { name: '  sub ', parentId: mainId } }, duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 409);

  const createdResponse = response();
  await categoryController.createCategory({ body: { name: '  Sub  ', parentId: otherMainId } }, createdResponse);
  assert.equal(createdResponse.statusCode, 201);
  assert.equal(createdResponse.body.category.name, 'Sub');
  assert.equal(createdResponse.body.category.parentId, otherMainId);
});

test('rejects invalid nesting, self-parenting, and parenting a main category that has children', async () => {
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)));
  replace(Category, 'exists', async (filter) => filter.parentId === mainId);
  replace(Category, 'findOne', async () => null);

  const nested = response();
  await categoryController.createCategory({ body: { name: 'Too deep', parentId: subId } }, nested);
  assert.equal(nested.statusCode, 400);

  const self = response();
  await categoryController.updateCategory({ params: { id: mainId }, body: { parentId: mainId } }, self);
  assert.equal(self.statusCode, 400);

  const reparent = response();
  await categoryController.updateCategory({ params: { id: mainId }, body: { parentId: otherMainId } }, reparent);
  assert.equal(reparent.statusCode, 400);
});

test('renames and reparents categories while keeping assigned product category IDs consistent', async () => {
  const productUpdates = [];
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)));
  replace(Category, 'findOne', async () => null);
  replace(Category, 'exists', async () => false);
  replace(Product, 'updateMany', async (...args) => { productUpdates.push(args); });
  replace(mongoose, 'startSession', async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {}
  }));

  const renamed = response();
  await categoryController.updateCategory({ params: { id: subId }, body: { name: 'Renamed Sub' } }, renamed);
  assert.equal(renamed.body.category.name, 'Renamed Sub');
  assert.equal(renamed.body.category.slug, 'renamed-sub');

  const movedSubcategory = response();
  await categoryController.updateCategory({ params: { id: subId }, body: { parentId: otherMainId } }, movedSubcategory);
  assert.equal(movedSubcategory.statusCode, 200);
  assert.deepEqual(productUpdates[0][0], { subCategoryId: subId });
  assert.deepEqual(productUpdates[0][1], { $set: { mainCategoryId: otherMainId } });

  const promoted = response();
  await categoryController.updateCategory({ params: { id: subId }, body: { parentId: null } }, promoted);
  assert.equal(promoted.statusCode, 200);
  assert.deepEqual(productUpdates[1][1], { $set: { mainCategoryId: subId, subCategoryId: null } });

  const demoted = response();
  await categoryController.updateCategory({ params: { id: otherMainId }, body: { parentId: mainId } }, demoted);
  assert.equal(demoted.statusCode, 200);
  assert.deepEqual(productUpdates[2][0], { mainCategoryId: otherMainId });
  assert.deepEqual(productUpdates[2][1], { $set: { mainCategoryId: mainId, subCategoryId: otherMainId } });
});

test('deletion returns 409 for children or assigned products and deletes an unused category', async () => {
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)));
  replace(Category, 'exists', async (filter) => filter.parentId === mainId);
  replace(Product, 'exists', async (filter) => filter.$or.some((term) => term.mainCategoryId === subId));

  const childrenConflict = response();
  await categoryController.deleteCategory({ params: { id: mainId } }, childrenConflict);
  assert.equal(childrenConflict.statusCode, 409);
  assert.match(childrenConflict.body.message, /subcategories/);

  const productConflict = response();
  await categoryController.deleteCategory({ params: { id: subId } }, productConflict);
  assert.equal(productConflict.statusCode, 409);
  assert.match(productConflict.body.message, /products are assigned/);

  replace(Category, 'exists', async () => false);
  replace(Product, 'exists', async () => false);
  const deleted = response();
  await categoryController.deleteCategory({ params: { id: otherMainId } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.message, 'Category deleted');
});

test('category mutations require authenticated admin authorization', async () => {
  let nextCalled = false;
  const unauthorized = response();
  await protect({ get: () => undefined }, unauthorized, () => { nextCalled = true; });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(nextCalled, false);

  const forbidden = response();
  adminOnly({ user: { role: 'user' } }, forbidden, () => { nextCalled = true; });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(nextCalled, false);

  adminOnly({ user: { role: 'admin' } }, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
