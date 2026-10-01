const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');

const orderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const terminalStatuses = ['delivered', 'cancelled'];
const cancellationStatuses = ['pending', 'confirmed', 'processing'];
const addressFields = ['recipientName', 'phone', 'street', 'city', 'region', 'postalCode', 'country', 'instructions'];

const normalizeAddress = (address) => {
  if (!address || typeof address !== 'object') return null;
  const normalized = {};
  for (const field of addressFields) normalized[field] = String(address[field] || '').trim();
  if (['recipientName', 'phone', 'street', 'city', 'country'].some((field) => !normalized[field])) return null;
  return normalized;
};

const canAccessOrder = (order, user) => user.role === 'admin' || order.user.toString() === user._id.toString();

exports.createOrder = async (req, res) => {
  const { items, deliveryAddress, shippingAddress } = req.body;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return res.status(400).json({ message: 'An order must contain between 1 and 50 items' });
  }

  const address = normalizeAddress(deliveryAddress || shippingAddress || req.user.deliveryAddress);
  if (!address) {
    return res.status(400).json({ message: 'A complete delivery address is required' });
  }

  const orderItems = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return res.status(400).json({ message: 'Each order item must be an object' });
    }
    if (!mongoose.isValidObjectId(item.productId)) {
      return res.status(400).json({ message: 'Each item must include a valid productId' });
    }
    const quantity = Number(item.quantity);
    const purchaseType = item.purchaseType || 'buy';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !['buy', 'rent'].includes(purchaseType)) {
      return res.status(400).json({ message: 'Each item needs a valid quantity and purchaseType' });
    }

    const product = await Product.findById(item.productId);
    if (!product) return res.status(404).json({ message: `Product ${item.productId} was not found` });
    const availableFor = product.availableFor?.length ? product.availableFor : ['buy'];
    if (!availableFor.includes(purchaseType)) {
      return res.status(400).json({ message: `${product.name} is not available to ${purchaseType}` });
    }

    const rentalDays = purchaseType === 'rent' ? Number(item.rentalDays) : undefined;
    if (purchaseType === 'rent' && (!Number.isInteger(rentalDays) || rentalDays < 1 || rentalDays > 365)) {
      return res.status(400).json({ message: 'Rental items require rentalDays between 1 and 365' });
    }

    const unitPrice = purchaseType === 'rent' ? product.rentPricePerDay : product.price;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ message: `${product.name} has no valid ${purchaseType} price` });
    }
    const lineTotal = unitPrice * quantity * (rentalDays || 1);
    orderItems.push({
      product: product._id,
      name: product.name,
      image: product.image,
      purchaseType,
      quantity,
      ...(rentalDays ? { rentalDays } : {}),
      unitPrice,
      lineTotal
    });
  }

  const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    deliveryAddress: address,
    subtotal,
    total: subtotal
  });
  return res.status(201).json({ success: true, order });
};

exports.getMyOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.json({ success: true, orders });
};

exports.getAllOrders = async (req, res) => {
  const filter = {};
  if (req.query.status) {
    if (!orderStatuses.includes(req.query.status)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }
    filter.status = req.query.status;
  }
  const orders = await Order.find(filter).sort({ createdAt: -1 });
  return res.json({ success: true, orders });
};

exports.getOrder = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order || !canAccessOrder(order, req.user)) return res.status(404).json({ message: 'Order not found' });
  return res.json({ success: true, order });
};

exports.cancelOrder = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Order not found' });
  const order = await Order.findById(req.params.id);
  if (!order || order.user.toString() !== req.user._id.toString()) {
    return res.status(404).json({ message: 'Order not found' });
  }
  if (!cancellationStatuses.includes(order.status)) {
    return res.status(409).json({ message: 'This order can no longer be cancelled' });
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = String(req.body.reason || '').trim();
  await order.save();
  return res.json({ success: true, order });
};

exports.updateOrderStatus = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Order not found' });
  const { status } = req.body;
  if (!orderStatuses.includes(status)) return res.status(400).json({ message: 'Invalid order status' });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (terminalStatuses.includes(order.status)) {
    return res.status(409).json({ message: 'Delivered or cancelled orders cannot be changed' });
  }

  order.status = status;
  if (status === 'delivered') order.deliveredAt = new Date();
  if (status === 'cancelled') {
    order.cancelledAt = new Date();
    order.cancellationReason = String(req.body.reason || '').trim();
  }
  await order.save();
  return res.json({ success: true, order });
};