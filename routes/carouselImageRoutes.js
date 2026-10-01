const express = require('express');
const {
  getCarouselImages,
  getCarouselImagesForAdmin,
  createCarouselImage,
  updateCarouselImage,
  deleteCarouselImage
} = require('../controllers/carouselImageController');
const { protect, adminOnly } = require('../middleware/auth');
const uploadProductImage = require('../middleware/productUpload');

const router = express.Router();

router.get('/', getCarouselImages);
router.get('/manage', protect, adminOnly, getCarouselImagesForAdmin);
router.post('/', protect, adminOnly, uploadProductImage.single('image'), createCarouselImage);
router.put('/:id', protect, adminOnly, uploadProductImage.single('image'), updateCarouselImage);
router.delete('/:id', protect, adminOnly, deleteCarouselImage);

module.exports = router;