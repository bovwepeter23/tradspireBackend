const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  category: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  categories: [{
    type: String,
    trim: true,
    maxlength: 80
  }],
  availableFor: {
    type: [{ type: String, enum: ['buy', 'rent'] }],
    default: ['buy'],
    validate: {
      validator: (values) => values.length > 0,
      message: 'Select at least one purchase option'
    }
  },
  price: {
    type: Number,
    required: function () { return this.availableFor.includes('buy'); },
    min: 0
  },
  rentPricePerDay: {
    type: Number,
    required: function () { return this.availableFor.includes('rent'); },
    min: 0
  },
  origin: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  image: {
    type: String,
    required: true
  },
  imageAlt: {
    type: String,
    trim: true,
    maxlength: 180
  },
  imagePublicId: {
    type: String,
    required: true,
    select: false
  },
  subImages: [{
    url: { type: String, required: true },
    alt: { type: String, trim: true, maxlength: 180 },
    publicId: { type: String, select: false }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);