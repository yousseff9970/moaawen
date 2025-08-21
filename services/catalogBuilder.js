// ===== Advanced Catalog Builder (organized, compact, relevant) =====
const CATALOG_CFG = {
  maxTags: 6,
  maxProductsPerTag: 6,
  maxVariantsPerProduct: 2,       // only show 2 key variants per product
  preferInStock: true,            // sort in-stock first
  preferDiscounted: true,         // then discounted
  sortByRelevance: true,          // rank by user query relevance
};

// Compact catalog configuration for general queries
const COMPACT_CATALOG_CFG = {
  maxTags: 4,
  maxProductsPerTag: 3,
  maxVariantsPerProduct: 1,
  preferInStock: true,
  preferDiscounted: true,
  sortByRelevance: true,
};

function safeText(x, max = 220) {
  if (!x) return '';
  const s = String(x).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function priceNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function primaryTag(p) {
  // Parse tags string and use first tag; fallback to product type, then "Other"
  if (p.tags && typeof p.tags === 'string') {
    const tagArray = p.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagArray.length > 0) return tagArray[0];
  }
  return p.type || 'Other';
}

function aggregateProduct(p) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  let min = null, max = null, discounted = false, inStockCount = 0, totalVariants = vs.length;

  for (const v of vs) {
    const dp = priceNum(v.discountedPrice);
    const op = priceNum(v.originalPrice);
    if (dp != null) {
      min = min == null ? dp : Math.min(min, dp);
      max = max == null ? dp : Math.max(max, dp);
    }
    if (v.isDiscounted && op && dp && op > dp) discounted = true;
    // Count variants that are explicitly in stock (true) or undefined (assume in stock)
    if (v.inStock === true || v.inStock === undefined) inStockCount += 1;
  }

  return {
    minPrice: min, 
    maxPrice: max,
    discounted,
    inStockCount,
    totalVariants,
    hasAnyInStock: inStockCount > 0
  };
}

function pctDiscount(p) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  let best = 0;
  for (const v of vs) {
    const op = priceNum(v.originalPrice), dp = priceNum(v.discountedPrice);
    if (op && dp && op > dp) {
      const pct = Math.round(((op - dp) / op) * 100);
      if (pct > best) best = pct;
    }
  }
  return best;
}

function pickTopVariants(p, limit) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  // sort: in-stock first, then discounted, then cheapest
  const sorted = [...vs].sort((a, b) => {
    const aStock = a.inStock !== false; // treat undefined as in-stock
    const bStock = b.inStock !== false;
    if (aStock !== bStock) return bStock - aStock;
    
    const aDisc = a.isDiscounted ? 1 : 0;
    const bDisc = b.isDiscounted ? 1 : 0;
    if (aDisc !== bDisc) return bDisc - aDisc;
    
    const aP = priceNum(a.discountedPrice) ?? Infinity;
    const bP = priceNum(b.discountedPrice) ?? Infinity;
    return aP - bP;
  });
  
  return sorted.slice(0, limit).map(v => {
    const label = v.variantName ? `**${v.variantName}**` : (v.option1 ? `**${v.option1}**` : '**Standard**');
    
    let priceDisplay = '';
    const dp = priceNum(v.discountedPrice);
    const op = priceNum(v.originalPrice);
    
    if (dp != null && op && v.isDiscounted && op > dp) {
      const savings = (op - dp).toFixed(2);
      priceDisplay = `~~$${op}~~ ➜ **$${dp}** 💚 *Save $${savings}*`;
    } else if (dp != null) {
      priceDisplay = `**$${dp}**`;
    } else {
      priceDisplay = '**Contact for price**';
    }
    
    // Enhanced stock status with visual indicators
    const stockIcon = v.inStock === false ? '🔴' : '🟢';
    const stockText = v.inStock === false ? '**Out of stock**' : '**Available**';
    
    // Additional details
    const details = [];
    if (v.sku) details.push(`SKU: ${v.sku}`);
    if (v.barcode) details.push(`Barcode: ${v.barcode}`);
    const detailsText = details.length > 0 ? ` • ${details.join(' • ')}` : '';
    
    return `      ${stockIcon} ${label} — ${priceDisplay} • ${stockText}${detailsText}`;
  });
}

