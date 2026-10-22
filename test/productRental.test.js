const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const cloudinary = require('../config/cloudinary');
const originalUploadProductImage = cloudinary.uploadProductImage;
cloudinary.uploadProductImage = async () => ({
  secure_url: 'rental-item.jpg',
  public_id: 'rental-item'
});

const Category = require('../models/Category');
const Product = require('../models/Product');
const productController = require('../controllers/productController');

const mainCategoryId = '65a000000000000000000001';
const productId = '65a000000000000000000010';
const mainCategory = { _id: mainCategoryId, name: 'Accessories', slug: 'accessories' };
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

test('creates multipart products from listingType and returns consistent rental fields', async () => {
  replace(Category, 'findById', async () => mainCategory);
  let savedProduct;
  replace(Product, 'create', async (fields) => {
    savedProduct = { _id: productId, ...fields };
    return savedProduct;
  });

  const res = response();
  await productController.createProduct({
    body: {
      name: 'Beaded bag',
      origin: 'Ghana',
      description: 'Handmade rental item',
      mainCategoryId,
      listingType: ['buy', 'rent'],
      price: '50',
      rentPricePerDay: '8'
    },
    files: { mainImage: [{ buffer: Buffer.from('image') }] }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(savedProduct.availableFor, ['buy', 'rent']);
  assert.equal(savedProduct.rentPricePerDay, 8);
  assert.deepEqual(res.body.product.availableFor, ['buy', 'rent']);
  assert.deepEqual(res.body.product.listingType, ['buy', 'rent']);
  assert.deepEqual(res.body.product.listingTypes, ['buy', 'rent']);
  assert.equal(res.body.product.isRentable, true);
  assert.equal(res.body.product.rentPricePerDay, 8);
});

test('creates Buy-only products and updates listingType into the canonical availability field', async () => {
  replace(Category, 'findById', async () => mainCategory);
  let created;
  replace(Product, 'create', async (fields) => {
    created = { _id: productId, ...fields };
    return created;
  });
  const createResponse = response();
  await productController.createProduct({
    body: {
      name: 'Leather wallet',
      origin: 'Ghana',
      description: 'Handmade wallet',
      mainCategoryId,
      listingType: 'buy',
      price: '20'
    },
    files: { mainImage: [{ buffer: Buffer.from('image') }] }
  }, createResponse);

  assert.equal(createResponse.statusCode, 201);
  assert.deepEqual(created.availableFor, ['buy']);
  assert.equal(createResponse.body.product.isRentable, false);
  assert.equal(createResponse.body.product.rentPricePerDay, undefined);

  const existing = {
    _id: productId,
    name: 'Leather wallet',
    mainCategoryId,
    subCategoryId: null,
    availableFor: ['buy'],
    price: 20,
    origin: 'Ghana',
    description: 'Handmade wallet',
    image: 'wallet.jpg',
    imagePublicId: 'wallet',
    subImages: [],
    async save() { this.saved = true; }
  };
  replace(Product, 'findById', () => ({
    select: async () => existing
  }));
  const updateResponse = response();
  await productController.updateProduct({
    params: { id: productId },
    body: { listingType: 'rent', rentPricePerDay: '4' },
    files: {}
  }, updateResponse);

  assert.equal(existing.saved, true);
  assert.deepEqual(existing.availableFor, ['rent']);
  assert.equal(existing.rentPricePerDay, 4);
  assert.deepEqual(updateResponse.body.product.availableFor, ['rent']);
  assert.equal(updateResponse.body.product.rentPricePerDay, 4);
});

test('returns rentable product fields consistently from list and detail endpoints', async () => {
  const rentableProduct = {
    _id: productId,
    name: 'Beaded bag',
    category: 'Accessories',
    categories: ['Accessories'],
    mainCategoryId: mainCategory,
    subCategoryId: null,
    availableFor: ['rent'],
    rentPricePerDay: 8,
    image: 'bag.jpg',
    subImages: []
  };
  replace(Product, 'find', () => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    then(resolve, reject) { return Promise.resolve([rentableProduct]).then(resolve, reject); }
  }));
  replace(Product, 'countDocuments', async () => 1);
  replace(Product, 'findById', () => ({
    populate() { return this; },
    then(resolve, reject) { return Promise.resolve(rentableProduct).then(resolve, reject); }
  }));

  const listResponse = response();
  await productController.getProducts({ query: {} }, listResponse);
  const listed = listResponse.body.products[0];
  assert.deepEqual(listed.availableFor, ['rent']);
  assert.equal(listed.rentPricePerDay, 8);
  assert.equal(listed.isRentable, true);

  const detailResponse = response();
  await productController.getProduct({ params: { id: productId } }, detailResponse);
  const detailed = detailResponse.body.product;
  assert.deepEqual(detailed.availableFor, ['rent']);
  assert.deepEqual(detailed.listingType, ['rent']);
  assert.equal(detailed.rentPricePerDay, 8);
  assert.equal(detailed.isRentable, true);
});

afterEach(() => {
  cloudinary.uploadProductImage = originalUploadProductImage;
});
