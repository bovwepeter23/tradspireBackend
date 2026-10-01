const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const sendEmail = require('../config/nodemailer');
const getJwtSecret = require('../config/jwt');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'tradspire-secret-key', {
    expiresIn: '7d'
  });
};

const getFrontendRedirectUrl = () => {
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:8000').replace(/\/$/, '');
  return `${baseUrl}/public/html/homepage.html`;
};

const emailVerificationRequired = () => {
  return process.env.ENABLE_EMAIL_VERIFICATION === 'true';
};

const getPasswordResetUrl = (token) => {
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/reset-password.html?token=${token}`;
};

// 1. Get all users
// @route   GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Register user & send verification email
// @route   POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide name, email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      name,
      email: normalizedEmail,
      role: 'user',
      password,
      verificationToken,
      verificationTokenExpire: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    if (emailVerificationRequired()) {
      const verifyUrl = `${req.protocol}://${req.get('host')}/api/users/verify/${verificationToken}`;

      const message = `
        <h1>Verify Your Email</h1>
        <p>Please click the link below to verify your account:</p>
        <a href="${verifyUrl}" target="_blank">${verifyUrl}</a>
      `;

      try {
        await sendEmail({
          email: user.email,
          subject: 'Account Email Verification',
          html: message
        });

        return res.status(201).json({
          success: true,
          message: 'Registration successful. Please check your email to verify your account.'
        });
      } catch (emailErr) {
        console.warn('Email verification failed, auto-approving user for local testing:', emailErr.message);
        user.isVerified = true;
        await user.save();

        return res.status(201).json({
          success: true,
          message: 'Registration successful. Email verification could not be sent, so your account was auto-approved for this environment.'
        });
      }
    }

    user.isVerified = true;
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Email verification is disabled in this environment, so your account is ready to log in.',
      redirectUrl: getFrontendRedirectUrl(),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Verify email token
// @route   GET /api/users/verify/:token
exports.verifyEmail = async (req, res) => {
  try {
    const user = await User.findOne({
      verificationToken: req.params.token,
      verificationTokenExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now log in.'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. Authenticate user & login
// @route   POST /api/users/login
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Select password field (since select: false is set in the schema)
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check encrypted password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Ensure email is verified only when verification is explicitly required
    if (!user.isVerified && emailVerificationRequired()) {
      return res.status(403).json({
        message: 'Please verify your email address before logging in.'
      });
    }

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      redirectUrl: getFrontendRedirectUrl(),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. Request a password reset email
// @route   POST /api/users/forgot-password
exports.forgotPassword = async (req, res) => {
  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, a new password has been sent.'
  };

  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Please provide an email address' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail })
      .select('+password +resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    const previousPasswordHash = user.password;
    const previousResetPasswordToken = user.resetPasswordToken;
    const previousResetPasswordExpire = user.resetPasswordExpire;
    const newPassword = crypto.randomBytes(18).toString('base64url');
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    try {
      await sendEmail({
        email: user.email,
        subject: 'Your new Tradspire password',
        html: `
          <!doctype html>
          <html lang="en">
            <body style="margin:0;padding:0;background-color:#f2f5f3;font-family:Arial,Helvetica,sans-serif;color:#192821;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f2f5f3;padding:40px 16px;">
                <tr><td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dce5df;border-radius:12px;overflow:hidden;">
                    <tr><td style="padding:28px 36px;background-color:#173c30;color:#ffffff;font-size:20px;font-weight:bold;">Tradspire</td></tr>
                    <tr><td style="padding:36px;">
                      <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hello ${escapeHtml(user.name)},</p>
                      <h1 style="margin:0 0 14px;font-size:25px;line-height:1.3;color:#173c30;">Your new password is ready</h1>
                      <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#53645a;">Use the password below to sign in to your Tradspire account.</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f2f7f3;border:1px solid #dce8df;border-radius:8px;">
                        <tr><td align="center" style="padding:18px 12px;font-family:monospace;font-size:20px;letter-spacing:1px;color:#173c30;word-break:break-all;">${newPassword}</td></tr>
                      </table>
                      <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#53645a;">Enter this password with your email address when you log in. If you did not request this change, contact our support team promptly.</p>
                    </td></tr>
                    <tr><td style="padding:20px 36px;border-top:1px solid #e7ece8;font-size:12px;line-height:1.6;color:#718078;">This message contains sensitive account information. Please do not forward it.</td></tr>
                  </table>
                </td></tr>
              </table>
            </body>
          </html>
        `
      });
    } catch (emailError) {
      const restoreUpdate = {
        $set: { password: previousPasswordHash },
        $unset: {}
      };

      if (previousResetPasswordToken) {
        restoreUpdate.$set.resetPasswordToken = previousResetPasswordToken;
      } else {
        restoreUpdate.$unset.resetPasswordToken = 1;
      }

      if (previousResetPasswordExpire) {
        restoreUpdate.$set.resetPasswordExpire = previousResetPasswordExpire;
      } else {
        restoreUpdate.$unset.resetPasswordExpire = 1;
      }

      await User.updateOne({ _id: user._id, password: user.password }, restoreUpdate);
      throw emailError;
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    return res.status(500).json({ message: 'Unable to send password reset email' });
  }
};

// 6. Set a new password with a valid reset token
// @route   POST /api/users/reset-password/:token
exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'Please provide a new password' });
    }

    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+password +resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired password reset token' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};