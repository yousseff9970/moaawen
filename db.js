const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI; // e.g., mongodb+srv://...
const client = new MongoClient(uri);
let db;

const connectDB = async () => {
  if (!db) {
    await client.connect();
    db = client.db('moaawen');
    console.log('✅ MongoDB connected');
  }
  return db;
};

module.exports = connectDB;
