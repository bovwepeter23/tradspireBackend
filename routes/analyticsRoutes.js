const express = require('express');
const { getAdminAnalytics } = require('../controllers/analyticsController');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/admin', protect, adminOnly, getAdminAnalytics);

module.exports = router;