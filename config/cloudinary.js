const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary using provided credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'ns2sgvez',
  api_key: process.env.CLOUDINARY_API_KEY || '982213867584599',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'HzvNoo5xpwB7iQVs94E4RDOZFXk'
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cashly_plans',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ storage: storage });

module.exports = {
  cloudinary,
  upload
};
