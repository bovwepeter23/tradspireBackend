const multer = require('multer');

const uploadProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      const error = new Error('Please upload an image file');
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  }
});

module.exports = uploadProductImage;