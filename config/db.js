const mongoose = require('mongoose');
const { initializeCategoryData } = require('../services/categorySetup');

let connectionPromise;
let categoryDataInitialized = false;

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (mongoose.connection.readyState === 1 && categoryDataInitialized) return mongoose.connection;

  if (connectionPromise) return connectionPromise;

  const connection = mongoose.connection.readyState === 1 ?
    Promise.resolve(mongoose.connection) : mongoose.connect(process.env.MONGO_URI);
  connectionPromise = connection
    .then(async (connection) => {
      if (mongoose.connection.readyState !== 1 || !categoryDataInitialized) {
        console.log('MongoDB Connected');
      }
      if (!categoryDataInitialized) {
        await initializeCategoryData();
        categoryDataInitialized = true;
      }
      connectionPromise = undefined;
      return connection;
    })
    .catch((error) => {
      connectionPromise = undefined;
      throw error;
    });

  return connectionPromise;
};

module.exports = connectDB;