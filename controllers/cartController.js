const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

const invalidItemMessage = 'Each item needs a valid productId, quantity, and purchaseType';

const validateItem = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      !mongoose.isValidObjectId(item.productId) ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
      !['buy', 'rent'].includes(item.purchaseType)) {
    return invalidItemMessage;
  }
  if (item.purchaseType === 'rent' &&
      (!Number.isInteger(item.rentalDays) || item.rentalDays < 1 || item.rentalDays > 365)) {
    return 'Rental items require rentalDays between 1 and 365';
  }
  return null;
};

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (cart) return cart;
  try {
    return await Cart.create({ user: userId, items: [] });
  } catch (error) {
    if (error.code !== 11000) throw error;
    cart = await Cart.findOne({ user: userId });
    if (!cart) throw error;
    return cart;
  }
};

const cartResponse = async (cart) => {
  const products = await Product.find({
    _id: { $in: cart.items.map((item) => item.product) }
  });
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  const items = cart.items.flatMap((item) => {
    const product = productById.get(item.product.toString());
    if (!product) return [];
    return [{
      _id: item._id,
      productId: { _id: product._id, name: product.name, image: product.image },
      name: product.name,
      image: product.image,
      price: item.purchaseType === 'rent' ? product.rentPricePerDay : product.price,
      quantity: item.quantity,
      purchaseType: item.purchaseType,
      rentalDays: item.purchaseType === 'rent' ? item.rentalDays : null
    }];
  });
  return { cart: { items } };
};

const findAvailableProduct = async (productId, purchaseType, res) => {
  const product = await Product.findById(productId);
  if (!product) {
    res.status(404).json({ message: `Product ${productId} was not found` });
    return null;
  }
  const availableFor = product.availableFor?.length ? product.availableFor : ['buy'];
  if (!availableFor.includes(purchaseType)) {
    res.status(400).json({ message: `${product.name} is not available to ${purchaseType}` });
    return null;
  }
  const price = purchaseType === 'rent' ? product.rentPricePerDay : product.price;
  if (!Number.isFinite(price) || price < 0) {
    res.status(400).json({ message: `${product.name} has no valid ${purchaseType} price` });
    return null;
  }
  return product;
};

exports.getCart = async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  return res.json(await cartResponse(cart));
};

exports.addCartItem = async (req, res) => {
  const error = validateItem(req.body);
  if (error) return res.status(400).json({ message: error });

  const { productId, quantity, purchaseType } = req.body;
  const rentalDays = purchaseType === 'rent' ? req.body.rentalDays : null;
  const product = await findAvailableProduct(productId, purchaseType, res);
  if (!product) return undefined;

  const cart = await getOrCreateCart(req.user._id);
  const existingItem = cart.items.find((item) =>
    item.product.toString() === product._id.toString() &&
    item.purchaseType === purchaseType &&
    (purchaseType === 'buy' || item.rentalDays === rentalDays)
  );
  if (existingItem) {
    if (existingItem.quantity + quantity > 99) {
      return res.status(400).json({ message: 'A cart item cannot exceed a quantity of 99' });
    }
    existingItem.quantity += quantity;
  } else {
    cart.items.push({ product: product._id, quantity, purchaseType, rentalDays });
  }
  await cart.save();
  return res.json(await cartResponse(cart));
};

exports.updateCartItem = async (req, res) => {
  const quantity = req.body?.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return res.status(400).json({ message: 'Quantity must be an integer between 1 and 99' });
  }
  if (!mongoose.isValidObjectId(req.params.cartItemId)) {
    return res.status(404).json({ message: 'Cart item not found' });
  }
  const cart = await Cart.findOne({ user: req.user._id });
  const item = cart?.items.id(req.params.cartItemId);
  if (!item) return res.status(404).json({ message: 'Cart item not found' });

  item.quantity = quantity;
  await cart.save();
  return res.json(await cartResponse(cart));
};

exports.deleteCartItem = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.cartItemId)) {
    return res.status(404).json({ message: 'Cart item not found' });
  }
  const cart = await Cart.findOne({ user: req.user._id });
  const item = cart?.items.id(req.params.cartItemId);
  if (!item) return res.status(404).json({ message: 'Cart item not found' });

  cart.items.pull(item._id);
  await cart.save();
  return res.json(await cartResponse(cart));
};

exports.validateOrderItems = (items) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return 'An order must contain between 1 and 50 items';
  }
  for (const item of items) {
    const error = validateItem(item);
    if (error) return error;
  }
  return null;
};

exports.cartResponse = cartResponse;
exports.getOrCreateCart = getOrCreateCart;
exports.findAvailableProduct = findAvailableProduct;
