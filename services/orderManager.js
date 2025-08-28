const { MongoClient, ObjectId } = require('mongodb');
const { 
  createOrder, 
  createOrderItem, 
  calculateTotals, 
  isOrderFlowComplete, 
  getMissingInfo,
  validateOrder 
} = require('../models/Order');
const { getBusinessInfo } = require('./business');

const client = new MongoClient(process.env.MONGO_URI);

// Map to store active order sessions
const activeOrders = new Map();

/**
 * Get MongoDB orders collection
 */
async function getOrdersCollection() {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'moaawen');
  return db.collection('orders');
}

/**
 * Get or create an active order for a customer
 */
async function getActiveOrder(customerId, businessId, platform) {
  try {
    // Check if there's an active order in memory
    const orderKey = `${customerId}_${businessId}`;
    if (activeOrders.has(orderKey)) {
      return activeOrders.get(orderKey);
    }

    const collection = await getOrdersCollection();
    
    // Check for existing pending order in database
    let order = await collection.findOne({
      customerId,
      businessId: businessId.toString(),
      status: 'pending',
      'orderFlow.stage': { $in: ['collecting_items', 'collecting_info', 'reviewing'] }
    });

    if (!order) {
      // Create new order
      order = createOrder(businessId.toString(), customerId, platform);
      
      // Insert into database
      const result = await collection.insertOne(order);
      order._id = result.insertedId;
    }

    // Store in memory for quick access
    activeOrders.set(orderKey, order);
    
    return order;
  } catch (error) {
    console.error('Error getting active order:', error);
    throw error;
  }
}

/**
 * Add item to order
 */
async function addItemToOrder(customerId, businessId, productId, variantId, quantity = 1) {
  try {
    const order = await getActiveOrder(customerId, businessId, 'whatsapp'); // Default platform
    const business = await getBusinessInfo({ _id: new ObjectId(businessId) });
    
    // Find product and variant
    const product = business.products.find(p => p.id === productId);
    if (!product) {
      throw new Error('Product not found');
    }
    
    const variant = product.variants.find(v => v.id === variantId);
    if (!variant) {
      throw new Error('Variant not found');
    }
    
    // Check if variant is in stock
    if (variant.inStock === false) {
      throw new Error('This variant is out of stock');
    }
    
    // Check if item already exists in order
    const existingItemIndex = order.items.findIndex(
      item => item.productId === productId && item.variantId === variantId
    );
    
    const price = parseFloat(variant.discountedPrice || variant.originalPrice || 0);
    
    if (existingItemIndex >= 0) {
      // Update existing item quantity
      order.items[existingItemIndex].quantity += quantity;
      order.items[existingItemIndex].totalPrice = order.items[existingItemIndex].quantity * price;
    } else {
      // Add new item
      const orderItem = createOrderItem(
        productId,
        variantId,
        product.title,
        variant.variantName || [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || 'Standard',
        price,
        quantity,
        {
          option1: variant.option1,
          option2: variant.option2,
          option3: variant.option3,
          sku: variant.sku,
          image: variant.image || (product.images && product.images[0] ? product.images[0].src : null)
        }
      );
      
      order.items.push(orderItem);
    }
    
    // Recalculate totals
    calculateTotals(order);
    
    // Save order to database
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { $set: { items: order.items, subtotal: order.subtotal, total: order.total, updatedAt: new Date() } }
    );
    
    return {
      success: true,
      order,
      addedItem: {
        productTitle: product.title,
        variantName: variant.variantName || [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || 'Standard',
        quantity,
        price,
        totalPrice: price * quantity
      }
    };
  } catch (error) {
    console.error('Error adding item to order:', error);
    throw error;
  }
}

/**
 * Remove item from order
 */
async function removeItemFromOrder(customerId, businessId, productId, variantId) {
  try {
    const order = await getActiveOrder(customerId, businessId, 'whatsapp');
    
    const itemIndex = order.items.findIndex(
      item => item.productId === productId && item.variantId === variantId
    );
    
    if (itemIndex === -1) {
      throw new Error('Item not found in order');
    }
    
    const removedItem = order.items[itemIndex];
    order.items.splice(itemIndex, 1);
    
    // Recalculate totals
    calculateTotals(order);
    
    // Save order to database
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { $set: { items: order.items, subtotal: order.subtotal, total: order.total, updatedAt: new Date() } }
    );
    
    return {
      success: true,
      order,
      removedItem
    };
  } catch (error) {
    console.error('Error removing item from order:', error);
    throw error;
  }
}

/**
 * Update customer information
 */
