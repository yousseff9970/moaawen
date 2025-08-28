// Order model for MongoDB native driver
// This file defines the order structure and validation functions

/**
 * Create a new order object with default values
 */
function createOrder(businessId, customerId, platform) {
  return {
    // Order identification
    orderId: generateOrderId(),
    businessId: businessId,
    customerId: customerId,
    platform: platform,
    
    // Customer information
    customer: {
      name: '',
      phone: '',
      address: '',
      email: '',
      additionalNotes: ''
    },
    
    // Order items
    items: [],
    
    // Order totals
    subtotal: 0,
    tax: 0,
    shipping: 0,
    total: 0,
    
    // Order status and tracking
    status: 'pending', // 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'
    paymentStatus: 'pending', // 'pending', 'paid', 'failed', 'refunded'
    
    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    
    // Additional fields
    notes: '',
    internalNotes: '',
    trackingNumber: '',
    
    // Order flow tracking
    orderFlow: {
      stage: 'collecting_items', // 'collecting_items', 'collecting_info', 'reviewing', 'completed', 'cancelled'
      collectedInfo: {
        hasName: false,
        hasPhone: false,
        hasAddress: false
      },
      lastUpdated: new Date()
    }
  };
}

/**
 * Create order item object
 */
function createOrderItem(productId, variantId, productTitle, variantName, price, quantity, options = {}) {
  return {
    productId: productId,
    variantId: variantId,
    productTitle: productTitle,
    variantName: variantName,
    price: price,
    quantity: quantity,
    totalPrice: price * quantity,
    option1: options.option1 || '',
    option2: options.option2 || '',
    option3: options.option3 || '',
    sku: options.sku || '',
    image: options.image || ''
  };
}

/**
 * Generate order ID
 */
function generateOrderId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `ORD-${timestamp}-${random}`.toUpperCase();
}

/**
 * Calculate order totals
 */
function calculateTotals(order) {
  order.subtotal = order.items.reduce((sum, item) => sum + item.totalPrice, 0);
  order.total = order.subtotal + order.tax + order.shipping;
  order.updatedAt = new Date();
  return order.total;
}

/**
 * Check if order flow is complete
 */
function isOrderFlowComplete(order) {
  const { collectedInfo } = order.orderFlow;
  return collectedInfo.hasName && collectedInfo.hasPhone && collectedInfo.hasAddress && order.items.length > 0;
}

/**
 * Get missing information
 */
function getMissingInfo(order) {
  const missing = [];
  const { collectedInfo } = order.orderFlow;
  
  if (!collectedInfo.hasName) missing.push('name');
  if (!collectedInfo.hasPhone) missing.push('phone number');
  if (!collectedInfo.hasAddress) missing.push('address');
  if (order.items.length === 0) missing.push('order items');
  
  return missing;
}

/**
 * Validate order data
 */
function validateOrder(order) {
  const errors = [];
  
  if (!order.businessId) errors.push('Business ID is required');
  if (!order.customerId) errors.push('Customer ID is required');
  if (!order.platform) errors.push('Platform is required');
  
  if (order.items.length === 0) errors.push('Order must have at least one item');
  
  order.items.forEach((item, index) => {
    if (!item.productId) errors.push(`Item ${index + 1}: Product ID is required`);
    if (!item.variantId) errors.push(`Item ${index + 1}: Variant ID is required`);
    if (!item.productTitle) errors.push(`Item ${index + 1}: Product title is required`);
    if (!item.price || item.price <= 0) errors.push(`Item ${index + 1}: Valid price is required`);
    if (!item.quantity || item.quantity <= 0) errors.push(`Item ${index + 1}: Valid quantity is required`);
  });
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

module.exports = {
  createOrder,
  createOrderItem,
  generateOrderId,
  calculateTotals,
  isOrderFlowComplete,
  getMissingInfo,
  validateOrder
};
