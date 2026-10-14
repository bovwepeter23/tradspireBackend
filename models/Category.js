const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  nameKey: {
    type: String,
    required: true,
    select: false
  },
  slug: {
    type: String,
    required: true,
    trim: true
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

categorySchema.pre('validate', function () {
  if (typeof this.name === 'string') this.nameKey = this.name.trim().toLowerCase();
});

categorySchema.index({ parentId: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
