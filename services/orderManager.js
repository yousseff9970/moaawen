const { ObjectId } = require('bson');
const getDb = require('../db'); // <-- path to your db.js

const {
  createOrder,
  createOrderItem,
  calculateTotals,
  isOrderFlowComplete,
  getMissingInfo,
  validateOrder
} = require('../models/Order');

// -------------------- Helpers & globals --------------------

/** In-memory cache with TTL */
const activeOrders = new Map(); // key -> { order, cachedAt }
const CACHE_TTL_MS = 60_000;

/** Normalize inputs to avoid key forking / type drift */
function normCustomerId(v) { return String(v); }
function normBusinessId(v) { return String(v); }
function normPlatform(v) { return String(v || 'whatsapp').toLowerCase(); }
function cacheKey(customerId, businessId, platform) {
  return `${normCustomerId(customerId)}_${normBusinessId(businessId)}_${normPlatform(platform)}`;
}

/** Recompute order flow stage after any mutation (items/info) */
function recomputeStage(order) {
  if (!order) return;
  if (order.items.length === 0) {
    order.orderFlow.stage = 'collecting_items';
  } else if (!isOrderFlowComplete(order)) {
    order.orderFlow.stage = 'collecting_info';
  } else {
    order.orderFlow.stage = 'reviewing';
  }
}

let _indexesEnsured = false;
async function ensureOrderIndexes(collection) {
  if (_indexesEnsured) return;
  try {
    await collection.createIndexes([
      {
        key: {
          customerId: 1,
          businessId: 1,
          platform: 1,
          status: 1,
          'orderFlow.stage': 1,
          updatedAt: -1
        },
        name: 'orders_hot_query_compound'
      }
    ]);
  } catch (_) {
    // ignore index creation races between processes
  } finally {
    _indexesEnsured = true;
  }
}

/**
 * Get MongoDB orders collection (ensures indexes once)
 */
async function getOrdersCollection() {
  const db = await getDb();
  const col = db.collection('orders');
  await ensureOrderIndexes(col); // (14) ensure proper index
  return col;
}

// Utility: delete cache entries for a customer/business (+platform)
function deleteActiveOrderCache(customerId, businessId, platform) {
  const sCust = normCustomerId(customerId);
  const sBiz = normBusinessId(businessId);
  const sPlat = normPlatform(platform);
  const exactKey = cacheKey(sCust, sBiz, sPlat);
  activeOrders.delete(exactKey);
  // sweep any legacy keys for safety
  for (const key of activeOrders.keys()) {
    if (key.startsWith(`${sCust}_${sBiz}_`)) {
      activeOrders.delete(key);
    }
  }
}

// -------------------- Core ops --------------------

/**
 * Get or create an active order for a customer
 * - Platform-aware
 * - Recency-aware (maxIdleMinutes)
 * - touchOnAccess: bump updatedAt to keep session alive (11)
 * - When createIfMissing=false, will NOT create a new order
 */
