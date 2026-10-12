const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },
  familyId: {
    type: String,
    required: true,
    index: true
  },
  tokenVersion: {
    type: Number,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  familyExpiresAt: {
    type: Date,
    required: true,
    expires: 0
  },
  revokedAt: {
    type: Date,
    default: null
  },
  replacedByHash: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);