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

dotenv.config();

const app = express();

app.use(cors({
  origin: '*', // Allows requests from local machine and Vercel frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Connect DB
connectDB();

// Routes
app.use('/api/users', userRoutes);

// Keep API errors JSON so clients do not try to parse an HTML fallback page.
app.use('/api', (req, res) => {
  res.status(404).json({ message: `API route not found: ${req.method} ${req.originalUrl}` });
});

app.get('/', (req, res) => {
  res.send('Tradspire API is running on Vercel');
});

// Run listener only during local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export app for Vercel serverless execution
module.exports = app;
