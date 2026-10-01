const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const deliveryAddressSchema = new mongoose.Schema({
  recipientName: { type: String, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 30 },
  street: { type: String, trim: true, maxlength: 200 },
  city: { type: String, trim: true, maxlength: 100 },
  region: { type: String, trim: true, maxlength: 100 },
  postalCode: { type: String, trim: true, maxlength: 30 },
  country: { type: String, trim: true, maxlength: 100 },
  instructions: { type: String, trim: true, maxlength: 500 }
}, { _id: false });

// 1. Define what a User looks like in MongoDB
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email'
      ]
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30
    },
    deliveryAddress: {
      type: deliveryAddressSchema,
      default: undefined
    },
    tokenVersion: {
      type: Number,
      default: 0
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // Automatically hides password when querying users
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationToken: {
      type: String
    },
    verificationTokenExpire: {
      type: Date
    },
    resetPasswordToken: {
      type: String,
      select: false
    },
    resetPasswordExpire: {
      type: Date,
      select: false
    },
    passwordResetEmailCount: {
      type: Number,
      default: 0
    },
    passwordResetEmailDay: {
      type: Date
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt automatically
  }
);

// 2. Automatically hash password before saving to the database
userSchema.pre('save', async function () {
  // Only hash if the password was actually created or modified
  if (!this.isModified('password')) {
    return;
  }

  // Generate salt & hash password
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// 3. Helper method to check entered password against stored hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);