async function updateCustomerInfo(customerId, businessId, customerData) {
  try {
    const order = await getActiveOrder(customerId, businessId, 'whatsapp');
    
    // Update customer info
    const updateFields = {};
    
    if (customerData.name) {
      order.customer.name = customerData.name;
      order.orderFlow.collectedInfo.hasName = true;
      updateFields['customer.name'] = customerData.name;
      updateFields['orderFlow.collectedInfo.hasName'] = true;
    }
    
    if (customerData.phone) {
      order.customer.phone = customerData.phone;
      order.orderFlow.collectedInfo.hasPhone = true;
      updateFields['customer.phone'] = customerData.phone;
      updateFields['orderFlow.collectedInfo.hasPhone'] = true;
    }
    
    if (customerData.address) {
      order.customer.address = customerData.address;
      order.orderFlow.collectedInfo.hasAddress = true;
      updateFields['customer.address'] = customerData.address;
      updateFields['orderFlow.collectedInfo.hasAddress'] = true;
    }
    
    if (customerData.email) {
      order.customer.email = customerData.email;
      updateFields['customer.email'] = customerData.email;
    }
    
    if (customerData.additionalNotes) {
      order.customer.additionalNotes = customerData.additionalNotes;
      updateFields['customer.additionalNotes'] = customerData.additionalNotes;
    }
    
    // Update order flow stage
    if (order.items.length > 0 && !isOrderFlowComplete(order)) {
      order.orderFlow.stage = 'collecting_info';
      updateFields['orderFlow.stage'] = 'collecting_info';
    } else if (isOrderFlowComplete(order)) {
      order.orderFlow.stage = 'reviewing';
      updateFields['orderFlow.stage'] = 'reviewing';
    }
    
    order.orderFlow.lastUpdated = new Date();
    updateFields['orderFlow.lastUpdated'] = order.orderFlow.lastUpdated;
    updateFields['updatedAt'] = new Date();
    
    // Save to database
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { $set: updateFields }
    );
    
    return {
      success: true,
      order,
      isComplete: isOrderFlowComplete(order),
      missingInfo: getMissingInfo(order)
    };
  } catch (error) {
    console.error('Error updating customer info:', error);
    throw error;
  }
}

/**
 * Confirm order
 */
async function confirmOrder(customerId, businessId) {
  try {
    const order = await getActiveOrder(customerId, businessId, 'whatsapp');
    
    if (!isOrderFlowComplete(order)) {
      throw new Error('Order information is incomplete');
    }
    
    if (order.items.length === 0) {
      throw new Error('Order has no items');
    }
    
    // Update order status
    order.status = 'confirmed';
    order.orderFlow.stage = 'completed';
    order.confirmedAt = new Date();
    order.updatedAt = new Date();
    
    // Save to database
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { 
        $set: { 
          status: 'confirmed',
          'orderFlow.stage': 'completed',
          confirmedAt: order.confirmedAt,
          updatedAt: order.updatedAt
        } 
      }
    );
    
    // Remove from active orders
    const orderKey = `${customerId}_${businessId}`;
    activeOrders.delete(orderKey);
    
    return {
      success: true,
      order,
      orderId: order.orderId
    };
  } catch (error) {
    console.error('Error confirming order:', error);
    throw error;
  }
}

/**
 * Cancel order
 */
async function cancelOrder(customerId, businessId) {
  try {
    const order = await getActiveOrder(customerId, businessId, 'whatsapp');
    
    order.status = 'cancelled';
    order.orderFlow.stage = 'cancelled';
    order.updatedAt = new Date();
    
    // Save to database
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { 
        $set: { 
          status: 'cancelled',
          'orderFlow.stage': 'cancelled',
          updatedAt: order.updatedAt
        } 
      }
    );
    
    // Remove from active orders
    const orderKey = `${customerId}_${businessId}`;
    activeOrders.delete(orderKey);
    
    return {
      success: true,
      order
    };
  } catch (error) {
    console.error('Error cancelling order:', error);
    throw error;
  }
}

/**
 * Get order summary
 */
function getOrderSummary(order) {
  if (!order || order.items.length === 0) {
    return 'Your cart is empty.';
  }
  
  let summary = '🛒 **Order Summary**\n\n';
  
  order.items.forEach((item, index) => {
    summary += `${index + 1}. **${item.productTitle}**\n`;
    summary += `   ${item.variantName}\n`;
    summary += `   Quantity: ${item.quantity}\n`;
    summary += `   Price: $${item.price} each\n`;
    summary += `   Total: $${item.totalPrice}\n\n`;
  });
  
  summary += `💰 **Subtotal: $${order.subtotal}**\n`;
  if (order.tax > 0) summary += `📊 Tax: $${order.tax}\n`;
  if (order.shipping > 0) summary += `🚚 Shipping: $${order.shipping}\n`;
  summary += `💳 **Total: $${order.total}**\n\n`;
  
  if (order.customer.name) {
    summary += `👤 **Customer Details**\n`;
    summary += `Name: ${order.customer.name}\n`;
    if (order.customer.phone) summary += `Phone: ${order.customer.phone}\n`;
    if (order.customer.address) summary += `Address: ${order.customer.address}\n`;
    if (order.customer.email) summary += `Email: ${order.customer.email}\n`;
  }
  
  return summary;
}

/**
 * Clear order session (cleanup)
 */
function clearOrderSession(customerId, businessId) {
  const orderKey = `${customerId}_${businessId}`;
  activeOrders.delete(orderKey);
}

module.exports = {
  getActiveOrder,
  addItemToOrder,
  removeItemFromOrder,
  updateCustomerInfo,
  confirmOrder,
  cancelOrder,
  getOrderSummary,
  clearOrderSession
};
