const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const Category = require('../models/Category');
const DatabaseMigration = require('../models/DatabaseMigration');
const Product = require('../models/Product');
const { DEFAULT_CATEGORIES, initializeCategoryData } = require('../services/categorySetup');

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
});

test('seeds defaults idempotently and preserves the supplied category order', async () => {
  const migrations = new Set();
  const seeded = new Map();
  let nextId = 0;
  replace(DatabaseMigration, 'exists', async ({ key }) => migrations.has(key));
  replace(DatabaseMigration, 'create', async ({ key }) => migrations.add(key));
  replace(Category, 'init', async () => {});
  replace(Category, 'findOne', async ({ parentId, nameKey }) =>
    seeded.get(`${parentId || 'root'}:${nameKey}`) || null
  );
  replace(Category, 'exists', async ({ parentId, nameKey }) =>
    seeded.has(`${parentId}:${nameKey}`)
  );
  replace(Category, 'create', async (data) => {
    const category = { ...data, _id: `category-${nextId++}` };
    seeded.set(`${data.parentId || 'root'}:${data.name.toLowerCase()}`, category);
    return category;
  });
  replace(Category, 'find', async () => [...seeded.values()]);
  replace(Product, 'find', async () => []);

  await initializeCategoryData();
  const firstSeedCount = seeded.size;
  await initializeCategoryData();

  assert.equal(firstSeedCount, 49);
  assert.equal(seeded.size, firstSeedCount);
  assert.deepEqual(
    [...seeded.values()].filter(({ parentId }) => !parentId).map(({ name, sortOrder }) => [name, sortOrder]),
    DEFAULT_CATEGORIES.map(({ name }, sortOrder) => [name, sortOrder])
  );
  assert.equal(migrations.has('seed-default-categories-v1'), true);
  assert.equal(migrations.has('migrate-product-category-ids-v1'), true);
});

test('migrates only unambiguous legacy names and reports ambiguous or unmapped products', async () => {
  const categories = [
    { _id: 'main-attire', name: 'Traditional Attire', parentId: null },
    { _id: 'main-beads', name: 'Beads & Jewelry', parentId: null },
    { _id: 'main-bags', name: 'Bags & Accessories', parentId: null },
    { _id: 'sub-crystal', name: 'Crystal Beads', parentId: 'main-beads' },
    { _id: 'sub-beads-1', name: 'Beaded Bags', parentId: 'main-beads' },
    { _id: 'sub-beads-2', name: 'Beaded Bags', parentId: 'main-bags' }
  ];
  const products = [
    { _id: 'product-main', category: 'Traditional Attire', categories: ['Traditional Attire'] },
    { _id: 'product-sub', category: 'Crystal Beads', categories: ['Crystal Beads'] },
    { _id: 'product-ambiguous', category: 'Beaded Bags', categories: ['Beaded Bags'] },
    { _id: 'product-unmapped', category: 'Legacy Label', categories: ['Legacy Label'] }
  ];
  const migrations = new Set(['seed-default-categories-v1']);
  const updates = [];
  let report = '';
  replace(DatabaseMigration, 'exists', async ({ key }) => migrations.has(key));
  replace(DatabaseMigration, 'create', async ({ key }) => migrations.add(key));
  replace(Category, 'find', async () => categories);
  replace(Product, 'find', async () => products);
  replace(Product, 'updateOne', async (...args) => { updates.push(args); });
  replace(console, 'warn', (...args) => { report = args.join(' '); });

  await initializeCategoryData();

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0][1].$set, { mainCategoryId: 'main-attire', subCategoryId: null });
  assert.deepEqual(updates[1][1].$set, { mainCategoryId: 'main-beads', subCategoryId: 'sub-crystal' });
  assert.match(report, /product-ambiguous/);
  assert.match(report, /product-unmapped/);
  assert.equal(products[0].category, 'Traditional Attire');
  assert.deepEqual(products[1].categories, ['Crystal Beads']);
});
