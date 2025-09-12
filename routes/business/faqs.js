// routes/business/faqs.js
const { express, getDb, ObjectId, authMiddleware, requireVerified } = require('./shared');
const multer = require('multer');
const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/pdf',
      'text/csv'
    ];
    
    const allowedExtensions = ['.xlsx', '.xls', '.pdf', '.csv'];
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel, CSV, and PDF files are allowed.'));
    }
  }
});

// Helper function to verify business ownership
const verifyBusinessOwnership = async (businessId, userId) => {
  const db = await getDb();
  const usersCol = db.collection('users');
  const businessesCol = db.collection('businesses');

  // Get user data to check ownership
  const user = await usersCol.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('User not found');
  }

  // Find the business
  const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
  if (!business) {
    throw new Error('Business not found');
  }

  // Check ownership using the same logic as main business routes
  let isOwner = false;

  // Method 1: Check if business ID is in user's businesses array
  if (user.businesses && user.businesses.includes(businessId)) {
    isOwner = true;
  }
  // Method 2: Check if business has userId field matching current user
  else if (business.userId && business.userId.toString() === userId) {
    isOwner = true;
  }
  // Method 3: Check if business contact email matches user email
  else if (business.contact?.email && business.contact.email === user.email) {
    isOwner = true;
  }

  if (!isOwner) {
    throw new Error('Access denied. You do not own this business.');
  }

  return { user, business };
};

// Helper function to parse Excel/CSV files
const parseExcelFile = (buffer, originalname) => {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length < 2) {
      throw new Error('File must contain at least a header row and one data row');
    }
    
    const headers = data[0].map(h => h?.toString().toLowerCase().trim());
    const rows = data.slice(1);
    
    // Map common column names
    const columnMap = {
      question: ['question', 'q', 'faq question', 'query'],
      answer: ['answer', 'a', 'faq answer', 'response', 'reply'],
      category: ['category', 'cat', 'type', 'group', 'section'],
      priority: ['priority', 'pri', 'order', 'weight'],
      isActive: ['active', 'is active', 'enabled', 'status', 'published']
    };
    
    // Find column indices
    const findColumnIndex = (fieldNames) => {
      for (const fieldName of fieldNames) {
        const index = headers.findIndex(h => h.includes(fieldName));
        if (index !== -1) return index;
      }
      return -1;
    };
    
    const questionIndex = findColumnIndex(columnMap.question);
    const answerIndex = findColumnIndex(columnMap.answer);
    const categoryIndex = findColumnIndex(columnMap.category);
    const priorityIndex = findColumnIndex(columnMap.priority);
    const activeIndex = findColumnIndex(columnMap.isActive);
    
    if (questionIndex === -1 || answerIndex === -1) {
      throw new Error('File must contain "Question" and "Answer" columns');
    }
    
    const faqs = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      const question = row[questionIndex]?.toString().trim();
      const answer = row[answerIndex]?.toString().trim();
      
      if (!question || !answer) continue; // Skip empty rows
      
      const category = categoryIndex !== -1 ? row[categoryIndex]?.toString().trim() : null;
      const priority = priorityIndex !== -1 ? parseInt(row[priorityIndex]) || 0 : 0;
      
      let isActive = true;
      if (activeIndex !== -1) {
        const activeValue = row[activeIndex]?.toString().toLowerCase().trim();
        isActive = ['true', 'yes', '1', 'active', 'enabled', 'published'].includes(activeValue);
      }
      
      faqs.push({
        question,
        answer,
        category: category || null,
        priority,
        isActive
      });
    }
    
    return faqs;
  } catch (error) {
    throw new Error(`Failed to parse Excel file: ${error.message}`);
  }
};

// Helper function to parse PDF files
const parsePdfFile = async (buffer) => {
  try {
    const data = await pdfParse(buffer);
    const text = data.text;
    
    const faqs = [];
    
    // Try to extract Q&A pairs using common patterns
    const patterns = [
      // Pattern 1: Q: ... A: ...
      /Q:\s*(.+?)\s*A:\s*(.+?)(?=Q:|$)/gi,
      // Pattern 2: Question: ... Answer: ...
      /Question:\s*(.+?)\s*Answer:\s*(.+?)(?=Question:|$)/gi,
      // Pattern 3: Numbered Q&A (1. Q: ... A: ...)
      /\d+\.\s*Q:\s*(.+?)\s*A:\s*(.+?)(?=\d+\.\s*Q:|$)/gi,
      // Pattern 4: FAQ format with line breaks
      /(?:^|\n)(.+\?)\s*\n(.+?)(?=\n.+\?|\n*$)/gm
    ];
    
    let matches = [];
    
    for (const pattern of patterns) {
      const patternMatches = [...text.matchAll(pattern)];
      if (patternMatches.length > 0) {
        matches = patternMatches;
        break;
      }
    }
    
    if (matches.length === 0) {
      // If no structured patterns found, try to split by paragraphs and look for question marks
      const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];
        
        if (line.includes('?') && nextLine && !nextLine.includes('?')) {
          faqs.push({
            question: line.trim(),
            answer: nextLine.trim(),
            category: null,
            priority: 0,
            isActive: true
          });
        }
      }
    } else {
      matches.forEach((match, index) => {
        const question = match[1]?.trim();
        const answer = match[2]?.trim();
        
        if (question && answer) {
          faqs.push({
            question,
            answer,
            category: null,
            priority: 0,
            isActive: true
          });
        }
      });
    }
    
    if (faqs.length === 0) {
      throw new Error('No Q&A pairs found in PDF. Please ensure the PDF contains structured FAQ content.');
    }
    
    return faqs;
  } catch (error) {
    throw new Error(`Failed to parse PDF file: ${error.message}`);
  }
};

