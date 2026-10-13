const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  purchaseType: { type: String, enum: ['buy', 'rent'], required: true },
  quantity: { type: Number, required: true, min: 1, max: 99 },
  rentalDays: { type: Number, min: 1, max: 365, default: null }
}, { timestamps: true });

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  items: { type: [cartItemSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);
