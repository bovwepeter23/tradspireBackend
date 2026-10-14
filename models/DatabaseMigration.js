const mongoose = require('mongoose');

const databaseMigrationSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('DatabaseMigration', databaseMigrationSchema);
