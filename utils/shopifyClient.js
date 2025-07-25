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
      const products = await getAllPages('/products.json?fields=id,title,body_html,product_type,vendor,tags,variants,images');
      const itemIds = products.flatMap(p => p.variants.map(v => v.inventory_item_id));

      const inStockMap = {};
      for (let i = 0; i < itemIds.length; i += 100) {
        const ids = itemIds.slice(i, i + 100).join(',');
        const res = await api.get(`/inventory_levels.json?inventory_item_ids=${ids}`);
        res.data.inventory_levels.forEach(level => {
          inStockMap[level.inventory_item_id] = level.available > 0;
        });
      }

      return products.map(p => ({
        id: p.id,
        title: p.title,
        description: p.body_html,
        vendor: p.vendor,
        type: p.product_type,
        tags: p.tags,
        images: p.images.map(img => ({
          id: img.id,
          src: img.src,
          alt: img.alt,
          position: img.position
        })),
        variants: p.variants.map(v => ({
          id: v.id,
          sku: v.sku,
          price: v.price,
          compareAt: v.compare_at_price,
          weight: v.weight,
          barcode: v.barcode,
          inventoryItemId: v.inventory_item_id,
          inStock: inStockMap[v.inventory_item_id] ?? false
        }))
      }));
    }
  };
}

module.exports = shopifyClient;
