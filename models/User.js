const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt automatically
  }
);

// 2. Automatically hash password before saving to the database
userSchema.pre('save', async function (next) {
  // Only hash if the password was actually created or modified
  if (!this.isModified('password')) {
    return next();
  }

  // Generate salt & hash password
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 3. Helper method to check entered password against stored hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);