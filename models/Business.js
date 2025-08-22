const mongoose = require('mongoose');

const VariantSchema = new mongoose.Schema({
  id: Number,
  sku: String,
  discountedPrice: String,        // Changed from 'price' to match shopifyClient
  originalPrice: String,          // Changed from 'compareAt' to match shopifyClient
  isDiscounted: Boolean,          // Added field from shopifyClient
  weight: Number,
  barcode: String,
  inventoryItemId: Number,        // Changed from 'inventoryItemId' to match shopifyClient
  inStock: Boolean,               // This should be per-variant
  option1: String,                // Added Shopify variant options
  option2: String,
  option3: String,
  variantName: String,            // Added computed variant name
  image: String,                  // Added variant image URL
  inventoryManagement: String,    // Added for inventory tracking
  inventoryPolicy: String,        // Added for inventory policy
  inventoryQuantity: Number       // Added for exact quantity tracking
}, { _id: false });

const ImageSchema = new mongoose.Schema({
  id: Number,
  src: String,
  alt: String,
  position: Number
}, { _id: false });

const ProductSchema = new mongoose.Schema({
  id: Number,
  title: String,
  description: String,
  vendor: String,
  type: String,
  tags: String,
  images: [ImageSchema],
  variants: [VariantSchema]
}, { _id: false });

const BusinessSchema = new mongoose.Schema({
  name: String,
  shop: String,
  accessToken: String,
  website: String,
  description: String,
  contact: {
    phone: String,
    email: String,
    whatsapp: String,
    instagram: String
  },
  channels: {
    whatsapp: { phone_number_id: String },
    instagram: { page_id: String },
    messenger: { page_id: String }
  },
  products: [ProductSchema],
  collections: [{                 // Added collections array
    id: mongoose.Schema.Types.Mixed,
    title: String,
    products: [ProductSchema]
  }],
  faqs: [{
    question: String,
    answer: String
  }],
  files: [String],
  image_urls: [String],
  settings: mongoose.Schema.Types.Mixed,  // Added settings
  status: String,                         // Added status
  expiresAt: Date                        // Added expiration
}, { timestamps: true });

module.exports = mongoose.model('Business', BusinessSchema);
