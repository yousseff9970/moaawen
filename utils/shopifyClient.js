const axios = require('axios');

function shopifyClient(shop, accessToken) {
  
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('961')) return `+${digits}`;
  if (digits.length === 8) return `+961${digits}`; // assume local
  return `+${digits}`;
}




  const api = axios.create({
    baseURL: `https://${shop}/admin/api/2024-01`,
    headers: { 'X-Shopify-Access-Token': accessToken }
  });

  const getAllPages = async (url) => {
    let out = [], pageInfo;
    do {
      const res = await api.get(url, { params: { limit: 250, page_info: pageInfo } });
      out = out.concat(res.data.products || res.data.inventory_levels || []);
      const link = res.headers['link'];
      pageInfo = link?.match(/page_info=([^&>]+)/)?.[1];
      url = url.split('?')[0];
    } while (pageInfo);
    return out;
  };

  return {
    getStoreInfo: async () => (await api.get('/shop.json')).data.shop,

createOrder: async ({ variant_id, email, name, phone, address }) => {
  const [first_name, ...rest] = name.trim().split(' ');
  const last_name = rest.join(' ') || 'Customer';
variant_id = "45209434554557";
  const res = await api.post('/orders.json', {
    order: {
      line_items: [{ variant_id: Number(variant_id), quantity: 1 }],
      financial_status: 'pending',
      email: email || `guest@${shop}`,       
      phone: normalizePhone(phone || ''),
      shipping_address: {
        first_name,
        last_name,
        address1: address,
        country: 'Lebanon'
      }
    }
  });

  return res.data.order;
},



getFullProducts: async () => {
  console.log('🔍 Starting product fetch...');
  
  // 1️⃣ Get both custom & smart collections
  let collections = [];
  try {
    const customCollections = await getAllPages('/custom_collections.json?fields=id,title');
    const smartCollections = await getAllPages('/smart_collections.json?fields=id,title');
    collections = [...customCollections, ...smartCollections];
    console.log(`📦 Found ${collections.length} collections`);
  } catch (err) {
    console.warn('⚠️ Could not fetch collections:', err.message);
  }

  // 2️⃣ Get all products with complete variant data
  console.log('📋 Fetching products...');
  const products = await getAllPages('/products.json?fields=id,title,body_html,product_type,vendor,tags,variants,images');
  console.log(`📦 Found ${products.length} products`);

  // 3️⃣ Get collects mapping
  let collects = [];
  try {
    collects = await getAllPages('/collects.json?fields=collection_id,product_id');
    console.log(`🔗 Found ${collects.length} product-collection mappings`);
  } catch (err) {
    console.warn('⚠️ Could not fetch collects mapping:', err.message);
  }

  const productToCollections = {};
  collects.forEach(c => {
    if (!productToCollections[c.product_id]) {
      productToCollections[c.product_id] = [];
    }
    productToCollections[c.product_id].push(c.collection_id);
  });

  // 4️⃣ Fallback collection if none
  if (collections.length === 0) {
    collections.push({ id: 'all', title: 'All Products' });
    products.forEach(p => {
      if (!productToCollections[p.id]) {
        productToCollections[p.id] = ['all'];
      }
    });
  }

  // 5️⃣ Enhanced inventory fetching - get data from ALL locations
  console.log('📊 Fetching inventory levels from all locations...');
  const itemIds = products
    .flatMap(p => p.variants?.map(v => v.inventory_item_id) || [])
    .filter(Boolean);

  console.log(`🔍 Found ${itemIds.length} inventory items to check`);

  const inStockMap = {};
  const inventoryDetails = {};
  let processedInventoryItems = 0;

  try {
    // First, get all locations
    let locations = [];
    try {
      const locationsRes = await api.get('/locations.json');
      locations = locationsRes.data.locations || [];
      console.log(`📍 Found ${locations.length} locations:`, locations.map(l => `${l.name} (${l.id})`));
    } catch (err) {
      console.warn('⚠️ Could not fetch locations:', err.message);
    }

    // Get inventory levels from ALL locations
    for (let i = 0; i < itemIds.length; i += 100) {
      const ids = itemIds.slice(i, i + 100).join(',');
      
      try {
        // Get inventory levels for all locations
        const res = await api.get(`/inventory_levels.json?inventory_item_ids=${ids}`);
        
        res.data.inventory_levels.forEach(level => {
          const itemId = level.inventory_item_id;
          
          // Store detailed inventory info
          if (!inventoryDetails[itemId]) {
            inventoryDetails[itemId] = {
              totalAvailable: 0,
              locations: [],
              hasAnyStock: false
            };
          }
          
          inventoryDetails[itemId].locations.push({
            locationId: level.location_id,
            available: level.available
          });
          
          inventoryDetails[itemId].totalAvailable += level.available;
          
          // Mark as in stock if ANY location has stock
          if (level.available > 0) {
            inventoryDetails[itemId].hasAnyStock = true;
            inStockMap[itemId] = true;
          }
          
          processedInventoryItems++;
        });
        
        // If no inventory levels found, try alternative method
        if (res.data.inventory_levels.length === 0) {
          console.log(`⚠️ No inventory levels found for batch ${i}-${Math.min(i + 100, itemIds.length)}, trying alternative method...`);
          
          // Fallback: check individual inventory items
          const currentBatchIds = itemIds.slice(i, i + 100);
          for (const itemId of currentBatchIds) {
            try {
              const itemRes = await api.get(`/inventory_items/${itemId}.json`);
              const item = itemRes.data.inventory_item;
              
              // If tracked, assume available (since we can't get exact count)
              if (item && item.tracked) {
                inStockMap[itemId] = true;
                inventoryDetails[itemId] = {
                  totalAvailable: 1, // Assume at least 1 if tracked
                  locations: [{ locationId: 'unknown', available: 1 }],
                  hasAnyStock: true,
                  fallbackMethod: true
                };
              } else {
                // If not tracked, assume available
                inStockMap[itemId] = true;
                inventoryDetails[itemId] = {
                  totalAvailable: 999, // Assume unlimited if not tracked
                  locations: [{ locationId: 'untracked', available: 999 }],
                  hasAnyStock: true,
                  untracked: true
                };
              }
            } catch (itemErr) {
              console.warn(`⚠️ Could not fetch inventory item ${itemId}:`, itemErr.message);
              // Final fallback: assume in stock
              inStockMap[itemId] = true;
            }
          }
        }
        
        console.log(`📊 Processed ${Math.min(i + 100, itemIds.length)}/${itemIds.length} inventory items`);
      } catch (batchErr) {
        console.error(`❌ Error fetching inventory batch ${i}-${Math.min(i + 100, itemIds.length)}:`, batchErr.message);
        
        // Fallback for this batch: assume all items are in stock
        const currentBatchIds = itemIds.slice(i, i + 100);
        currentBatchIds.forEach(id => {
          inStockMap[id] = true;
          inventoryDetails[id] = {
            totalAvailable: 1,
            locations: [{ locationId: 'fallback', available: 1 }],
            hasAnyStock: true,
            fallback: true
          };
        });
      }
    }
  } catch (err) {
    console.error('❌ Error fetching inventory levels:', err.message);
    // Final fallback: assume all variants are in stock
    itemIds.forEach(id => {
      inStockMap[id] = true;
      inventoryDetails[id] = {
        totalAvailable: 1,
        locations: [{ locationId: 'error-fallback', available: 1 }],
        hasAnyStock: true,
        errorFallback: true
      };
    });
  }

  // Log inventory summary
  const totalTracked = Object.keys(inventoryDetails).length;
  const inStockCount = Object.values(inventoryDetails).filter(d => d.hasAnyStock).length;
  const untrackedCount = Object.values(inventoryDetails).filter(d => d.untracked).length;
  const fallbackCount = Object.values(inventoryDetails).filter(d => d.fallback || d.errorFallback).length;

  console.log(`✅ Inventory Summary:
    • Total inventory items: ${totalTracked}
    • Items in stock: ${inStockCount}
    • Untracked items (assumed available): ${untrackedCount}
    • Fallback items (assumed available): ${fallbackCount}
    • Processed inventory records: ${processedInventoryItems}`);

  // 6️⃣ Build collections with products and variants
  const collectionMap = collections.reduce((acc, col) => {
    acc[col.id] = { id: col.id, title: col.title, products: [] };
    return acc;
  }, {});

  let totalVariants = 0;
  let variantsWithStock = 0;
  let variantsInStock = 0;

  products.forEach(p => {
    const productData = {
      id: p.id,
      title: p.title,
      description: p.body_html,
      vendor: p.vendor,
      type: p.product_type,
      tags: p.tags,
      images: (p.images || []).map(img => ({
        id: img.id,
        src: img.src,
        alt: img.alt,
        position: img.position
      })),
      variants: (p.variants || []).map(v => {
        totalVariants++;
        
        const variantImage = v.image_id ? p.images?.find(img => img.id === v.image_id) : null;
        const hasStockInfo = v.inventory_item_id && (inStockMap.hasOwnProperty(v.inventory_item_id) || inventoryDetails.hasOwnProperty(v.inventory_item_id));
        
        // Enhanced stock determination
        let isInStock = false;
        if (hasStockInfo) {
          const stockInfo = inventoryDetails[v.inventory_item_id];
          isInStock = stockInfo ? stockInfo.hasAnyStock : inStockMap[v.inventory_item_id];
          variantsWithStock++;
          if (isInStock) variantsInStock++;
        } else {
          // If no inventory tracking, check variant inventory policy
          if (v.inventory_management === 'shopify') {
            // If managed by Shopify but no data found, assume out of stock
            isInStock = false;
          } else {
            // If not managed by Shopify, assume in stock
            isInStock = true;
            variantsWithStock++;
            variantsInStock++;
          }
        }

        return {
          id: v.id,
          sku: v.sku,
          discountedPrice: v.price,
          originalPrice: v.compare_at_price || v.price,
          isDiscounted: v.compare_at_price && Number(v.compare_at_price) > Number(v.price),
          weight: v.weight,
          barcode: v.barcode,
          inventoryItemId: v.inventory_item_id,
          inStock: isInStock, // ✅ Enhanced stock status determination
          option1: v.option1 || null,
          option2: v.option2 || null,
          option3: v.option3 || null,
          variantName: [v.option1, v.option2, v.option3].filter(Boolean).join(' / '),
          image: variantImage?.src || p.images?.[0]?.src || null,
          // Additional debugging info
          inventoryManagement: v.inventory_management,
          inventoryPolicy: v.inventory_policy,
          inventoryQuantity: v.inventory_quantity
        };
      })
    };

    const assignedCollections = productToCollections[p.id] || [];
    if (assignedCollections.length === 0) {
      assignedCollections.push('all');
    }
    assignedCollections.forEach(colId => {
      if (collectionMap[colId]) {
        collectionMap[colId].products.push(productData);
      }
    });
  });

  console.log(`📊 Final Stock Status Summary:
    • Total variants: ${totalVariants}
    • Variants with stock info: ${variantsWithStock}
    • Variants in stock: ${variantsInStock}
    • Stock coverage: ${totalVariants > 0 ? ((variantsWithStock / totalVariants) * 100).toFixed(1) : 0}%`);

  // 7️⃣ Return collections with products
  const result = Object.values(collectionMap);
  console.log(`✅ Returning ${result.length} collections with products`);
  
  return result;
}




  };
}

module.exports = shopifyClient;
