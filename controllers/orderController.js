const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const { validateOrderItems } = require('./cartController');

const purchaseOrderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const rentalOrderStatuses = [
  'pending', 'processing', 'shipped', 'delivered', 'return_due',
  'returned', 'inspection', 'completed', 'deposit_refunded', 'cancelled'
];
const cancellationStatuses = ['pending', 'confirmed', 'processing'];
const addressFields = ['recipientName', 'phone', 'street', 'city', 'region', 'postalCode', 'country', 'instructions', 'apartment'];
const rentalTransitions = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['return_due'],
  return_due: ['returned'],
  returned: ['inspection'],
  inspection: ['completed', 'deposit_refunded']
};

const hasRentalItems = (order) => order.items.some((item) => item.purchaseType === 'rent');

const normalizeAddress = (address) => {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null;
  const limits = {
    recipientName: 120,
    phone: 30,
    street: 200,
    city: 100,
    region: 100,
    postalCode: 30,
    country: 100,
    instructions: 500,
    apartment: 50
  };
  const normalized = {};
  const recipientName = address.recipientName ?? address.name ?? '';
  if (typeof recipientName !== 'string' || recipientName.length > limits.recipientName) return null;
  normalized.recipientName = recipientName.trim();

  const instructions = address.instructions ?? address.deliveryInstructions ?? '';
  if (instructions !== '') {
    if (typeof instructions !== 'string' || instructions.length > limits.instructions) return null;
    normalized.instructions = instructions.trim();
  }

  const apartment = address.apartment ?? address.unitNumber ?? '';
  if (apartment !== '') {
    if (typeof apartment !== 'string' || apartment.length > limits.apartment) return null;
    normalized.apartment = apartment.trim();
  }

  for (const field of addressFields.filter((field) => !['recipientName', 'instructions', 'apartment'].includes(field))) {
    const value = address[field] ?? '';
    if (typeof value !== 'string' || value.length > limits[field]) return null;
    normalized[field] = value.trim();
  }
  if (['recipientName', 'phone', 'street', 'city'].some((field) => !normalized[field])) return null;
  return normalized;
};

const canAccessOrder = (order, user) => user.role === 'admin' || order.user.toString() === user._id.toString();
const isUnsupportedTransactionError = (error) =>
  error.code === 20 || error.codeName === 'IllegalOperation' ||
  /transactions are not supported|transaction numbers are only allowed/i.test(error.message);

exports.createOrder = async (req, res) => {
  const { items, deliveryAddress, shippingAddress } = req.body || {};
  const itemsError = validateOrderItems(items);
  if (itemsError) return res.status(400).json({ message: itemsError });

  const address = normalizeAddress(deliveryAddress || shippingAddress || req.user.deliveryAddress);
  if (!address) {
    return res.status(400).json({ message: 'A complete delivery address is required' });
  }

  const requestedItems = new Map();
  for (const item of items) {
    const rentalDays = item.purchaseType === 'rent' ? item.rentalDays : null;
    const productId = new mongoose.Types.ObjectId(item.productId).toString();
    const key = `${productId}:${item.purchaseType}:${rentalDays ?? ''}`;
    requestedItems.set(key, (requestedItems.get(key) || 0) + item.quantity);
  }

  const createFromCart = async (session) => {
    let query = Cart.findOne({ user: req.user._id });
    if (session) query = query.session(session);
    const cart = await query;
    if (!cart || !cart.items.length) {
      return { error: { status: 400, message: 'Your cart is empty' } };
    }

    const cartItems = new Map();
    for (const item of cart.items) {
      const rentalDays = item.purchaseType === 'rent' ? item.rentalDays : null;
      const key = `${item.product}:${item.purchaseType}:${rentalDays ?? ''}`;
      cartItems.set(key, (cartItems.get(key) || 0) + item.quantity);
    }
    if (cartItems.size !== requestedItems.size ||
        [...cartItems].some(([key, quantity]) => requestedItems.get(key) !== quantity)) {
      return { error: { status: 409, message: 'Order items must match your persisted cart' } };
    }

    const orderItems = [];
    for (const cartItem of cart.items) {
      const product = await Product.findById(cartItem.product).session(session || null);
      if (!product) {
        return { error: { status: 404, message: `Product ${cartItem.product} was not found` } };
      }
      const purchaseType = cartItem.purchaseType;
      const availableFor = product.availableFor?.length ? product.availableFor : ['buy'];
      if (!availableFor.includes(purchaseType)) {
        return { error: { status: 400, message: `${product.name} is not available to ${purchaseType}` } };
      }
      const unitPrice = purchaseType === 'rent' ? product.rentPricePerDay : product.price;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return { error: { status: 400, message: `${product.name} has no valid ${purchaseType} price` } };
      }
      const lineTotal = unitPrice * cartItem.quantity * (cartItem.rentalDays || 1);
      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.image,
        purchaseType,
        quantity: cartItem.quantity,
        ...(purchaseType === 'rent' ? { rentalDays: cartItem.rentalDays } : {}),
        unitPrice,
        lineTotal
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const order = new Order({
      user: req.user._id,
      items: orderItems,
      deliveryAddress: address,
      subtotal,
      total: subtotal
    });
    if (session) await order.save({ session });
    else await order.save();
    cart.items = [];
    if (session) await cart.save({ session });
    else await cart.save();
    return { order };
  };

  let session;
  let databaseSession;
  try {
    session = await mongoose.startSession();
    databaseSession = session;
    try {
      session.startTransaction();
    } catch (error) {
      if (!isUnsupportedTransactionError(error)) throw error;
      session = null;
    }
    if (!session) {
      const result = await createFromCart(null);
      if (result.error) return res.status(result.error.status).json({ message: result.error.message });
      return res.status(201).json({ success: true, order: result.order });
    }
    const result = await createFromCart(session);
    if (result.error) {
      await session.abortTransaction();
      return res.status(result.error.status).json({ message: result.error.message });
    }
    await session.commitTransaction();
    return res.status(201).json({ success: true, order: result.order });
  } catch (error) {
    if (!session || !isUnsupportedTransactionError(error)) throw error;
    if (session.inTransaction()) await session.abortTransaction();
    const result = await createFromCart(null);
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    return res.status(201).json({ success: true, order: result.order });
  } finally {
    if (databaseSession) await databaseSession.endSession();
  }
};

