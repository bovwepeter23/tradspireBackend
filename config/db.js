const mongoose = require('mongoose');

let connectionPromise;

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(process.env.MONGO_URI)
    .then((connection) => {
      console.log('MongoDB Connected');
      return connection;
    })
    .catch((error) => {
      connectionPromise = undefined;
      throw error;
    });

  try {
    return await connectionPromise;
  } catch (error) {
    throw error;
  }
};

module.exports = connectDB;