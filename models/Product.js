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
  price: {
    type: Number,
    required: true,
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
  }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);