const express = require('express');
const router = express.Router();
const {
  getUsers,
  getMyProfile,
  updateMyProfile,
  updateDeliveryAddress,
  changePassword,
  createUser,
  verifyEmail,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword
} = require('../controllers/userController');
const { protect, adminOnly } = require('../middleware/auth');

// @route   GET /api/users
// @route   POST /api/users
router.route('/')
  .get(protect, adminOnly, getUsers)
  .post(createUser);

router.route('/me')
  .get(protect, getMyProfile)
  .patch(protect, updateMyProfile);

router.patch('/me/delivery-address', protect, updateDeliveryAddress);
router.patch('/me/password', protect, changePassword);

// @route   POST /api/users/login
router.post('/login', loginUser);

// @route   POST /api/users/logout
router.post('/logout', protect, logoutUser);

// @route   POST /api/users/forgot-password
router.post('/forgot-password', forgotPassword);

// @route   POST /api/users/reset-password/:token
router.post('/reset-password/:token', resetPassword);

// @route   GET /api/users/verify/:token
router.get('/verify/:token', verifyEmail);

module.exports = router;