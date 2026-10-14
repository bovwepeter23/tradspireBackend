const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { uploadProductImage, deleteProductImage } = require('../config/cloudinary');

const publicProduct = (product, assignedMainCategory, assignedSubCategory) => {
  const mainCategory = product.mainCategoryId?.name ? product.mainCategoryId : assignedMainCategory;
  const subCategory = product.subCategoryId?.name ? product.subCategoryId : assignedSubCategory;
  const mainCategoryId = product.mainCategoryId?._id || product.mainCategoryId || mainCategory?._id;
  const subCategoryId = product.subCategoryId?._id || product.subCategoryId || subCategory?._id;
  return {
    _id: product._id,
    name: product.name,
    category: product.category,
    categories: product.categories?.length ? product.categories : [product.category],
    mainCategoryId: mainCategoryId ? String(mainCategoryId) : null,
    subCategoryId: subCategoryId ? String(subCategoryId) : null,
    mainCategoryName: mainCategory?.name || null,
    subCategoryName: subCategory?.name || null,
    mainCategory: mainCategory?.name ? {
      _id: String(mainCategory._id),
      id: String(mainCategory._id),
      name: mainCategory.name,
      slug: mainCategory.slug
    } : null,
    subCategory: subCategory?.name ? {
      _id: String(subCategory._id),
      id: String(subCategory._id),
      name: subCategory.name,
      slug: subCategory.slug
    } : null,
    availableFor: product.availableFor?.length ? product.availableFor : ['buy'],
    price: product.price,
    rentPricePerDay: product.rentPricePerDay,
    origin: product.origin,
    description: product.description,
    image: product.image,
    imageAlt: product.imageAlt,
    subImages: (product.subImages || []).map(({ url, alt }) => ({ url, alt })),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
};

const parseList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  return value.split(',');
};

const productFields = (body, existingProduct, mainCategory, subCategory) => {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const categories = (has('categories') ? parseList(body.categories) :
    has('category') ? [body.category] :
      existingProduct?.categories?.length ? existingProduct.categories :
        existingProduct?.category ? [existingProduct.category] : [mainCategory.name])
    .map((category) => String(category || '').trim())
    .filter(Boolean);
  const availableFor = (has('availableFor') ? parseList(body.availableFor) : existingProduct?.availableFor || ['buy'])
    .flatMap((option) => String(option).toLowerCase() === 'both' ? ['buy', 'rent'] : [String(option).toLowerCase()]);
  const uniqueOptions = [...new Set(availableFor)];

  if (!categories.length || categories.length > 20 || categories.some((category) => category.length > 80)) {
    return { error: 'Provide between 1 and 20 categories, each 80 characters or fewer' };
  }
  if (!uniqueOptions.length || uniqueOptions.some((option) => !['buy', 'rent'].includes(option))) {
    return { error: 'availableFor must contain buy, rent, or both' };
  }

  const name = String(has('name') ? body.name : existingProduct?.name || '').trim();
  const origin = String(has('origin') ? body.origin : existingProduct?.origin || '').trim();
  const description = String(has('description') ? body.description : existingProduct?.description || '').trim();
  const rawPrice = has('price') ? body.price : existingProduct?.price;
  const rawRentPrice = has('rentPricePerDay') ? body.rentPricePerDay : existingProduct?.rentPricePerDay;
  const price = rawPrice === '' || rawPrice == null ? undefined : Number(rawPrice);
  const rentPricePerDay = rawRentPrice === '' || rawRentPrice == null ? undefined : Number(rawRentPrice);

  if (!name || !origin || !description) {
    return { error: 'Name, origin, and description are required' };
  }
  if (uniqueOptions.includes('buy') && (!Number.isFinite(price) || price < 0)) {
    return { error: 'A non-negative price is required when buy is selected' };
  }
  if (uniqueOptions.includes('rent') && (!Number.isFinite(rentPricePerDay) || rentPricePerDay < 0)) {
    return { error: 'A non-negative rentPricePerDay is required when rent is selected' };
  }

  return {
    name,
    category: categories[0],
    categories,
    mainCategoryId: mainCategory._id,
    subCategoryId: subCategory?._id || null,
    availableFor: uniqueOptions,
    price: uniqueOptions.includes('buy') ? price : undefined,
    rentPricePerDay: uniqueOptions.includes('rent') ? rentPricePerDay : undefined,
    origin,
    description,
    imageAlt: String(has('imageAlt') ? body.imageAlt : existingProduct?.imageAlt || name).trim()
  };
};

