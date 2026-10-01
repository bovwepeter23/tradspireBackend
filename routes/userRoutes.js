const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const {
  getUsers,
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
<<<<<<< HEAD
  .get(protect, adminOnly, getUsers)
=======
  .get(authenticate, getUsers)
>>>>>>> 1fe7c74 (fixing the issue with the user authentication and adding token revocation functionality.)
  .post(createUser);

// @route   POST /api/users/login
router.post('/login', loginUser);

// @route   POST /api/users/logout
<<<<<<< HEAD
router.post('/logout', protect, logoutUser);
=======
router.post('/logout', authenticate, logoutUser);
>>>>>>> 1fe7c74 (fixing the issue with the user authentication and adding token revocation functionality.)

// @route   POST /api/users/forgot-password
router.post('/forgot-password', forgotPassword);

// @route   POST /api/users/reset-password/:token
router.post('/reset-password/:token', resetPassword);

// @route   GET /api/users/verify/:token
router.get('/verify/:token', verifyEmail);

module.exports = router;