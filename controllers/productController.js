const mongoose = require('mongoose');
const Product = require('../models/Product');
const { uploadProductImage, deleteProductImage } = require('../config/cloudinary');

const publicProduct = (product) => ({
  _id: product._id,
  name: product.name,
  category: product.category,
  categories: product.categories?.length ? product.categories : [product.category],
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
});

const parseList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  return value.split(',');
};

const productFields = (body, existingProduct) => {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const categories = (has('categories') ? parseList(body.categories) :
    has('category') ? [body.category] : existingProduct?.categories?.length ? existingProduct.categories : [existingProduct?.category])
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
    availableFor: uniqueOptions,
    price: uniqueOptions.includes('buy') ? price : undefined,
    rentPricePerDay: uniqueOptions.includes('rent') ? rentPricePerDay : undefined,
    origin,
    description,
    imageAlt: String(has('imageAlt') ? body.imageAlt : existingProduct?.imageAlt || name).trim()
  };
};

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
  const products = await Product.find().sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, products: products.map(publicProduct) });
};

exports.getProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  return res.json({ success: true, product: publicProduct(product) });
};

exports.createProduct = async (req, res) => {
  const fields = productFields(req.body);
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
    return res.status(201).json({ success: true, product: publicProduct(product) });
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

  const fields = productFields(req.body, product);
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

  const oldImagesToDelete = [
    ...(images.mainImage && oldImagePublicId ? [oldImagePublicId] : []),
    ...(replaceSubImages ? oldSubImages.map((image) => image.publicId).filter(Boolean) : [])
  ];
  for (const publicId of oldImagesToDelete) {
    await deleteProductImage(publicId).catch((error) => {
      console.warn('Old Cloudinary product image could not be removed:', error.message);
    });
  }

  return res.json({ success: true, product: publicProduct(product) });
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