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
  .post(protect, adminOnly, uploadProductImage.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'subImages', maxCount: 10 }
  ]), createProduct);

router.route('/:id')
  .get(getProduct)
  .put(protect, adminOnly, uploadProductImage.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'subImages', maxCount: 10 }
  ]), updateProduct)
  .delete(protect, adminOnly, deleteProduct);

module.exports = router;