async function getActiveOrder(customerId, businessId, platform = 'whatsapp', options = {}) {
  const {
    createIfMissing = true,
    maxIdleMinutes = 24 * 60,  // default: 24h
    touchOnAccess = true       // (11) keep the session alive on reads
  } = options;

  const sCust = normCustomerId(customerId);
  const sBiz = normBusinessId(businessId);
  const sPlat = normPlatform(platform);
  const key = cacheKey(sCust, sBiz, sPlat);

  try {
    // Serve from cache if fresh (7)
    const cached = activeOrders.get(key);
    if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
      // Optionally "touch" lazily without DB write; real touch occurs below if we hit DB
      return cached.order;
    }

    const collection = await getOrdersCollection();
    const cutoff = new Date(Date.now() - maxIdleMinutes * 60 * 1000);

    // (1) Stable newest pending search (avoid findOne+sort pitfalls)
    let order = await collection
      .find({
        customerId: sCust,
        businessId: sBiz,
        platform: sPlat,
        status: 'pending',
        'orderFlow.stage': { $in: ['collecting_items', 'collecting_info', 'reviewing'] },
        updatedAt: { $gte: cutoff }
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(1)
      .next();

    if (!order && createIfMissing) {
      // (3) Always store normalized ids/platform
      order = createOrder(sBiz, sCust, sPlat);
      const result = await collection.insertOne(order);
      order._id = result.insertedId;
    } else if (order && touchOnAccess) {
      // (11) Keep session alive on access
      order.updatedAt = new Date();
      await collection.updateOne({ _id: order._id }, { $set: { updatedAt: order.updatedAt } });
    }

    if (order) {
      activeOrders.set(key, { order, cachedAt: Date.now() }); // (7) cache with TTL
    }
    return order || null;
  } catch (error) {
    console.error('Error getting active order:', error);
    throw error;
  }
}

/**
 * Add item to order
 */
async function addItemToOrder(customerId, businessId, productId, variantId, quantity = 1, platform = 'whatsapp') {
  try {
    const sCust = normCustomerId(customerId);
    const sBiz = normBusinessId(businessId);
    const sPlat = normPlatform(platform);
    const key = cacheKey(sCust, sBiz, sPlat);

    // Clamp quantity
    const qty = Number.isFinite(+quantity) && +quantity > 0 ? Math.min(+quantity, 10) : 1;

    const order = await getActiveOrder(sCust, sBiz, sPlat);
    if (!order) throw new Error('Unable to create or retrieve active order');

    const db = await getDb();
    const businessCollection = db.collection('businesses');

    // (6) Guard ObjectId
    if (!ObjectId.isValid(sBiz)) throw new Error('Invalid businessId');

    // Fetch only the products we need
    const business = await businessCollection.findOne(
      { _id: new ObjectId(sBiz) },
      { projection: { products: 1, currency: 1 } }
    );
    if (!business) throw new Error('Business not found');

    const sProdId = String(productId);
    const sVarId = String(variantId);

    const product = (business.products || []).find(p => String(p.id) === sProdId);
    if (!product) {
      console.error(`❌ Product ${sProdId} not found. Available:`, (business.products || []).map(p => ({ id: p.id, title: p.title })));
      throw new Error(`Product not found: ${sProdId}`);
    }

    const variant = (product.variants || []).find(v => String(v.id) === sVarId);
    if (!variant) {
      console.error(`❌ Variant ${sVarId} not found in product ${sProdId}. Available:`, (product.variants || []).map(v => ({ id: v.id, name: v.variantName })));
      throw new Error(`Variant not found: ${sVarId}`);
    }

    // (9/10) Stock + price validation (part of 10)
    if (variant.inStock === false || (typeof variant.quantity === 'number' && variant.quantity < 1)) {
      throw new Error('This variant is out of stock');
    }
    const priceNum = Number(variant.discountedPrice ?? variant.originalPrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error('Invalid price for selected variant');

    const displayName =
      variant.variantName ||
      [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') ||
      'Standard';

    // Merge with existing line (string ID compare)
    const existingItemIndex = order.items.findIndex(
      item => String(item.productId) === sProdId && String(item.variantId) === sVarId
    );

    if (existingItemIndex >= 0) {
      order.items[existingItemIndex].quantity += qty;
      order.items[existingItemIndex].price = priceNum; // keep latest price reference
      order.items[existingItemIndex].totalPrice = order.items[existingItemIndex].quantity * priceNum;
    } else {
      const orderItem = createOrderItem(
        sProdId,
        sVarId,
        product.title,
        displayName,
        priceNum,
        qty,
        {
          option1: variant.option1,
          option2: variant.option2,
          option3: variant.option3,
          sku: variant.sku,
          image: variant.image
            ?? product.images?.[0]?.src
            ?? product.images?.[0]
            ?? null
        }
      );
      order.items.push(orderItem);
    }

    // Recalculate totals & stage (2, 5)
    calculateTotals(order);
    recomputeStage(order);
    order.updatedAt = new Date();

    // Persist (2): write full totals; then re-read to avoid race (6/7)
    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      {
        $set: {
          items: order.items,
          subtotal: order.subtotal,
          tax: order.tax ?? 0,
          shipping: order.shipping ?? 0,
          discount: order.discount ?? 0,
          total: order.total,
          'orderFlow.stage': order.orderFlow.stage,
          updatedAt: order.updatedAt
        }
      }
    );

    const fresh = await collection.findOne({ _id: order._id }); // (6/7) refresh after write
    activeOrders.set(key, { order: fresh, cachedAt: Date.now() });

    return {
      success: true,
      order: fresh,
      addedItem: {
        productTitle: product.title,
        variantName: displayName,
        quantity: qty,
        price: priceNum,
        totalPrice: priceNum * qty
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
async function removeItemFromOrder(customerId, businessId, productId, variantId, platform = 'whatsapp') {
  try {
    const sCust = normCustomerId(customerId);
    const sBiz = normBusinessId(businessId);
    const sPlat = normPlatform(platform);
    const key = cacheKey(sCust, sBiz, sPlat);

    const order = await getActiveOrder(sCust, sBiz, sPlat);
    if (!order) throw new Error('No active order');

    const sProdId = String(productId);
    const sVarId = String(variantId);

    const idx = order.items.findIndex(
      item => String(item.productId) === sProdId && String(item.variantId) === sVarId
    );

    if (idx === -1) throw new Error('Item not found in order');

    const removedItem = order.items[idx];
    order.items.splice(idx, 1);

    // Recalculate totals & stage (2, 5)
    calculateTotals(order);
    recomputeStage(order);
    order.updatedAt = new Date();

    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      {
        $set: {
          items: order.items,
          subtotal: order.subtotal,
          tax: order.tax ?? 0,
          shipping: order.shipping ?? 0,
          discount: order.discount ?? 0,
          total: order.total,
          'orderFlow.stage': order.orderFlow.stage,
          updatedAt: order.updatedAt
        }
      }
    );

    const fresh = await collection.findOne({ _id: order._id }); // (6/7) refresh after write
    activeOrders.set(key, { order: fresh, cachedAt: Date.now() });

    return {
      success: true,
      order: fresh,
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
async function updateCustomerInfo(customerId, businessId, customerData, platform = 'whatsapp') {
  try {
    const sCust = normCustomerId(customerId);
    const sBiz = normBusinessId(businessId);
    const sPlat = normPlatform(platform);
    const key = cacheKey(sCust, sBiz, sPlat);

    const order = await getActiveOrder(sCust, sBiz, sPlat);
    if (!order) throw new Error('No active order');

    const updateFields = {};

    if (customerData.name && customerData.name.trim()) {
      order.customer.name = customerData.name.trim();
      order.orderFlow.collectedInfo.hasName = true;
      updateFields['customer.name'] = order.customer.name;
      updateFields['orderFlow.collectedInfo.hasName'] = true;
    }

    if (customerData.phone && customerData.phone.trim()) {
      order.customer.phone = customerData.phone.trim();
      order.orderFlow.collectedInfo.hasPhone = true;
      updateFields['customer.phone'] = order.customer.phone;
      updateFields['orderFlow.collectedInfo.hasPhone'] = true;
    }

    if (customerData.address && customerData.address.trim()) {
      order.customer.address = customerData.address.trim();
      order.orderFlow.collectedInfo.hasAddress = true;
      updateFields['customer.address'] = order.customer.address;
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

    // (5) Update stage consistently
    recomputeStage(order);

    order.orderFlow.lastUpdated = new Date();
    order.updatedAt = new Date();
    updateFields['orderFlow.stage'] = order.orderFlow.stage;
    updateFields['orderFlow.lastUpdated'] = order.orderFlow.lastUpdated;
    updateFields['updatedAt'] = order.updatedAt;

    const collection = await getOrdersCollection();
    await collection.updateOne(
      { _id: order._id },
      { $set: updateFields }
    );

    // (6/7) Refresh after write
    const fresh = await collection.findOne({ _id: order._id });
    activeOrders.set(key, { order: fresh, cachedAt: Date.now() });

    return {
      success: true,
      order: fresh,
      isComplete: isOrderFlowComplete(fresh),
      missingInfo: getMissingInfo(fresh)
    };
  } catch (error) {
    console.error('Error updating customer info:', error);
    throw error;
  }
}

/**
 * Confirm order
 * - IMPORTANT: does NOT create new orders.
 */
async function confirmOrder(customerId, businessId, platform = 'whatsapp') {
  try {
    const sCust = normCustomerId(customerId);
    const sBiz = normBusinessId(businessId);
    const sPlat = normPlatform(platform);

    const order = await getActiveOrder(sCust, sBiz, sPlat, { createIfMissing: false });
    if (!order) throw new Error('No active order to confirm');

    if (!isOrderFlowComplete(order)) {
      throw new Error(`Order information is incomplete. Missing: ${getMissingInfo(order).join(', ')}`);
    }
    if (order.items.length === 0) {
      throw new Error('Order has no items');
    }

    // Update order status
    order.status = 'confirmed';
    order.orderFlow.stage = 'completed';
    order.confirmedAt = new Date();
    order.updatedAt = new Date();

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

    // Remove from active orders cache (by platform)
    deleteActiveOrderCache(sCust, sBiz, order.platform || sPlat);

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
 * - IMPORTANT: does NOT create new orders.
 */
async function cancelOrder(customerId, businessId, platform = 'whatsapp') {
  try {
    const sCust = normCustomerId(customerId);
    const sBiz = normBusinessId(businessId);
    const sPlat = normPlatform(platform);

    const order = await getActiveOrder(sCust, sBiz, sPlat, { createIfMissing: false });
    if (!order) throw new Error('No active order to cancel');

    order.status = 'cancelled';
    order.orderFlow.stage = 'cancelled';
    order.updatedAt = new Date();

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

    deleteActiveOrderCache(sCust, sBiz, order.platform || sPlat);

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

  // NOTE: Currency still shown as "$" (can wire business.currency into order if needed)
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
 * Clear order session (cleanup) — clears all platform keys for this customer/business
 */
function clearOrderSession(customerId, businessId) {
  const sCust = normCustomerId(customerId);
  const sBiz = normBusinessId(businessId);
  for (const key of activeOrders.keys()) {
    if (key.startsWith(`${sCust}_${sBiz}_`)) {
      activeOrders.delete(key);
    }
  }
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
