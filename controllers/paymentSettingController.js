const { PaymentSetting } = require('../models');
const { ApiError } = require('../middleware/errorHandler');

// Helper to get or create default payment setting and ensure channels migration
const getOrCreateDefaultSetting = async () => {
  let setting = await PaymentSetting.findOne().sort('-updatedAt');
  if (!setting) {
    setting = await PaymentSetting.create({
      upiId: 'cashly@upi',
      upiName: 'The Cashly Payments',
      qrCodeImage: '',
      channels: [
        {
          title: 'Primary UPI QR',
          upiId: 'cashly@upi',
          upiName: 'The Cashly Payments',
          qrCodeImage: '',
          isActive: true,
          isPrimary: true
        }
      ],
      instructions: '1. Scan the QR code or copy the UPI ID.\n2. Complete the payment in any UPI App (GPay, PhonePe, Paytm).\n3. Enter the 12-digit UTR / Reference number below to verify your deposit.',
      isActive: true,
      minDeposit: 10000,
      maxDeposit: 10000000
    });
  } else {
    // Migration: If no channels exist yet, migrate existing top-level fields to first channel
    let modified = false;
    if (!setting.channels || setting.channels.length === 0) {
      setting.channels = [
        {
          title: 'Primary UPI QR',
          upiId: setting.upiId || 'cashly@upi',
          upiName: setting.upiName || 'The Cashly Payments',
          qrCodeImage: setting.qrCodeImage || '',
          isActive: true,
          isPrimary: true
        }
      ];
      modified = true;
    }

    // Ensure at least one channel is marked primary
    const hasPrimary = setting.channels.some(c => c.isPrimary);
    if (!hasPrimary && setting.channels.length > 0) {
      setting.channels[0].isPrimary = true;
      modified = true;
    }

    // Sync top-level fields with primary channel
    const primary = setting.channels.find(c => c.isPrimary) || setting.channels[0];
    if (primary) {
      if (setting.upiId !== primary.upiId || setting.upiName !== primary.upiName || setting.qrCodeImage !== primary.qrCodeImage) {
        setting.upiId = primary.upiId;
        setting.upiName = primary.upiName;
        setting.qrCodeImage = primary.qrCodeImage;
        modified = true;
      }
    }

    if (modified) {
      await setting.save();
    }
  }
  return setting;
};

