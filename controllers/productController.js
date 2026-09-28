const mongoose = require('mongoose');
const Product = require('../models/Product');
const { uploadProductImage, deleteProductImage } = require('../config/cloudinary');

const publicProduct = (product) => ({
  _id: product._id,
  name: product.name,
  category: product.category,
  price: product.price,
  origin: product.origin,
  description: product.description,
  image: product.image,
  imageAlt: product.imageAlt,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt
});

const productFields = (body) => {
  const rawPrice = String(body.price ?? '').trim();
  const price = Number(rawPrice);
  if (!String(body.name || '').trim() || !String(body.category || '').trim() ||
      !String(body.origin || '').trim() || !String(body.description || '').trim() ||
      !rawPrice || !Number.isFinite(price) || price < 0) {
    return { error: 'Name, category, origin, description, and a non-negative price are required' };
  }

  return {
    name: String(body.name).trim(),
    category: String(body.category).trim(),
    price,
    origin: String(body.origin).trim(),
    description: String(body.description).trim(),
    imageAlt: String(body.imageAlt || body.name).trim()
  };
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
  if (!req.file) return res.status(400).json({ message: 'A product image is required' });

  let uploadedImage;
  try {
    uploadedImage = await uploadProductImage(req.file.buffer);
    const product = await Product.create({
      ...fields,
      image: uploadedImage.secure_url,
      imagePublicId: uploadedImage.public_id
    });
    return res.status(201).json({ success: true, product: publicProduct(product) });
  } catch (error) {
    if (uploadedImage?.public_id) {
      await deleteProductImage(uploadedImage.public_id).catch(() => {});
    }
    throw error;
  }
};

exports.updateProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }

  const product = await Product.findById(req.params.id).select('+imagePublicId');
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const fields = productFields(req.body);
  if (fields.error) return res.status(400).json({ message: fields.error });

  const oldImagePublicId = product.imagePublicId;
  let uploadedImage;
  try {
    if (req.file) uploadedImage = await uploadProductImage(req.file.buffer);
    Object.assign(product, fields);
    if (uploadedImage) {
      product.image = uploadedImage.secure_url;
      product.imagePublicId = uploadedImage.public_id;
    }
    await product.save();
  } catch (error) {
    if (uploadedImage?.public_id) {
      await deleteProductImage(uploadedImage.public_id).catch(() => {});
    }
    throw error;
  }

  if (uploadedImage && oldImagePublicId) {
    await deleteProductImage(oldImagePublicId).catch((error) => {
      console.warn('Old Cloudinary product image could not be removed:', error.message);
    });
  }

  return res.json({ success: true, product: publicProduct(product) });
};

exports.deleteProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Product not found' });
  }

  const product = await Product.findById(req.params.id).select('+imagePublicId');
  if (!product) return res.status(404).json({ message: 'Product not found' });

  await deleteProductImage(product.imagePublicId);
  await product.deleteOne();
  return res.json({ success: true, message: 'Product deleted' });
};