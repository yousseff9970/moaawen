require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);

async function migrateProducts() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const productsCol = db.collection('products');

    console.log('🔄 Starting product migration...');

    // Get the business with products
    const business = await businessesCol.findOne({ 
      _id: new ObjectId("687761e83d4e67f9fbbfbcbe") 
    });

    if (!business) {
      console.log('❌ Business not found');
      return;
    }

    console.log(`📦 Found business: ${business.name}`);
    console.log(`📊 Products in business document: ${business.products ? business.products.length : 0}`);

    if (!business.products || business.products.length === 0) {
      console.log('⚠️ No products found in business document');
      return;
    }

    // Check if products already exist in products collection for this business
    const existingProducts = await productsCol.countDocuments({ 
      businessId: business._id 
    });
    
    console.log(`📋 Existing products in products collection: ${existingProducts}`);

    if (existingProducts > 0) {
      console.log('⚠️ Products already exist in products collection. Skipping migration.');
      console.log('If you want to re-migrate, delete existing products first.');
      return;
    }

    // Transform and insert products
    const productsToInsert = business.products.map(product => ({
      _id: new ObjectId(), // Generate new MongoDB ObjectId
      businessId: business._id,
      shopifyId: product.id, // Keep original Shopify ID as reference
      title: product.title,
      description: product.description,
      vendor: product.vendor,
      type: product.type || '',
      tags: product.tags || '',
      images: product.images || [],
      variants: product.variants || [],
      status: 'active', // Default status
      created_at: new Date(),
      updated_at: new Date(),
      // Keep original Shopify data for reference
      shopifyData: product
    }));

    // Insert products into products collection
    const result = await productsCol.insertMany(productsToInsert);
    console.log(`✅ Successfully migrated ${result.insertedCount} products to products collection`);

    // Verify the migration
    const migratedCount = await productsCol.countDocuments({ 
      businessId: business._id 
    });
    console.log(`🔍 Verification: ${migratedCount} products now in products collection`);

    // Create some stats
    const stats = await productsCol.aggregate([
      { $match: { businessId: business._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalVariants: { $sum: { $size: { $ifNull: ['$variants', []] } } },
          inStockVariants: { 
            $sum: { 
              $size: { 
                $filter: {
                  input: { $ifNull: ['$variants', []] },
                  cond: { $eq: ['$$this.inStock', true] }
                }
              }
            }
          }
        }
      }
    ]).toArray();

    if (stats[0]) {
      console.log(`📈 Migration Stats:`);
      console.log(`   Total Products: ${stats[0].total}`);
      console.log(`   Total Variants: ${stats[0].totalVariants}`);
      console.log(`   In Stock Variants: ${stats[0].inStockVariants}`);
    }

    console.log('🎉 Product migration completed successfully!');
    console.log('💡 Your products should now appear in the Products Management interface');

  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await client.close();
  }
}

// Run the migration
migrateProducts();
