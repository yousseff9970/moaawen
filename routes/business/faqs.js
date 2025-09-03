// routes/business/faqs.js
const { express, getDb, ObjectId, authMiddleware, requireVerified } = require('./shared');
const router = express.Router();

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

module.exports = router;
