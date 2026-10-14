const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const Category = require('../models/Category');
const Product = require('../models/Product');
const productController = require('../controllers/productController');

const mainId = '65a000000000000000000001';
const subId = '65a000000000000000000002';
const otherMainId = '65a000000000000000000003';
const categories = [
  { _id: mainId, name: 'Beads & Jewelry', slug: 'beads-jewelry', parentId: null },
  { _id: subId, name: 'Crystal Beads', slug: 'crystal-beads', parentId: mainId },
  { _id: otherMainId, name: 'Footwear', slug: 'footwear', parentId: null }
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

test('rejects missing or inconsistent category assignments before image upload', async () => {
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)) || null);
  const baseBody = {
    name: 'Bracelet',
    origin: 'Ghana',
    description: 'Handmade',
    price: '25'
  };

  const missing = response();
  await productController.createProduct({ body: baseBody, files: {} }, missing);
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body.message, /mainCategoryId/);

  const inconsistent = response();
  await productController.createProduct({
    body: { ...baseBody, mainCategoryId: otherMainId, subCategoryId: subId },
    files: {}
  }, inconsistent);
  assert.equal(inconsistent.statusCode, 400);
  assert.match(inconsistent.body.message, /belong to the selected/);
});

test('filters products by main and subcategory and searches names and category names case-insensitively', async () => {
  const returnedProduct = {
    _id: '65a000000000000000000010',
    name: 'Glass bracelet',
    category: 'Crystal Beads',
    categories: ['Crystal Beads'],
    mainCategoryId: categories[0],
    subCategoryId: categories[1],
    availableFor: ['buy'],
    price: 25,
    image: 'bracelet.jpg',
    subImages: []
  };
  let findFilter;
  let categoryFilter;
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)) || null);
  replace(Category, 'find', (filter) => {
    categoryFilter = filter;
    return Promise.resolve(categories.filter((category) => filter.name.test(category.name)));
  });
  replace(Product, 'find', (filter) => {
    findFilter = filter;
    const query = {
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve([returnedProduct]).then(resolve, reject); }
    };
    return query;
  });
  replace(Product, 'countDocuments', async () => 1);

  const res = response();
  await productController.getProducts({
    query: { mainCategoryId: mainId, subCategoryId: subId, search: 'BEADS', page: '2', limit: '5' }
  }, res);

  assert.equal(findFilter.mainCategoryId, mainId);
  assert.equal(findFilter.subCategoryId, subId);
  assert.equal(findFilter.$and[0].$or.some((term) => term.mainCategoryId?.$in?.includes(mainId)), true);
  assert.equal(findFilter.$and[0].$or.some((term) => term.subCategoryId?.$in?.includes(subId)), true);
  assert.equal(categoryFilter.name.ignoreCase, true);
  assert.equal(res.body.products[0].mainCategoryName, 'Beads & Jewelry');
  assert.equal(res.body.products[0].subCategoryName, 'Crystal Beads');
  assert.equal(res.body.products[0].mainCategoryId, mainId);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 5, total: 1, totalPages: 1 });
});

test('rejects a subcategory query that does not belong to the selected main category', async () => {
  replace(Category, 'findById', async (id) => categories.find((category) => category._id === String(id)) || null);
  const res = response();
  await productController.getProducts({
    query: { mainCategoryId: otherMainId, subCategoryId: subId }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /belong to mainCategoryId/);
});