const getCategoryAssignment = async (body, existingProduct) => {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const mainCategoryId = has('mainCategoryId') ? String(body.mainCategoryId || '').trim() :
    String(existingProduct?.mainCategoryId?._id || existingProduct?.mainCategoryId || '').trim();
  const rawSubCategoryId = has('subCategoryId') ? body.subCategoryId :
    existingProduct?.subCategoryId?._id || existingProduct?.subCategoryId;
  const subCategoryId = rawSubCategoryId == null || rawSubCategoryId === '' ?
    '' : String(rawSubCategoryId).trim();

  if (!mainCategoryId || !mongoose.isValidObjectId(mainCategoryId)) {
    return { error: 'A valid mainCategoryId is required' };
  }
  if (subCategoryId && !mongoose.isValidObjectId(subCategoryId)) {
    return { error: 'subCategoryId must be a valid category ID or null' };
  }

  const mainCategory = await Category.findById(mainCategoryId);
  if (!mainCategory) return { error: 'Main category not found', status: 404 };
  if (mainCategory.parentId) return { error: 'mainCategoryId must refer to a main category' };

  const subCategory = subCategoryId ? await Category.findById(subCategoryId) : null;
  if (subCategoryId && !subCategory) return { error: 'Subcategory not found', status: 404 };
  if (subCategory && String(subCategory.parentId) !== String(mainCategory._id)) {
    return { error: 'subCategoryId must belong to the selected mainCategoryId' };
  }
  return { mainCategory, subCategory };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const requestImages = (req) => {
  const files = req.files || {};
  if (files.mainImage?.length && files.image?.length) {
    return { error: 'Upload either mainImage or the legacy image field, not both' };
  }
  return {
    mainImage: files.mainImage?.[0] || files.image?.[0],
    subImages: files.subImages || []
  };
};

const removeUploadedImages = async (images) => {
  await Promise.all(images.filter(Boolean).map((image) => deleteProductImage(image.public_id).catch(() => {})));
};

exports.getProducts = async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
  const requestedPage = Number.parseInt(req.query.page, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const filter = {};
  let mainCategory;
  let subCategory;

  if (req.query.mainCategoryId) {
    if (!mongoose.isValidObjectId(req.query.mainCategoryId)) {
      return res.status(400).json({ message: 'mainCategoryId must be a valid category ID' });
    }
    mainCategory = await Category.findById(req.query.mainCategoryId);
    if (!mainCategory) return res.status(404).json({ message: 'Main category not found' });
    if (mainCategory.parentId) return res.status(400).json({ message: 'mainCategoryId must refer to a main category' });
    filter.mainCategoryId = mainCategory._id;
  }
  if (req.query.subCategoryId) {
    if (!mongoose.isValidObjectId(req.query.subCategoryId)) {
      return res.status(400).json({ message: 'subCategoryId must be a valid category ID' });
    }
    subCategory = await Category.findById(req.query.subCategoryId);
    if (!subCategory) return res.status(404).json({ message: 'Subcategory not found' });
    if (!subCategory.parentId) return res.status(400).json({ message: 'subCategoryId must refer to a subcategory' });
    if (mainCategory && String(subCategory.parentId) !== String(mainCategory._id)) {
      return res.status(400).json({ message: 'subCategoryId must belong to mainCategoryId' });
    }
    filter.subCategoryId = subCategory._id;
  }
  if (req.query.search && String(req.query.search).trim()) {
    const search = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
    const matchingCategories = await Category.find({ name: search });
    const mainCategoryIds = matchingCategories.filter((category) => !category.parentId).map(({ _id }) => _id);
    const subCategoryIds = matchingCategories.filter((category) => category.parentId).map(({ _id }) => _id);
    filter.$and = [
      ...(filter.$and || []),
      { $or: [
        { name: search },
        ...(mainCategoryIds.length ? [{ mainCategoryId: { $in: mainCategoryIds } }] : []),
        ...(subCategoryIds.length ? [{ subCategoryId: { $in: subCategoryIds } }] : [])
      ] }
    ];
  }

  let productsQuery = Product.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('mainCategoryId', 'name slug')
    .populate('subCategoryId', 'name slug');
  const [products, total] = await Promise.all([
    productsQuery,
    Product.countDocuments(filter)
  ]);
  return res.json({
    success: true,
    products: products.map(publicProduct),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
};

exports.getProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }
  const product = await Product.findById(req.params.id)
    .populate('mainCategoryId', 'name slug')
    .populate('subCategoryId', 'name slug');
  if (!product) return res.status(404).json({ message: 'Product not found' });
  return res.json({ success: true, product: publicProduct(product) });
};

exports.createProduct = async (req, res) => {
  const assignment = await getCategoryAssignment(req.body);
  if (assignment.error) return res.status(assignment.status || 400).json({ message: assignment.error });
  const fields = productFields(req.body, undefined, assignment.mainCategory, assignment.subCategory);
  if (fields.error) return res.status(400).json({ message: fields.error });
  const images = requestImages(req);
  if (images.error) return res.status(400).json({ message: images.error });
  if (!images.mainImage) return res.status(400).json({ message: 'A mainImage file is required' });

  let uploadedImages = [];
  try {
    uploadedImages = await Promise.all([images.mainImage, ...images.subImages].map((file) => uploadProductImage(file.buffer)));
    const [mainImage, ...subImages] = uploadedImages;
    const product = await Product.create({
      ...fields,
      image: mainImage.secure_url,
      imagePublicId: mainImage.public_id,
      subImages: subImages.map((image, index) => ({
        url: image.secure_url,
        publicId: image.public_id,
        alt: `${fields.name} image ${index + 1}`
      }))
    });
    product.mainCategoryId = assignment.mainCategory;
    product.subCategoryId = assignment.subCategory;
    return res.status(201).json({
      success: true,
      product: publicProduct(product, assignment.mainCategory, assignment.subCategory)
    });
  } catch (error) {
    await removeUploadedImages(uploadedImages);
    throw error;
  }
};

exports.updateProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }

  const product = await Product.findById(req.params.id).select('+imagePublicId +subImages.publicId');
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const assignment = await getCategoryAssignment(req.body, product);
  if (assignment.error) return res.status(assignment.status || 400).json({ message: assignment.error });
  const fields = productFields(req.body, product, assignment.mainCategory, assignment.subCategory);
  if (fields.error) return res.status(400).json({ message: fields.error });

  const images = requestImages(req);
  if (images.error) return res.status(400).json({ message: images.error });
  const oldImagePublicId = product.imagePublicId;
  const oldSubImages = product.subImages || [];
  let uploadedImages = [];
  const replaceSubImages = images.subImages.length > 0 || req.body.clearSubImages === 'true';
  try {
    if (images.mainImage || replaceSubImages && images.subImages.length) {
      const filesToUpload = [...(images.mainImage ? [images.mainImage] : []), ...images.subImages];
      uploadedImages = await Promise.all(filesToUpload.map((file) => uploadProductImage(file.buffer)));
    }
    Object.assign(product, fields);
    let uploadedIndex = 0;
    if (images.mainImage) {
      const mainImage = uploadedImages[uploadedIndex++];
      product.image = mainImage.secure_url;
      product.imagePublicId = mainImage.public_id;
    }
    if (replaceSubImages) {
      product.subImages = uploadedImages.slice(uploadedIndex).map((image, index) => ({
        url: image.secure_url,
        publicId: image.public_id,
        alt: `${fields.name} image ${index + 1}`
      }));
    }
    await product.save();
  } catch (error) {
    await removeUploadedImages(uploadedImages);
    throw error;
  }

  product.mainCategoryId = assignment.mainCategory;
  product.subCategoryId = assignment.subCategory;

  const oldImagesToDelete = [
    ...(images.mainImage && oldImagePublicId ? [oldImagePublicId] : []),
    ...(replaceSubImages ? oldSubImages.map((image) => image.publicId).filter(Boolean) : [])
  ];
  for (const publicId of oldImagesToDelete) {
    await deleteProductImage(publicId).catch((error) => {
      console.warn('Old Cloudinary product image could not be removed:', error.message);
    });
  }

  return res.json({
    success: true,
    product: publicProduct(product, assignment.mainCategory, assignment.subCategory)
  });
};

exports.deleteProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }

  const product = await Product.findById(req.params.id).select('+imagePublicId +subImages.publicId');
  if (!product) return res.status(404).json({ message: 'Product not found' });

  await removeUploadedImages([
    { public_id: product.imagePublicId },
    ...(product.subImages || []).map((image) => ({ public_id: image.publicId }))
  ]);
  await product.deleteOne();
  return res.json({ success: true, message: 'Product deleted' });
};