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

  // 5️⃣ Get inventory levels for stock status
  console.log('📊 Fetching inventory levels...');
  const itemIds = products
    .flatMap(p => p.variants?.map(v => v.inventory_item_id) || [])
    .filter(Boolean);

  console.log(`🔍 Found ${itemIds.length} inventory items to check`);

  const inStockMap = {};
  let processedInventoryItems = 0;

  try {
    for (let i = 0; i < itemIds.length; i += 100) {
      const ids = itemIds.slice(i, i + 100).join(',');
      const res = await api.get(`/inventory_levels.json?inventory_item_ids=${ids}`);
      
      res.data.inventory_levels.forEach(level => {
        inStockMap[level.inventory_item_id] = level.available > 0;
        processedInventoryItems++;
      });
      
      console.log(`📊 Processed ${Math.min(i + 100, itemIds.length)}/${itemIds.length} inventory items`);
    }
  } catch (err) {
    console.error('❌ Error fetching inventory levels:', err.message);
    // Fallback: assume all variants are in stock if we can't get inventory
    itemIds.forEach(id => {
      inStockMap[id] = true;
    });
  }

  console.log(`✅ Processed ${processedInventoryItems} inventory items, ${Object.keys(inStockMap).length} stock statuses mapped`);

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
        const hasStockInfo = v.inventory_item_id && inStockMap.hasOwnProperty(v.inventory_item_id);
        const isInStock = hasStockInfo ? inStockMap[v.inventory_item_id] : false;
        
        if (hasStockInfo) {
          variantsWithStock++;
          if (isInStock) variantsInStock++;
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
          inStock: isInStock, // ✅ Individual variant stock status
          option1: v.option1 || null,
          option2: v.option2 || null,
          option3: v.option3 || null,
          variantName: [v.option1, v.option2, v.option3].filter(Boolean).join(' / '),
          image: variantImage?.src || p.images?.[0]?.src || null
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

  console.log(`📊 Stock Status Summary:
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