exports.getMyOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.json({ success: true, orders });
};

exports.getAllOrders = async (req, res) => {
  const filter = {};
  if (req.query.purchaseType) {
    if (!['buy', 'rent'].includes(req.query.purchaseType)) {
      return res.status(400).json({ message: 'purchaseType must be buy or rent' });
    }
    filter.items = { $elemMatch: { purchaseType: req.query.purchaseType } };
  }
  if (req.query.status) {
    if (![...purchaseOrderStatuses, ...rentalOrderStatuses].includes(req.query.status)) {
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
  order.cancellationReason = String(req.body?.reason || '').trim();
  await order.save();
  return res.json({ success: true, order });
};

exports.updateOrderStatus = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Order not found' });
  const { status } = req.body;
  if (typeof status !== 'string' ||
      ![...purchaseOrderStatuses, ...rentalOrderStatuses].includes(status)) {
    return res.status(400).json({ message: 'Invalid order status' });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  const isRental = hasRentalItems(order);
  if (isRental) {
    if (!rentalOrderStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status for a rental order' });
    }
    if (!rentalTransitions[order.status]?.includes(status)) {
      return res.status(409).json({
        message: `Rental orders cannot transition from ${order.status} to ${status}`
      });
    }
    if (status === 'deposit_refunded' && req.body.refundCompleted !== true) {
      return res.status(400).json({
        message: 'Set refundCompleted to true only after the deposit refund has completed'
      });
    }
    if (status === 'processing' && order.items
      .filter((item) => item.purchaseType === 'rent')
      .some((item) => !Number.isInteger(item.rentalDays) || item.rentalDays < 1)) {
      return res.status(409).json({ message: 'Rental order is missing a valid rental duration' });
    }
  } else {
    if (!purchaseOrderStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status for a purchase order' });
    }
    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ message: 'Delivered or cancelled orders cannot be changed' });
    }
    if (status === 'cancelled' && !cancellationStatuses.includes(order.status)) {
      return res.status(409).json({ message: 'Orders cannot be cancelled after dispatch' });
    }
  }

  order.status = status;
  if (status === 'delivered') order.deliveredAt = new Date();
  if (isRental && order.status === 'processing') {
    const rentalDays = Math.max(...order.items
      .filter((item) => item.purchaseType === 'rent')
      .map((item) => item.rentalDays));
    order.returnDueAt = new Date(Date.now() + rentalDays * 24 * 60 * 60 * 1000);
  }
  if (isRental && status === 'deposit_refunded') order.depositRefundedAt = new Date();
  if (status === 'cancelled') {
    order.cancelledAt = new Date();
    order.cancellationReason = String(req.body.reason || '').trim();
  }
  await order.save();
  return res.json({ success: true, order });
};