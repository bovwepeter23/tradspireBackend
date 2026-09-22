const express = require('express');
const router = express.Router();
const {
  getUsers,
  createUser,
  verifyEmail,
  loginUser,
  forgotPassword,
  resetPassword
} = require('../controllers/userController');

// @route   GET /api/users
// @route   POST /api/users
router.route('/')
  .get(getUsers)
  .post(createUser);

// @route   POST /api/users/login
router.post('/login', loginUser);

// @route   POST /api/users/forgot-password
router.post('/forgot-password', forgotPassword);

// @route   POST /api/users/reset-password/:token
router.post('/reset-password/:token', resetPassword);

// @route   GET /api/users/verify/:token
router.get('/verify/:token', verifyEmail);

module.exports = router;