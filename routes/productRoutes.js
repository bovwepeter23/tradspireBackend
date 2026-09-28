const express = require('express');
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/auth');
const uploadProductImage = require('../middleware/productUpload');

const router = express.Router();

router.route('/')
  .get(getProducts)
  .post(protect, adminOnly, uploadProductImage.single('image'), createProduct);

router.route('/:id')
  .get(getProduct)
  .put(protect, adminOnly, uploadProductImage.single('image'), updateProduct)
  .delete(protect, adminOnly, deleteProduct);

module.exports = router;