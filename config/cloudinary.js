const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary using provided credentials
cloudinary.config({
  cloud_name: (process.env.CLOUDINARY_CLOUD_NAME || 'kgrlsikf').trim(),
  api_key: (process.env.CLOUDINARY_API_KEY || '847597721488483').trim(),
  api_secret: (process.env.CLOUDINARY_API_SECRET || 'PC7_pdUEay26dUfSlI23g8tCpCk').trim()
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folder = 'cashly_uploads';
    if (file.fieldname === 'image') {
      folder = 'cashly_plans';
    } else if (file.fieldname === 'qrImage' || file.fieldname === 'qrCodeImage') {
      folder = 'cashly_qr';
    }
    return {
      folder: folder,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    };
  },
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = {
  cloudinary,
  upload
};
