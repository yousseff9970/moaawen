// Simplified catalog builder - let AI handle the intelligence

function safeText(x, max = 220) {
  if (!x) return '';
  const s = String(x).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function priceNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Build comprehensive product data for AI to analyze
function buildProductDatabase(products = []) {
  // Always return an array (never a string)
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  const toStr = (v) => v == null ? "" : String(v).trim();
  const toNum = (v) => {
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const productDatabase = products.map((product) => {
    // Only include variants that are in stock (undefined => treated as in stock)
    const variants = (product.variants || [])
      .filter((variant) => variant.inStock !== false)
      .map((variant) => {
        const dp = toNum(variant.discountedPrice);
        const op = toNum(variant.originalPrice);

        // Build a consistent, human-readable name
        const computedName = variant.variantName ||
          [variant.option1, variant.option2, variant.option3]
            .filter(Boolean)
            .join(" / ") ||
          "Standard";

        return {
          // 🔒 IDs normalized to strings
          id: toStr(variant.id),
          // keep both raw + lc for matching
          name: computedName,
          name_lc: toStr(computedName).toLowerCase(),
          option1: toStr(variant.option1) || null,
          option2: toStr(variant.option2) || null,
          option3: toStr(variant.option3) || null,
          option1_lc: toStr(variant.option1).toLowerCase() || null,
          option2_lc: toStr(variant.option2).toLowerCase() || null,
          option3_lc: toStr(variant.option3).toLowerCase() || null,

          price: dp,
          originalPrice: op,
          isDiscounted: Boolean(variant.isDiscounted),
          savings: (variant.isDiscounted && op && dp) ? Number((op - dp).toFixed(2)) : 0,

          sku: toStr(variant.sku) || null,
          barcode: toStr(variant.barcode) || null,
          weight: toNum(variant.weight) || 0,
          inStock: variant.inStock !== false,
        };
      });

    // Skip products with no in-stock variants
    if (variants.length === 0) return null;

    const prices = variants.map(v => v.price).filter(n => Number.isFinite(n));
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;

    const title = toStr(product.title);
    return {
      // 🔒 Product ID normalized to string
      id: toStr(product.id),
      title,
      title_lc: title.toLowerCase(),

      description: safeText(product.description, 200),
      vendor: toStr(product.vendor) || null,
      type: toStr(product.type) || null,
      tags: Array.isArray(product.tags) ? product.tags : [],

      minPrice,
      maxPrice,
      totalVariants: variants.length,
      hasDiscounts: variants.some(v => v.isDiscounted),

      variants,
    };
  }).filter(Boolean);

  return productDatabase;
}


// Format product database as structured text for AI
function formatProductDatabaseForAI(productDatabase) {
  if (!productDatabase || productDatabase.length === 0) {
    return "No products available.";
  }

  let output = "=== COMPLETE PRODUCT & VARIANT DATABASE ===\n\n";
  
  productDatabase.forEach((product, index) => {
    output += `PRODUCT ${index + 1}: ${product.title}\n`;
    output += `ID: ${product.id}\n`;
    output += `TAGS: ${product.tags || 'N/A'}\n`;
    output += `DESCRIPTION: ${product.description || 'No description'}\n`;
    output += `PRICE RANGE: ${product.minPrice && product.maxPrice 
      ? (product.minPrice === product.maxPrice 
        ? `$${product.minPrice}` 
        : `$${product.minPrice} - $${product.maxPrice}`)
      : 'Contact for pricing'}\n`;
    output += `VARIANTS AVAILABLE: ${product.totalVariants}\n`;
    output += `HAS DISCOUNTS: ${product.hasDiscounts ? 'Yes' : 'No'}\n\n`;

    if (product.variants.length > 0) {
      output += `VARIANTS:\n`;
      product.variants.forEach((variant, vIndex) => {
        output += `  ${vIndex + 1}. ${variant.name}\n`;
        if (variant.option1) output += `     Color/Option1: ${variant.option1}\n`;
        if (variant.option2) output += `     Size/Option2: ${variant.option2}\n`;
        if (variant.option3) output += `     Material/Option3: ${variant.option3}\n`;
        output += `     Price: ${variant.price ? `$${variant.price}` : 'Contact for price'}`;
        if (variant.isDiscounted && variant.originalPrice) {
          output += ` (was $${variant.originalPrice}, save $${variant.savings})`;
        }
        output += `\n`;
        if (variant.sku) output += `     SKU: ${variant.sku}\n`;
        output += `\n`;
      });
    }
    
    output += "---\n\n";
  });

  return output;
}

// Simple category grouping for AI context
function groupProductsByCategory(productDatabase) {
  const categories = {};
  
  productDatabase.forEach(product => {
    const category = product.type || 'Other';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(product);
  });

  let output = "=== PRODUCT CATEGORIES ===\n\n";
  
  Object.entries(categories).forEach(([category, products]) => {
    const totalProducts = products.length;
    const onSaleProducts = products.filter(p => p.hasDiscounts).length;
    
    output += `${category.toUpperCase()}: ${totalProducts} products available, ${onSaleProducts} on sale\n`;
    
    products.forEach(product => {
      output += `  - ${product.title} (${product.totalVariants} variants available)\n`;
    });
    output += `\n`;
  });

  return output;
}

module.exports = {
  buildProductDatabase,
  formatProductDatabaseForAI,
  groupProductsByCategory
};
    