// GET /businesses/:businessId/faqs - Get all FAQs for a business
router.get('/:businessId/faqs', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Get all FAQs for this business, sorted by priority (desc) then createdAt (desc)
    const faqs = await faqsCol
      .find({ businessId: new ObjectId(businessId) })
      .sort({ priority: -1, createdAt: -1 })
      .toArray();

    // Transform the data for frontend
    const transformedFaqs = faqs.map(faq => ({
      ...faq,
      _id: faq._id.toString(),
      businessId: faq.businessId.toString()
    }));

    res.json({
      success: true,
      faqs: transformedFaqs
    });

  } catch (error) {
    console.error('Error fetching FAQs:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// POST /businesses/:businessId/faqs - Create a new FAQ
router.post('/:businessId/faqs', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { question, answer, category, isActive = true, priority = 0 } = req.body;

    // Validate required fields
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ error: 'Answer is required' });
    }

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    const currentDate = new Date();

    // Create new FAQ
    const newFaq = {
      businessId: new ObjectId(businessId),
      question: question.trim(),
      answer: answer.trim(),
      category: category?.trim() || null,
      isActive: Boolean(isActive),
      priority: parseInt(priority) || 0,
      createdAt: currentDate,
      updatedAt: currentDate
    };

    const result = await faqsCol.insertOne(newFaq);

    // Return the created FAQ
    const createdFaq = {
      ...newFaq,
      _id: result.insertedId.toString(),
      businessId: businessId
    };

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully',
      faq: createdFaq
    });

  } catch (error) {
    console.error('Error creating FAQ:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to create FAQ' });
  }
});

