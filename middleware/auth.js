const jwt = require('jsonwebtoken');
const User = require('../models/User');
const getJwtSecret = require('../config/jwt');

const protect = async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch (error) {
    return res.status(500).json({ message: 'Authentication is not configured on the server' });
  }

  let payload;
  try {
    payload = jwt.verify(tokenMatch[1], secret);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token' });
  }

  const user = await User.findById(payload.id);
  if (!user) return res.status(401).json({ message: 'Account no longer exists' });
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion || 0)) {
    return res.status(401).json({ message: 'Session has been revoked' });
  }
  req.user = user;
  return next();
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
};

module.exports = { protect, adminOnly };