function scoreByQuery(p, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const hay = [
    p.title, p.description, p.vendor, p.type,
    ...(Array.isArray(p.tags) ? p.tags : [])
  ].join(' ').toLowerCase();
  let s = 0;
  // naive term scoring
  for (const term of q.split(/\W+/).filter(x => x.length > 1)) {
    if (hay.includes(term)) s += 1;
  }
  return s;
}

function buildCompactCatalog(userMessage, products = [], cfg = COMPACT_CATALOG_CFG) {
  if (!products || products.length === 0) {
    return "🚫 **No products available at the moment**\n\nPlease check back later or contact us for more information.";
  }

  // group by primary tag (parsed from tags string)
  const groups = {};
  for (const p of products) {
    const tag = primaryTag(p);
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(p);
  }

  // order tags by relevance (sum of product scores)
  let tagEntries = Object.entries(groups).map(([tag, arr]) => {
    const scored = arr.map(p => ({
      p,
      s: cfg.sortByRelevance ? scoreByQuery(p, userMessage) : 0
    }));
    const score = scored.reduce((a, b) => a + b.s, 0);
    return { tag, products: arr, score };
  }).sort((a, b) => b.score - a.score);

  tagEntries = tagEntries.slice(0, cfg.maxTags);

  const catalogSections = [];
  let totalProducts = 0;
  let totalInStock = 0;
  let totalOnSale = 0;

  for (const { tag, products } of tagEntries) {
    // sort each tag's products - prioritize products with any in-stock variants
    const sorted = [...products].sort((a, b) => {
      const A = aggregateProduct(a);
      const B = aggregateProduct(b);

      // Products with any in-stock variants first
      if (cfg.preferInStock && A.hasAnyInStock !== B.hasAnyInStock) {
        return B.hasAnyInStock - A.hasAnyInStock;
      }
      // discounted products next
      if (cfg.preferDiscounted && A.discounted !== B.discounted) {
        return (B.discounted ? 1 : 0) - (A.discounted ? 1 : 0);
      }
      // cheaper min price first
      const aMin = A.minPrice ?? Infinity;
      const bMin = B.minPrice ?? Infinity;
      if (aMin !== bMin) return aMin - bMin;
      // finally, title
      return String(a.title).localeCompare(String(b.title));
    }).slice(0, cfg.maxProductsPerTag);

    // Update totals
    totalProducts += sorted.length;
    sorted.forEach(p => {
      const a = aggregateProduct(p);
      if (a.hasAnyInStock) totalInStock++;
      if (a.discounted) totalOnSale++;
    });

    // Compact category header
    const categoryHeader = [
      `## 🏷️ ${tag}`,
      ``,
    ].join('\n');

    const productItems = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const a = aggregateProduct(p);
      
      // Compact price display
      let priceDisplay = '';
      if (a.minPrice != null && a.maxPrice != null) {
        if (a.minPrice === a.maxPrice) {
          priceDisplay = `$${a.minPrice}`;
        } else {
          priceDisplay = `$${a.minPrice}-$${a.maxPrice}`;
        }
      } else {
        priceDisplay = 'Contact for price';
      }

      // Compact badges
      const badges = [];
      if (a.discounted) {
        const discount = pctDiscount(p);
        badges.push(`🔖 ${discount}% OFF`);
      }
      if (a.hasAnyInStock) {
        badges.push('✅ Available');
      } else {
        badges.push('❌ Out of stock');
      }

      // Compact product display
      const productLine = [
        `**${i + 1}. ${safeText(p.title, 50)}** — ${priceDisplay}`,
        badges.length > 0 ? ` • ${badges.join(' • ')}` : '',
        ``,
      ].join('');

      productItems.push(productLine);
    }

    // Show "and X more" if there are more products in this category
    if (products.length > cfg.maxProductsPerTag) {
      const remaining = products.length - cfg.maxProductsPerTag;
      productItems.push(`*...and ${remaining} more ${remaining === 1 ? 'product' : 'products'}*\n`);
    }

    // Combine category with products
    const categorySection = [
      categoryHeader,
      ...productItems,
    ].join('\n');

    catalogSections.push(categorySection);
  }

  // Compact catalog with summary
  const compactCatalog = [
    `🛍️ **Product Overview**`,
    ``,
    `${totalProducts} products • ${totalInStock} in stock • ${totalOnSale} on sale`,
    ``,
    ...catalogSections,
    ``,
    `💡 *Ask for "detailed products" or "full catalog" to see complete information*`,
  ].join('\n');

  return compactCatalog;
}

