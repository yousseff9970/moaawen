const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI; // e.g., mongodb+srv://...
const client = new MongoClient(uri);
let db;

const connectDB = async () => {
  if (!db) {
    await client.connect();
    db = client.db('moaawen');
    console.log('✅ MongoDB connected');
    
    // Create database indexes for better performance and data integrity
    try {
      const usersCol = db.collection('users');
      
      // Create unique index on email (if not exists)
      await usersCol.createIndex({ email: 1 }, { unique: true });
      
      // Create sparse unique index on facebookId (sparse allows multiple null values)
      await usersCol.createIndex(
        { facebookId: 1 }, 
        { 
          unique: true, 
          sparse: true,
          name: 'unique_facebook_id'
        }
      );
      
      console.log('✅ Database indexes verified/created');
    } catch (indexError) {
      // Indexes might already exist, which is fine
      if (indexError.code === 11000) {
        console.log('📋 Database indexes already exist');
      } else {
        console.warn('⚠️ Index creation warning:', indexError.message);
      }
    }
  }
  return db;
};

module.exports = connectDB;
