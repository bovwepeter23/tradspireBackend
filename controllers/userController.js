const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const sendEmail = require('../config/nodemailer');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'tradspire-secret-key', {
    expiresIn: '7d'
  });
};

const getFrontendRedirectUrl = () => {
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/homepage.html`;
};

const emailVerificationRequired = () => {
  return process.env.ENABLE_EMAIL_VERIFICATION === 'true';
};

// 1. Get all users
// @route   GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Register user & send verification email
// @route   POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role = 'user' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide name, email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedRole = ['user', 'admin'].includes(role) ? role : 'user';

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      name,
      email: normalizedEmail,
      role: normalizedRole,
      password,
      verificationToken,
      verificationTokenExpire: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    if (emailVerificationRequired()) {
      const verifyUrl = `${req.protocol}://${req.get('host')}/api/users/verify/${verificationToken}`;

      const message = `
        <h1>Verify Your Email</h1>
        <p>Please click the link below to verify your account:</p>
        <a href="${verifyUrl}" target="_blank">${verifyUrl}</a>
      `;

      try {
        await sendEmail({
          email: user.email,
          subject: 'Account Email Verification',
          html: message
        });

        return res.status(201).json({
          success: true,
          message: 'Registration successful. Please check your email to verify your account.'
        });
      } catch (emailErr) {
        console.warn('Email verification failed, auto-approving user for local testing:', emailErr.message);
        user.isVerified = true;
        await user.save();

        return res.status(201).json({
          success: true,
          message: 'Registration successful. Email verification could not be sent, so your account was auto-approved for this environment.'
        });
      }
    }

    user.isVerified = true;
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Email verification is disabled in this environment, so your account is ready to log in.',
      redirectUrl: getFrontendRedirectUrl(),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Verify email token
// @route   GET /api/users/verify/:token
exports.verifyEmail = async (req, res) => {
  try {
    const user = await User.findOne({
      verificationToken: req.params.token,
      verificationTokenExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now log in.'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. Authenticate user & login
// @route   POST /api/users/login
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Select password field (since select: false is set in the schema)
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check encrypted password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Ensure email is verified only when verification is explicitly required
    if (!user.isVerified && emailVerificationRequired()) {
      return res.status(403).json({
        message: 'Please verify your email address before logging in.'
      });
    }

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      redirectUrl: getFrontendRedirectUrl(),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};