function detectCatalogIntent(userMessage) {
  if (!userMessage) return 'compact';
  
  const message = userMessage.toLowerCase();
  
  // Keywords that indicate user wants detailed catalog
  const detailedKeywords = [
    'detailed', 'full catalog', 'all products', 'complete list', 'everything you have',
    'show me all', 'full list', 'detailed products', 'all items', 'comprehensive',
    'variants', 'options', 'specifications', 'details', 'full details'
  ];
  
  // Keywords that indicate user wants specific category/search
  const specificKeywords = [
    'specific', 'particular', 'category', 'type of', 'kind of'
  ];
  
  // Check for detailed intent
  if (detailedKeywords.some(keyword => message.includes(keyword))) {
    return 'detailed';
  }
  
  // Check for specific search (medium detail)
  if (specificKeywords.some(keyword => message.includes(keyword))) {
    return 'medium';
  }
  
  // General product inquiries (compact)
  const generalKeywords = [
    'products', 'what do you have', 'what do you sell', 'available',
    'catalog', 'items', 'merchandise', 'goods'
  ];
  
  if (generalKeywords.some(keyword => message.includes(keyword))) {
    return 'compact';
  }
  
  // Default to compact for any other query
  return 'compact';
}

function buildAdvancedCatalog(userMessage, products = [], cfg = CATALOG_CFG) {
  if (!products || products.length === 0) {
    return "🚫 **No products available at the moment**\n\nPlease check back later or contact us for more information.";
  }

  // group by primary tag (parsed from tags string)
  const groups = {};
  for (const p of products) {
    const tag = primaryTag(p);
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(p);
  }

  // order tags by relevance (sum of product scores)
  let tagEntries = Object.entries(groups).map(([tag, arr]) => {
    const scored = arr.map(p => ({
      p,
      s: cfg.sortByRelevance ? scoreByQuery(p, userMessage) : 0
    }));
    const score = scored.reduce((a, b) => a + b.s, 0);
    return { tag, products: arr, score };
  }).sort((a, b) => b.score - a.score);

  tagEntries = tagEntries.slice(0, cfg.maxTags);

  const catalogSections = [];

  for (const { tag, products } of tagEntries) {
    // sort each tag's products - prioritize products with any in-stock variants
    const sorted = [...products].sort((a, b) => {
      const A = aggregateProduct(a);
      const B = aggregateProduct(b);

      // Products with any in-stock variants first
      if (cfg.preferInStock && A.hasAnyInStock !== B.hasAnyInStock) {
        return B.hasAnyInStock - A.hasAnyInStock;
      }
      // discounted products next
      if (cfg.preferDiscounted && A.discounted !== B.discounted) {
        return (B.discounted ? 1 : 0) - (A.discounted ? 1 : 0);
      }
      // cheaper min price first
      const aMin = A.minPrice ?? Infinity;
      const bMin = B.minPrice ?? Infinity;
      if (aMin !== bMin) return aMin - bMin;
      // finally, title
      return String(a.title).localeCompare(String(b.title));
    }).slice(0, cfg.maxProductsPerTag);

    // section header stats
    const stats = sorted.reduce((acc, p) => {
      const a = aggregateProduct(p);
      acc.inStock += a.hasAnyInStock ? 1 : 0;
      acc.onSale += a.discounted ? 1 : 0;
      acc.totalVariants += a.totalVariants;
      acc.inStockVariants += a.inStockCount;
      return acc;
    }, { inStock: 0, onSale: 0, totalVariants: 0, inStockVariants: 0 });

    // Beautiful category header with visual elements
    const categoryHeader = [
      `╔══════════════════════════════════════╗`,
      `║  🏷️  **${tag.toUpperCase()}**  🏷️  ║`,
      `╚══════════════════════════════════════╝`,
      ``,
      `📊 **Category Overview:**`,
      `• 🛍️ Products: **${sorted.length}**`,
      `• ✅ In Stock: **${stats.inStockVariants}/${stats.totalVariants}** variants`,
      `• 🔥 On Sale: **${stats.onSale}** ${stats.onSale === 1 ? 'product' : 'products'}`,
      ``,
      `${stats.onSale > 0 ? '🎉 **SPECIAL OFFERS AVAILABLE!** 🎉' : ''}`,
      ``,
    ].filter(Boolean).join('\n');

    const productItems = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const a = aggregateProduct(p);
      
      // Price display with beautiful formatting
      let priceDisplay = '';
      if (a.minPrice != null && a.maxPrice != null) {
        if (a.minPrice === a.maxPrice) {
          priceDisplay = `💰 **$${a.minPrice}**`;
        } else {
          priceDisplay = `💰 **$${a.minPrice} - $${a.maxPrice}**`;
        }
      } else {
        priceDisplay = '💰 **Price upon request**';
      }

      // Discount badge with eye-catching formatting
      let discountBadge = '';
      if (a.discounted) {
        const discount = pctDiscount(p);
        discountBadge = `\n🎯 **SAVE ${discount}%** 🎯 `;
      }

      // Stock status with visual indicators
      let stockStatus = '';
      if (a.inStockCount === a.totalVariants) {
        stockStatus = '✅ **All variants available**';
      } else if (a.inStockCount > 0) {
        stockStatus = `⚠️ **Limited stock** (${a.inStockCount}/${a.totalVariants} variants)`;
      } else {
        stockStatus = '❌ **Currently out of stock**';
      }

      // Product header with beautiful formatting
      const productHeader = [
        ``,
        `┌─────────────────────────────────────┐`,
        `│  **${i + 1}. ${safeText(p.title, 65)}**  │`,
        `└─────────────────────────────────────┘`,
        ``,
        `${priceDisplay}${discountBadge}`,
        `${stockStatus}`,
        ``,
        `📝 **Description:**`,
        `${safeText(p.description, 180) || '*No description available*'}`,
        ``,
        `🏪 **Brand:** ${p.vendor || 'N/A'} • 🗂️ **Category:** ${p.type || 'N/A'}`,
        ``,
      ].join('\n');

      // Enhanced variants display
      const variants = pickTopVariants(p, cfg.maxVariantsPerProduct);
      let variantsSection = '';
      
      if (variants.length > 0) {
        variantsSection = [
          `🎯 **Available Options:**`,
          ``,
          ...variants.map(v => `${v}`),
          ``,
          variants.length < a.totalVariants ? `*... and ${a.totalVariants - variants.length} more variant${a.totalVariants - variants.length === 1 ? '' : 's'}*` : '',
          ``,
        ].filter(Boolean).join('\n');
      } else {
        variantsSection = [
          `🎯 **Available Options:**`,
          ``,
          `      • *No variants currently available*`,
          ``,
        ].join('\n');
      }

      // Combine product info
      const productBlock = [
        productHeader,
        variantsSection,
        `─────────────────────────────────────`,
        ``,
      ].join('\n');

      productItems.push(productBlock);
    }

    // Combine category header with products
    const categorySection = [
      categoryHeader,
      ...productItems,
      ``,
      `════════════════════════════════════════`,
      ``,
    ].join('\n');

    catalogSections.push(categorySection);
  }

  // Final catalog with header and footer
  const finalCatalog = [
    `🛍️ **PRODUCT CATALOG** 🛍️`,
    ``,
    `Welcome to our exclusive collection! Here's what we have available:`,
    ``,
    `════════════════════════════════════════`,
    ``,
    ...catalogSections,
    ``
  
  ].join('\n');

  return finalCatalog;
}

// Smart catalog builder that chooses format based on user intent
function buildSmartCatalog(userMessage, products = []) {
  const intent = detectCatalogIntent(userMessage);
  
  switch (intent) {
    case 'detailed':
      return buildAdvancedCatalog(userMessage, products, CATALOG_CFG);
    case 'medium':
      // Medium detail - more products but fewer variants
      const mediumCfg = {
        ...CATALOG_CFG,
        maxProductsPerTag: 4,
        maxVariantsPerProduct: 1
      };
      return buildAdvancedCatalog(userMessage, products, mediumCfg);
    case 'compact':
    default:
      return buildCompactCatalog(userMessage, products, COMPACT_CATALOG_CFG);
  }
}

module.exports = {
  buildAdvancedCatalog,
  buildCompactCatalog,
  buildSmartCatalog,
  CATALOG_CFG,
  COMPACT_CATALOG_CFG
};
