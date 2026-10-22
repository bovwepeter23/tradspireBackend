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
router.post('/rent', protect, createOrder);
router.get('/mine', protect, getMyOrders);
router.get('/admin', protect, adminOnly, getAllOrders);
router.get('/', protect, adminOnly, getAllOrders);
router.patch('/:id/cancel', protect, cancelOrder);
router.put('/:id/cancel', protect, cancelOrder);
router.patch('/:id/status', protect, adminOnly, updateOrderStatus);
router.put('/:id/status', protect, adminOnly, updateOrderStatus);
router.get('/:id', protect, getOrder);

module.exports = router;