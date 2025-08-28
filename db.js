const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI; // e.g., mongodb+srv://...
const client = new MongoClient(uri);
let dbb;

const db = async () => {
  if (!dbb) {
    await client.connect();
    dbb = client.db('moaawen');

  }
  return dbb;
};

module.exports = db;
