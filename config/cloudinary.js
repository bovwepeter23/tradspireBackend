const cloudinary = require('cloudinary').v2;

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const error = new Error('Cloudinary credentials are not configured');
    error.status = 503;
    throw error;
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });

  return cloudinary;
};

const uploadProductImage = (buffer) => new Promise((resolve, reject) => {
  const client = configureCloudinary();
  const stream = client.uploader.upload_stream(
    { folder: 'tradspire/products', resource_type: 'image' },
    (error, result) => error ? reject(error) : resolve(result)
  );
  stream.end(buffer);
});

const deleteProductImage = async (publicId) => {
  const client = configureCloudinary();
  return client.uploader.destroy(publicId, { resource_type: 'image' });
};

module.exports = { uploadProductImage, deleteProductImage };