// PUT /businesses/:businessId/faqs/:faqId - Update an FAQ
router.put('/:businessId/faqs/:faqId', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId, faqId } = req.params;
    const { question, answer, category, isActive, priority } = req.body;

    // Validate required fields
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ error: 'Answer is required' });
    }

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Check if FAQ exists and belongs to this business
    const existingFaq = await faqsCol.findOne({
      _id: new ObjectId(faqId),
      businessId: new ObjectId(businessId)
    });

    if (!existingFaq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    // Prepare update data
    const updateData = {
      question: question.trim(),
      answer: answer.trim(),
      category: category?.trim() || null,
      isActive: Boolean(isActive),
      priority: parseInt(priority) || 0,
      updatedAt: new Date()
    };

    // Update the FAQ
    const result = await faqsCol.updateOne(
      { _id: new ObjectId(faqId) },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'No changes were made' });
    }

    res.json({
      success: true,
      message: 'FAQ updated successfully'
    });

  } catch (error) {
    console.error('Error updating FAQ:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

// DELETE /businesses/:businessId/faqs/:faqId - Delete an FAQ
router.delete('/:businessId/faqs/:faqId', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId, faqId } = req.params;

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Check if FAQ exists and belongs to this business
    const existingFaq = await faqsCol.findOne({
      _id: new ObjectId(faqId),
      businessId: new ObjectId(businessId)
    });

    if (!existingFaq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    // Delete the FAQ
    const result = await faqsCol.deleteOne({
      _id: new ObjectId(faqId),
      businessId: new ObjectId(businessId)
    });

    if (result.deletedCount === 0) {
      return res.status(400).json({ error: 'Failed to delete FAQ' });
    }

    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting FAQ:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

// GET /businesses/:businessId/faqs/:faqId - Get a specific FAQ
router.get('/:businessId/faqs/:faqId', authMiddleware, async (req, res) => {
  try {
    const { businessId, faqId } = req.params;

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Get the specific FAQ
    const faq = await faqsCol.findOne({
      _id: new ObjectId(faqId),
      businessId: new ObjectId(businessId)
    });

    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    // Transform the data for frontend
    const transformedFaq = {
      ...faq,
      _id: faq._id.toString(),
      businessId: faq.businessId.toString()
    };

    res.json({
      success: true,
      faq: transformedFaq
    });

  } catch (error) {
    console.error('Error fetching FAQ:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to fetch FAQ' });
  }
});

// PATCH /businesses/:businessId/faqs/:faqId/toggle - Toggle FAQ active status
router.patch('/:businessId/faqs/:faqId/toggle', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId, faqId } = req.params;

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Check if FAQ exists and belongs to this business
    const existingFaq = await faqsCol.findOne({
      _id: new ObjectId(faqId),
      businessId: new ObjectId(businessId)
    });

    if (!existingFaq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    // Toggle the active status
    const newStatus = !existingFaq.isActive;
    
    const result = await faqsCol.updateOne(
      { _id: new ObjectId(faqId) },
      { 
        $set: { 
          isActive: newStatus,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to toggle FAQ status' });
    }

    res.json({
      success: true,
      message: `FAQ ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    });

  } catch (error) {
    console.error('Error toggling FAQ status:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to toggle FAQ status' });
  }
});

// GET /businesses/:businessId/faqs/stats - Get FAQ statistics
router.get('/:businessId/faqs/stats', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Get aggregated statistics
    const stats = await faqsCol.aggregate([
      { $match: { businessId: new ObjectId(businessId) } },
      {
        $group: {
          _id: null,
          totalFaqs: { $sum: 1 },
          activeFaqs: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          inactiveFaqs: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
          },
          categories: { $addToSet: '$category' }
        }
      },
      {
        $project: {
          _id: 0,
          totalFaqs: 1,
          activeFaqs: 1,
          inactiveFaqs: 1,
          categoriesCount: {
            $size: { $filter: { input: '$categories', cond: { $ne: ['$$this', null] } } }
          },
          categories: { $filter: { input: '$categories', cond: { $ne: ['$$this', null] } } }
        }
      }
    ]).toArray();

    const result = stats[0] || {
      totalFaqs: 0,
      activeFaqs: 0,
      inactiveFaqs: 0,
      categoriesCount: 0,
      categories: []
    };

    res.json({
      success: true,
      stats: result
    });

  } catch (error) {
    console.error('Error fetching FAQ stats:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to fetch FAQ statistics' });
  }
});

// POST /businesses/:businessId/faqs/preview-import - Preview FAQs from uploaded file
router.post('/:businessId/faqs/preview-import', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    let faqs = [];

    if (req.file.mimetype === 'application/pdf') {
      faqs = await parsePdfFile(req.file.buffer);
    } else {
      // Handle Excel/CSV files
      faqs = parseExcelFile(req.file.buffer, req.file.originalname);
    }

    // Validate and clean the parsed FAQs
    const validFaqs = faqs.filter(faq => 
      faq.question && faq.question.trim().length > 0 &&
      faq.answer && faq.answer.trim().length > 0
    ).map(faq => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
      category: faq.category || null,
      priority: parseInt(faq.priority) || 0,
      isActive: Boolean(faq.isActive)
    }));

    res.json({
      success: true,
      faqs: validFaqs,
      total: validFaqs.length,
      fileName: req.file.originalname
    });

  } catch (error) {
    console.error('Error previewing FAQ import:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(400).json({ error: error.message });
  }
});

// POST /businesses/:businessId/faqs/import - Import FAQs from uploaded file
router.post('/:businessId/faqs/import', authMiddleware, requireVerified, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify business ownership
    await verifyBusinessOwnership(businessId, req.user.userId);

    let faqs = [];

    if (req.file.mimetype === 'application/pdf') {
      faqs = await parsePdfFile(req.file.buffer);
    } else {
      // Handle Excel/CSV files
      faqs = parseExcelFile(req.file.buffer, req.file.originalname);
    }

    // Validate and clean the parsed FAQs
    const validFaqs = faqs.filter(faq => 
      faq.question && faq.question.trim().length > 0 &&
      faq.answer && faq.answer.trim().length > 0
    ).map(faq => ({
      businessId: new ObjectId(businessId),
      question: faq.question.trim(),
      answer: faq.answer.trim(),
      category: faq.category || null,
      priority: parseInt(faq.priority) || 0,
      isActive: Boolean(faq.isActive),
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    if (validFaqs.length === 0) {
      return res.status(400).json({ error: 'No valid FAQs found in the file' });
    }

    const db = await getDb();
    const faqsCol = db.collection('faqs');

    // Insert all FAQs
    const result = await faqsCol.insertMany(validFaqs);

    res.json({
      success: true,
      message: `Successfully imported ${result.insertedCount} FAQs`,
      imported: result.insertedCount,
      total: validFaqs.length,
      fileName: req.file.originalname
    });

  } catch (error) {
    console.error('Error importing FAQs:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }

    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
