const mongoose = require('mongoose');
const CarouselImage = require('../models/CarouselImage');
const { uploadProductImage, deleteProductImage } = require('../config/cloudinary');

const publicCarouselImage = (image) => ({
  _id: image._id,
  title: image.title,
  description: image.description,
  image: image.image,
  imageAlt: image.imageAlt,
  linkUrl: image.linkUrl,
  sortOrder: image.sortOrder,
  isActive: image.isActive,
  createdAt: image.createdAt,
  updatedAt: image.updatedAt
});

const carouselFields = (body, existingImage) => {
  const fields = {};
  for (const key of ['title', 'description', 'imageAlt', 'linkUrl']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) fields[key] = String(body[key] || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) return { error: 'sortOrder must be an integer' };
    fields.sortOrder = sortOrder;
  } else if (!existingImage) {
    fields.sortOrder = 0;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    if (body.isActive === true || body.isActive === 'true') fields.isActive = true;
    else if (body.isActive === false || body.isActive === 'false') fields.isActive = false;
    else return { error: 'isActive must be true or false' };
  } else if (!existingImage) {
    fields.isActive = true;
  }

  return fields;
};

exports.getCarouselImages = async (req, res) => {
  const images = await CarouselImage.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
  return res.json({ success: true, images: images.map(publicCarouselImage) });
};

exports.getCarouselImagesForAdmin = async (req, res) => {
  const images = await CarouselImage.find().sort({ sortOrder: 1, createdAt: -1 });
  return res.json({ success: true, images: images.map(publicCarouselImage) });
};

exports.createCarouselImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'An image file is required' });
  const fields = carouselFields(req.body);
  if (fields.error) return res.status(400).json({ message: fields.error });

  let uploadedImage;
  try {
    uploadedImage = await uploadProductImage(req.file.buffer);
    const image = await CarouselImage.create({
      ...fields,
      image: uploadedImage.secure_url,
      imagePublicId: uploadedImage.public_id
    });
    return res.status(201).json({ success: true, image: publicCarouselImage(image) });
  } catch (error) {
    if (uploadedImage?.public_id) await deleteProductImage(uploadedImage.public_id).catch(() => {});
    throw error;
  }
};

exports.updateCarouselImage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Carousel image not found' });
  }
  const image = await CarouselImage.findById(req.params.id).select('+imagePublicId');
  if (!image) return res.status(404).json({ message: 'Carousel image not found' });

  const fields = carouselFields(req.body, image);
  if (fields.error) return res.status(400).json({ message: fields.error });

  const oldPublicId = image.imagePublicId;
  let uploadedImage;
  try {
    if (req.file) uploadedImage = await uploadProductImage(req.file.buffer);
    Object.assign(image, fields);
    if (uploadedImage) {
      image.image = uploadedImage.secure_url;
      image.imagePublicId = uploadedImage.public_id;
    }
    await image.save();
  } catch (error) {
    if (uploadedImage?.public_id) await deleteProductImage(uploadedImage.public_id).catch(() => {});
    throw error;
  }

  if (uploadedImage && oldPublicId) await deleteProductImage(oldPublicId).catch(() => {});
  return res.json({ success: true, image: publicCarouselImage(image) });
};

exports.deleteCarouselImage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Carousel image not found' });
  }
  const image = await CarouselImage.findById(req.params.id).select('+imagePublicId');
  if (!image) return res.status(404).json({ message: 'Carousel image not found' });

  await image.deleteOne();
  if (image.imagePublicId) await deleteProductImage(image.imagePublicId).catch(() => {});
  return res.json({ success: true, message: 'Carousel image deleted' });
};