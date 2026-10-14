const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { slugify } = require('../services/categorySetup');

const publicCategory = (category) => ({
  _id: category._id,
  id: String(category._id),
  name: category.name,
  slug: category.slug,
  parentId: category.parentId ? String(category.parentId._id || category.parentId) : null,
  sortOrder: category.sortOrder,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt
});

const normalizeParentId = (value) => value == null ? null : String(value);
const duplicateName = (error) => error?.code === 11000;

const findCategoryData = async (name, parentId) => {
  const parent = parentId ? await Category.findById(parentId) : null;
  if (parentId && !parent) return { error: { status: 404, message: 'Parent category not found' } };
  if (parent?.parentId) {
    return { error: { status: 400, message: 'Subcategories cannot have children' } };
  }

  const nameKey = name.trim().toLowerCase();
  return { parent, nameKey };
};

exports.getCategories = async (req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
  return res.json({ success: true, categories: categories.map(publicCategory) });
};

exports.createCategory = async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 80) {
    return res.status(400).json({ message: 'name is required and must be 80 characters or fewer' });
  }
  const parentId = normalizeParentId(req.body.parentId);
  if (parentId && !mongoose.isValidObjectId(parentId)) {
    return res.status(400).json({ message: 'parentId must be a valid category ID or null' });
  }
  const data = await findCategoryData(name, parentId);
  if (data.error) return res.status(data.error.status).json({ message: data.error.message });

  const duplicate = await Category.findOne({ parentId, nameKey: data.nameKey });
  if (duplicate) return res.status(409).json({ message: 'A category with this name already exists under this parent' });

  const sibling = await Category.findOne({ parentId }).sort({ sortOrder: -1 });
  try {
    const category = await Category.create({
      name,
      slug: slugify(name),
      parentId,
      sortOrder: sibling ? sibling.sortOrder + 1 : 0
    });
    return res.status(201).json({
      category: publicCategory(category),
      message: 'Category created'
    });
  } catch (error) {
    if (duplicateName(error)) return res.status(409).json({ message: 'A category with this name already exists under this parent' });
    throw error;
  }
};

exports.updateCategory = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Category not found' });
  }
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found' });

  const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
  const hasParentId = Object.prototype.hasOwnProperty.call(req.body, 'parentId');
  if (!hasName && !hasParentId) {
    return res.status(400).json({ message: 'Provide name and/or parentId to update' });
  }
  const name = hasName ? (typeof req.body.name === 'string' ? req.body.name.trim() : '') : category.name;
  if (!name || name.length > 80) {
    return res.status(400).json({ message: 'name is required and must be 80 characters or fewer' });
  }
  const parentId = hasParentId ? normalizeParentId(req.body.parentId) :
    normalizeParentId(category.parentId);
  if (parentId && !mongoose.isValidObjectId(parentId)) {
    return res.status(400).json({ message: 'parentId must be a valid category ID or null' });
  }
  if (parentId && String(category._id) === parentId) {
    return res.status(400).json({ message: 'A category cannot be its own parent' });
  }
  const data = await findCategoryData(name, parentId);
  if (data.error) return res.status(data.error.status).json({ message: data.error.message });

  if (category.parentId == null && parentId) {
    const hasChildren = await Category.exists({ parentId: category._id });
    if (hasChildren) {
      return res.status(400).json({ message: 'A main category with subcategories cannot become a subcategory' });
    }
  }
  const duplicate = await Category.findOne({
    _id: { $ne: category._id },
    parentId,
    nameKey: data.nameKey
  });
  if (duplicate) return res.status(409).json({ message: 'A category with this name already exists under this parent' });

  const previousParentId = normalizeParentId(category.parentId);
  const parentChanged = previousParentId !== parentId;
  category.name = name;
  category.slug = slugify(name);
  category.parentId = parentId;
  try {
    if (!parentChanged) {
      await category.save();
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await category.save({ session });
          if (!previousParentId && parentId) {
            await Product.updateMany(
              { mainCategoryId: category._id },
              { $set: { mainCategoryId: parentId, subCategoryId: category._id } },
              { session }
            );
          } else if (previousParentId && !parentId) {
            await Product.updateMany(
              { subCategoryId: category._id },
              { $set: { mainCategoryId: category._id, subCategoryId: null } },
              { session }
            );
          } else {
            await Product.updateMany(
              { subCategoryId: category._id },
              { $set: { mainCategoryId: parentId } },
              { session }
            );
          }
        });
      } finally {
        await session.endSession();
      }
    }
  } catch (error) {
    if (duplicateName(error)) return res.status(409).json({ message: 'A category with this name already exists under this parent' });
    throw error;
  }
  return res.json({ category: publicCategory(category), message: 'Category updated' });
};

exports.deleteCategory = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Category not found' });
  }
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found' });

  const [hasChildren, hasProducts] = await Promise.all([
    Category.exists({ parentId: category._id }),
    Product.exists({
      $or: [{ mainCategoryId: category._id }, { subCategoryId: category._id }]
    })
  ]);
  if (hasChildren || hasProducts) {
    return res.status(409).json({
      message: hasChildren ?
        'Category cannot be deleted while it has subcategories' :
        'Category cannot be deleted while products are assigned to it'
    });
  }

  await category.deleteOne();
  return res.json({ category: publicCategory(category), message: 'Category deleted' });
};
