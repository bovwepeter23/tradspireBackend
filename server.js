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

app.use(cors());
app.use(express.json());

// Connect DB
connectDB();

// Routes
app.use('/api/users', userRoutes);

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