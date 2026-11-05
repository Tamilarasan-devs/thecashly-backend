const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getUserNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notificationController');

router.get('/', protect, getUserNotifications);
router.put('/read-all', protect, markAllAsRead);
router.put('/:id/read', protect, markAsRead);

module.exports = router;

