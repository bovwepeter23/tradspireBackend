const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getCart,
  addCartItem,
  updateCartItem,
  deleteCartItem
} = require('../controllers/cartController');

const router = express.Router();

router.use(protect);
router.get('/', getCart);
router.post('/items', addCartItem);
router.patch('/items/:cartItemId', updateCartItem);
router.delete('/items/:cartItemId', deleteCartItem);

module.exports = router;
