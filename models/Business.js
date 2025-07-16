const VariantSchema = new mongoose.Schema({
  id: Number,
  sku: String,
  price: String,
  compareAt: String,
  weight: Number,
  barcode: String,
  inventoryItemId: Number,
  inStock: Boolean
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
  faqs: [{
    question: String,
    answer: String
  }],
  files: [String],
  image_urls: [String]
}, { timestamps: true });

module.exports = mongoose.model('Business', BusinessSchema);
