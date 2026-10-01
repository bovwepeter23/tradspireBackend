const mongoose = require('mongoose');

const carouselImageSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  image: {
    type: String,
    required: true
  },
  imageAlt: {
    type: String,
    trim: true,
    maxlength: 180,
    default: ''
  },
  imagePublicId: {
    type: String,
    required: true,
    select: false
  },
  linkUrl: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('CarouselImage', carouselImageSchema);