// @desc    Get active payment setting (Customer Facing - Shuffled & Equal Distribution)
// @route   GET /api/payment-settings
// @access  Public / Private
const getActivePaymentSetting = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const activeChannels = (setting.channels || []).filter(c => c.isActive);

    let assigned = null;
    let hasMultipleChannels = false;

    if (activeChannels.length > 1) {
      hasMultipleChannels = true;
      // Equal round-robin rotation & shuffle across users
      const currentIndex = (setting.rotationCounter || 0) % activeChannels.length;
      assigned = activeChannels[currentIndex];

      // Increment rotation counter and track usageCount for equal usage
      setting.rotationCounter = ((setting.rotationCounter || 0) + 1) % 1000000;
      const chDoc = setting.channels.id(assigned._id);
      if (chDoc) {
        chDoc.usageCount = (chDoc.usageCount || 0) + 1;
      }
      await setting.save();
    } else if (activeChannels.length === 1) {
      assigned = activeChannels[0];
    } else {
      assigned = {
        title: 'UPI QR',
        upiId: setting.upiId || 'cashly@upi',
        upiName: setting.upiName || 'The Cashly Payments',
        qrCodeImage: setting.qrCodeImage || ''
      };
    }

    res.json({
      success: true,
      data: {
        upiId: assigned.upiId,
        upiName: assigned.upiName,
        qrCodeImage: assigned.qrCodeImage,
        channelTitle: assigned.title || 'UPI QR',
        channelId: assigned._id,
        hasMultipleChannels,
        instructions: setting.instructions,
        isActive: setting.isActive,
        minDeposit: setting.minDeposit,
        maxDeposit: setting.maxDeposit
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payment settings (Admin)
// @route   GET /api/payment-settings/admin (or /api/admin/payment-settings)
// @access  Private/Admin
const getAdminPaymentSetting = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    res.json({
      success: true,
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update global payment settings (Admin)
// @route   PUT /api/payment-settings/admin
// @access  Private/Admin
const updatePaymentSetting = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { instructions, isActive, minDeposit, maxDeposit, upiId, upiName, qrCodeImage } = req.body;

    if (instructions !== undefined) setting.instructions = instructions;
    if (isActive !== undefined) setting.isActive = Boolean(isActive === 'true' || isActive === true);
    if (minDeposit !== undefined) setting.minDeposit = Number(minDeposit);
    if (maxDeposit !== undefined) setting.maxDeposit = Number(maxDeposit);

    // If an upload or upiId is provided for legacy single update
    if (req.file) {
      setting.qrCodeImage = req.file.path || (req.file.filename ? `/uploads/${req.file.filename}` : setting.qrCodeImage);
    } else if (qrCodeImage !== undefined) {
      setting.qrCodeImage = qrCodeImage;
    }
    if (upiId !== undefined) setting.upiId = upiId.trim();
    if (upiName !== undefined) setting.upiName = upiName.trim();

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: 'Global payment settings updated successfully.',
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add a new QR / UPI payment channel
// @route   POST /api/payment-settings/admin/channels
// @access  Private/Admin
const addPaymentChannel = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { title, upiId, upiName, isActive, isPrimary } = req.body;

    if (!upiId || !upiId.trim()) {
      return next(new ApiError(400, 'UPI ID is required'));
    }

    let qrCodeImage = '';
    if (req.file) {
      qrCodeImage = req.file.path || (req.file.filename ? `/uploads/${req.file.filename}` : '');
    } else if (req.body.qrCodeImage) {
      qrCodeImage = req.body.qrCodeImage;
    }

    const isPrimaryBool = isPrimary === 'true' || isPrimary === true || setting.channels.length === 0;
    const isActiveBool = isActive === undefined ? true : (isActive === 'true' || isActive === true);

    if (isPrimaryBool) {
      setting.channels.forEach(ch => {
        ch.isPrimary = false;
      });
      setting.upiId = upiId.trim();
      setting.upiName = (upiName || 'The Cashly Payments').trim();
      setting.qrCodeImage = qrCodeImage || setting.qrCodeImage;
    }

    const newChannel = {
      title: (title || 'UPI QR').trim(),
      upiId: upiId.trim(),
      upiName: (upiName || 'The Cashly Payments').trim(),
      qrCodeImage: qrCodeImage,
      isActive: isActiveBool,
      isPrimary: isPrimaryBool
    };

    setting.channels.push(newChannel);

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.status(201).json({
      success: true,
      message: 'New payment QR & UPI channel added successfully.',
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update an existing payment channel
// @route   PUT /api/payment-settings/admin/channels/:channelId
// @access  Private/Admin
const updatePaymentChannel = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { channelId } = req.params;
    const channel = setting.channels.id(channelId);

    if (!channel) {
      return next(new ApiError(404, 'Payment channel not found.'));
    }

    const { title, upiId, upiName, isActive, isPrimary, qrCodeImage } = req.body;

    if (title !== undefined) channel.title = title.trim();
    if (upiId !== undefined) channel.upiId = upiId.trim();
    if (upiName !== undefined) channel.upiName = upiName.trim();
    if (isActive !== undefined) channel.isActive = Boolean(isActive === 'true' || isActive === true);

    if (req.file) {
      channel.qrCodeImage = req.file.path || (req.file.filename ? `/uploads/${req.file.filename}` : channel.qrCodeImage);
    } else if (qrCodeImage !== undefined) {
      channel.qrCodeImage = qrCodeImage;
    }

    if (isPrimary !== undefined) {
      const isPrim = isPrimary === 'true' || isPrimary === true;
      if (isPrim) {
        setting.channels.forEach(ch => {
          ch.isPrimary = false;
        });
        channel.isPrimary = true;
        setting.upiId = channel.upiId;
        setting.upiName = channel.upiName;
        setting.qrCodeImage = channel.qrCodeImage;
      } else {
        channel.isPrimary = false;
      }
    } else if (channel.isPrimary) {
      // Keep top-level in sync
      setting.upiId = channel.upiId;
      setting.upiName = channel.upiName;
      setting.qrCodeImage = channel.qrCodeImage;
    }

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: 'Payment channel updated successfully.',
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a payment channel
// @route   DELETE /api/payment-settings/admin/channels/:channelId
// @access  Private/Admin
const deletePaymentChannel = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { channelId } = req.params;

    if (setting.channels.length <= 1) {
      return next(new ApiError(400, 'Cannot delete the only remaining payment channel. You must have at least one active channel.'));
    }

    const channelIndex = setting.channels.findIndex(c => c._id.toString() === channelId);
    if (channelIndex === -1) {
      return next(new ApiError(404, 'Payment channel not found.'));
    }

    const wasPrimary = setting.channels[channelIndex].isPrimary;
    setting.channels.splice(channelIndex, 1);

    if (wasPrimary && setting.channels.length > 0) {
      setting.channels[0].isPrimary = true;
      setting.upiId = setting.channels[0].upiId;
      setting.upiName = setting.channels[0].upiName;
      setting.qrCodeImage = setting.channels[0].qrCodeImage;
    }

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: 'Payment channel deleted successfully.',
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Set a channel as Primary / Default
// @route   PATCH /api/payment-settings/admin/channels/:channelId/primary
// @access  Private/Admin
const setPrimaryPaymentChannel = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { channelId } = req.params;

    const channel = setting.channels.id(channelId);
    if (!channel) {
      return next(new ApiError(404, 'Payment channel not found.'));
    }

    setting.channels.forEach(ch => {
      ch.isPrimary = ch._id.toString() === channelId;
    });

    setting.upiId = channel.upiId;
    setting.upiName = channel.upiName;
    setting.qrCodeImage = channel.qrCodeImage;

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: `"${channel.title}" set as primary payment channel.`,
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle a channel's active status
// @route   PATCH /api/payment-settings/admin/channels/:channelId/toggle
// @access  Private/Admin
const togglePaymentChannel = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultSetting();
    const { channelId } = req.params;

    const channel = setting.channels.id(channelId);
    if (!channel) {
      return next(new ApiError(404, 'Payment channel not found.'));
    }

    channel.isActive = !channel.isActive;

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: `Channel "${channel.title}" is now ${channel.isActive ? 'Active' : 'Disabled'}.`,
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActivePaymentSetting,
  getAdminPaymentSetting,
  updatePaymentSetting,
  addPaymentChannel,
  updatePaymentChannel,
  deletePaymentChannel,
  setPrimaryPaymentChannel,
  togglePaymentChannel
};
