const { MongoClient, ObjectId } = require('mongodb');
const { buildProductDatabase } = require('./services/catalogBuilder');

async function testProductStructure() {
  try {
    console.log('🔍 Testing Product Database Structure...\n');
    
    // Connect to MongoDB
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessCollection = db.collection('businesses');
    
    // Get a business with products
    const business = await businessCollection.findOne({ 
      products: { $exists: true, $ne: [], $not: { $size: 0 } } 
    });
    
    if (!business) {
      console.log('❌ No business with products found');
      return;
    }
    
    console.log(`📋 Business: ${business.name || business._id}`);
    console.log(`📦 Total Products: ${business.products.length}\n`);
    
    // Log raw product structure from database
    console.log('🗃️ RAW DATABASE STRUCTURE:');
    business.products.forEach((product, index) => {
      console.log(`${index + 1}. Product ID: ${product.id}`);
      console.log(`   Title: ${product.title}`);
      console.log(`   Variants: ${product.variants.length}`);
      product.variants.forEach((variant, vIndex) => {
        console.log(`     ${vIndex + 1}. Variant ID: ${variant.id}`);
        console.log(`        Name/Options: ${variant.variantName || [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ')}`);
        console.log(`        In Stock: ${variant.inStock !== false}`);
      });
      console.log('');
    });
    
    // Build the product database using our function
    console.log('🔧 PROCESSED DATABASE STRUCTURE:');
    const productDatabase = buildProductDatabase(business.products);
    
    productDatabase.forEach((product, index) => {
      console.log(`${index + 1}. Product ID: ${product.id}`);
      console.log(`   Title: ${product.title}`);
      console.log(`   Variants: ${product.variants.length}`);
      product.variants.forEach((variant, vIndex) => {
        console.log(`     ${vIndex + 1}. Variant ID: ${variant.id}`);
        console.log(`        Name: ${variant.name}`);
        console.log(`        Price: $${variant.price}`);
      });
      console.log('');
    });
    
    await client.close();
    console.log('✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Error testing product structure:', error);
  }
}

// Load environment variables
require('dotenv').config();

// Run the test
testProductStructure();
