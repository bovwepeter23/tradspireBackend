const mongoose = require('mongoose');

const deliveryAddressSchema = new mongoose.Schema({
  recipientName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  street: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  region: { type: String, trim: true, default: '' },
  postalCode: { type: String, trim: true, default: '' },
  country: { type: String, required: true, trim: true },
  instructions: { type: String, trim: true, default: '' }
}, { _id: false });

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  image: { type: String, required: true },
  purchaseType: { type: String, enum: ['buy', 'rent'], required: true },
  quantity: { type: Number, required: true, min: 1 },
  rentalDays: { type: Number, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: {
    type: [orderItemSchema],
    required: true,
    validate: { validator: (items) => items.length > 0, message: 'An order must contain at least one item' }
  },
  deliveryAddress: { type: deliveryAddressSchema, required: true },
  subtotal: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
    index: true
  },
  cancelledAt: Date,
  deliveredAt: Date,
  cancellationReason: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

orderSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);