const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const RevokedToken = require('../models/RevokedToken');

module.exports = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    const auth = jwt.verify(token, process.env.JWT_SECRET || 'tradspire-secret-key');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const revoked = await RevokedToken.exists({ tokenHash });

    if (revoked) {
      return res.status(401).json({ message: 'Authentication token has been revoked' });
    }

    req.token = token;
    req.auth = auth;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired authentication token' });
  }
};