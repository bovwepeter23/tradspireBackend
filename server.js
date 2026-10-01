// require('dotenv').config();
// const express = require('express');
// const connectDB = require('./config/db.js');

// const app = express();

// // Connect Database
// connectDB();

// // Middleware
// app.use(express.json());

// // Mount Routes
// app.use('/api/users', require('./routes/userRoutes'));

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const carouselImageRoutes = require('./routes/carouselImageRoutes');
const orderRoutes = require('./routes/orderRoutes');

dotenv.config();

const app = express();

app.use(cors({
  origin: '*', // Allows requests from local machine and Vercel frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    res.status(503).json({ message: 'Database is unavailable. Check MONGO_URI and database connectivity.' });
  }
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/carousel', carouselImageRoutes);
app.use('/api/carousel-images', carouselImageRoutes);

// Keep API errors JSON so clients do not try to parse an HTML fallback page.
app.use('/api', (req, res) => {
  res.status(404).json({ message: `API route not found: ${req.method} ${req.originalUrl}` });
});

app.get('/', (req, res) => {
  res.send('Tradspire API is running');
});

app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 :
    error.name === 'ValidationError' ? 400 : error.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    message: status >= 500 && status !== 503 ? 'An unexpected server error occurred.' : error.message
  });
});

// Run listener only during local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export app for Vercel serverless execution
module.exports = app;
