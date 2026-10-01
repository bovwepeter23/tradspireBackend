const express = require('express');
const {
  createOrder,
  getMyOrders,
  getAllOrders,
  getOrder,
  cancelOrder,
  updateOrderStatus
} = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.post('/', protect, createOrder);
router.get('/mine', protect, getMyOrders);
router.get('/', protect, adminOnly, getAllOrders);
router.patch('/:id/cancel', protect, cancelOrder);
router.patch('/:id/status', protect, adminOnly, updateOrderStatus);
router.get('/:id', protect, getOrder);

module.exports = router;