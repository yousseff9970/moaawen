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
  if (!products || products.length === 0) {
    return "No products available.";
  }

  const productDatabase = products.map(product => {
    // Only include variants that are in stock
    const variants = (product.variants || [])
      .filter(variant => variant.inStock !== false) // Exclude out of stock variants
      .map(variant => {
        const dp = priceNum(variant.discountedPrice);
        const op = priceNum(variant.originalPrice);
        
        return {
          id: variant.id,
          name: variant.variantName || [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || 'Standard',
          option1: variant.option1,
          option2: variant.option2,
          option3: variant.option3,
          price: dp,
          originalPrice: op,
          isDiscounted: variant.isDiscounted,
          savings: variant.isDiscounted && op && dp ? (op - dp).toFixed(2) : 0,
          sku: variant.sku,
          barcode: variant.barcode,
          weight: variant.weight
        };
      });

    // Skip products that have no in-stock variants
    if (variants.length === 0) {
      return null;
    }

    // Calculate product-level aggregates
    const prices = variants.map(v => v.price).filter(Boolean);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const totalVariants = variants.length;
    const hasDiscounts = variants.some(v => v.isDiscounted);

    return {
      id: product.id,
      title: product.title,
      description: safeText(product.description, 200),
      vendor: product.vendor,
      type: product.type,
      tags: product.tags,
      minPrice,
      maxPrice,
      totalVariants,
      hasDiscounts,
      variants
    };
  }).filter(Boolean); // Remove null products (those with no in-stock variants)

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
    