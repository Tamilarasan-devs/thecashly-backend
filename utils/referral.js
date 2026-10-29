const crypto = require('crypto');

/**
 * Generate a unique, readable referral code.
 * Example format: CASH7X9K2
 */
async function generateUniqueReferralCode(UserModel) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous characters like 0, O, 1, I
  let isUnique = false;
  let code = '';
  let attempts = 0;

  while (!isUnique && attempts < 15) {
    attempts++;
    let randomPart = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      randomPart += chars[bytes[i] % chars.length];
    }
    code = `CASH${randomPart}`;

    if (UserModel) {
      const existing = await UserModel.findOne({ referralCode: code });
      if (!existing) {
        isUnique = true;
      }
    } else {
      isUnique = true;
    }
  }

  if (!isUnique) {
    code = `CASH${Date.now().toString(36).toUpperCase()}`;
  }

  return code;
}

module.exports = {
  generateUniqueReferralCode,
};

