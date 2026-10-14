const Category = require('../models/Category');
const DatabaseMigration = require('../models/DatabaseMigration');
const Product = require('../models/Product');

const DEFAULT_CATEGORIES = [
  {
    name: 'Traditional Attire',
    subcategories: [
      "Men's Traditional Wear",
      "Women's Traditional Wear",
      "Children's Traditional Wear",
      'Couple Outfits',
      'Family Matching Sets',
      'Wedding Attire',
      'Engagement Attire',
      'Coronation Attire',
      'Festival Wear',
      'Chieftaincy Regalia',
      'Cultural Dance Costumes'
    ]
  },
  {
    name: '💎 Beads & Jewelry',
    subcategories: [
      'Coral Beads', 'Crystal Beads', 'Waist Beads', 'Necklaces', 'Bracelets',
      'Earrings', 'Anklets', 'Rings', 'Crowns', 'Beaded Walking Sticks',
      'Beaded Bags', 'Beaded Fans'
    ]
  },
  {
    name: '👞 Footwear',
    subcategories: [
      'Traditional Sandals', 'Leather Slippers', 'Loafers', "Women's Heels",
      'Bridal Shoes', "Children's Shoes"
    ]
  },
  {
    name: '👜 Bags & Accessories',
    subcategories: [
      'Clutches', 'Handbags', 'Beaded Bags', 'Wallets', 'Purse',
      'Hand Fans', 'Umbrellas', 'Handkerchiefs'
    ]
  },
  {
    name: '👒 Headwear',
    subcategories: ['Caps', 'Fila', 'Gele', 'Turbans', 'Crowns', 'Headpieces', 'Scarves']
  }
];

const slugify = (name) => name.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-|-$/g, '') || 'category';

const seedDefaultCategories = async () => {
  const migrationKey = 'seed-default-categories-v1';
  if (await DatabaseMigration.exists({ key: migrationKey })) return;

  await Category.init();
  for (const [mainIndex, definition] of DEFAULT_CATEGORIES.entries()) {
    let main = await Category.findOne({ parentId: null, nameKey: definition.name.toLowerCase() });
    if (!main) {
      main = await Category.create({
        name: definition.name,
        slug: slugify(definition.name),
        parentId: null,
        sortOrder: mainIndex
      });
    }

    for (const [subIndex, name] of definition.subcategories.entries()) {
      const exists = await Category.exists({
        parentId: main._id,
        nameKey: name.toLowerCase()
      });
      if (!exists) {
        await Category.create({
          name,
          slug: slugify(name),
          parentId: main._id,
          sortOrder: subIndex
        });
      }
    }
  }

  await DatabaseMigration.create({ key: migrationKey });
};

const migrateLegacyProductCategories = async () => {
  const migrationKey = 'migrate-product-category-ids-v1';
  if (await DatabaseMigration.exists({ key: migrationKey })) return;

  const [categories, products] = await Promise.all([
    Category.find(),
    Product.find({
      $or: [{ mainCategoryId: { $exists: false } }, { mainCategoryId: null }]
    })
  ]);
  const categoriesByName = new Map();
  for (const category of categories) {
    const key = category.name.trim().toLowerCase();
    categoriesByName.set(key, [...(categoriesByName.get(key) || []), category]);
  }

  const parents = new Map(categories.map((category) => [
    String(category._id),
    category.parentId ? String(category.parentId) : null
  ]));
  const ambiguous = [];
  const unmapped = [];
  for (const product of products) {
    const legacyName = String(product.category || product.categories?.[0] || '').trim();
    const matches = categoriesByName.get(legacyName.toLowerCase()) || [];
    if (matches.length !== 1) {
      (matches.length ? ambiguous : unmapped).push({
        productId: String(product._id),
        legacyCategory: legacyName
      });
      continue;
    }

    const match = matches[0];
    const mainCategoryId = parents.get(String(match._id)) || String(match._id);
    await Product.updateOne(
      {
        _id: product._id,
        $or: [{ mainCategoryId: { $exists: false } }, { mainCategoryId: null }]
      },
      {
        $set: {
          mainCategoryId,
          subCategoryId: parents.get(String(match._id)) ? match._id : null
        }
      }
    );
  }

  if (ambiguous.length || unmapped.length) {
    console.warn('Legacy product category migration left products unchanged:', JSON.stringify({
      ambiguous,
      unmapped
    }));
  }
  await DatabaseMigration.create({ key: migrationKey });
};

const initializeCategoryData = async () => {
  await seedDefaultCategories();
  await migrateLegacyProductCategories();
};

module.exports = { DEFAULT_CATEGORIES, initializeCategoryData, slugify };
