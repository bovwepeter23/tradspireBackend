const express = require('express');
const router = express.Router();
const {
  getUsers,
  createUser,
  verifyEmail,
  loginUser
} = require('../controllers/userController');

// @route   GET /api/users
// @route   POST /api/users
router.route('/')
  .get(getUsers)
  .post(createUser);

// @route   POST /api/users/login
router.post('/login', loginUser);

// @route   GET /api/users/verify/:token
router.get('/verify/:token', verifyEmail);

module.exports = router;