const { addItemToOrder } = require('./services/orderManager');

async function testAddItem() {
  try {
    console.log('🧪 Testing addItemToOrder function...\n');
    
    // Test adding the Hoodie (Red / M) which exists
    const customerId = 'test-customer-12345';
    const businessId = '6877610e3d4e67f9fbbfbcbe'; // The business ID from the debug output
    const productId = '8057184747709'; // Hoodie
    const variantId = '45292208718013'; // Red / M
    const quantity = 1;
    
    console.log('📋 Test Parameters:');
    console.log('Customer ID:', customerId);
    console.log('Business ID:', businessId);
    console.log('Product ID:', productId);
    console.log('Variant ID:', variantId);
    console.log('Quantity:', quantity);
    console.log('');
    
    const result = await addItemToOrder(customerId, businessId, productId, variantId, quantity);
    
    console.log('✅ Successfully added item to order!');
    console.log('Result:', result);
    
  } catch (error) {
    console.error('❌ Error adding item to order:', error.message);
    console.error('Full error:', error);
  }
}

// Load environment variables
require('dotenv').config();

// Run the test
testAddItem();
