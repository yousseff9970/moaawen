const getDb = require('../db');
const { ObjectId } = require('mongodb'); // use the driver's ObjectId

function normalizeId(id) {
  if (id instanceof ObjectId) return id;
  // 24-hex string → ObjectId
  if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) {
    return new ObjectId(id);
  }
  // fallback (string _id documents)
  return id;
}

async function trackUsage(businessId, type, amount = 1) {
  if (!businessId || !type) return;

  const fieldMap = {
    message: 'settings.usedMessages',
    voice: 'settings.usedVoiceMinutes',
    image: 'settings.imageAnalysesUsed',
  };
  const field = fieldMap[type];
  if (!field) {
    console.warn(`[trackUsage] Unknown type "${type}"`);
    return;
  }

  // coerce amount to a safe number
  const incBy = Number(amount);
  if (!Number.isFinite(incBy)) {
    console.warn(`[trackUsage] Non-numeric amount "${amount}"`);
    return;
  }

  try {
    const db = await getDb();
    const businesses = db.collection('businesses');

    const _idObj = normalizeId(businessId);

    // 1) Ensure the target field is numeric (or create it) if present but wrong type
    const doc = await businesses.findOne(
      { _id: _idObj },
      { projection: { [field]: 1 } }
    );

    if (!doc) {
      // Try alternate match if _id stored as string and businessId looked like ObjectId
      if (_idObj instanceof ObjectId) {
        const alt = await businesses.findOne(
          { _id: String(businessId) },
          { projection: { [field]: 1 } }
        );
        if (!alt) {
          console.warn(`[trackUsage] No business matched _id=${businessId}`);
          return;
        }
        // switch filter to string id
        await businesses.updateOne(
          { _id: String(businessId) },
          { $inc: { [field]: incBy }, $currentDate: { updatedAt: true } }
        );
        console.log(`✅ Tracked usage for business ${businessId} (str _id): +${incBy} ${type}`);
        return;
      }
      console.warn(`[trackUsage] No business matched _id=${businessId}`);
      return;
    }

    const current = doc?.settings?.usedMessages; // not reliable for other fields; we’ll check generic
    const val = field.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), doc);

    if (val !== undefined && typeof val !== 'number') {
      // fix bad type so $inc won’t fail
      const setRes = await businesses.updateOne(
        { _id: _idObj },
        { $set: { [field]: 0 } }
      );
      if (setRes.matchedCount === 0) {
        console.warn(`[trackUsage] Failed to normalize field for _id=${businessId}`);
        return;
      }
    }

    // 2) Increment atomically
    const res = await businesses.updateOne(
      { _id: _idObj },
      { $inc: { [field]: incBy }, $currentDate: { updatedAt: true } }
    );

    if (!res.matchedCount) {
      console.warn(`[trackUsage] No match on increment for _id=${businessId}`);
      return;
    }
    if (!res.modifiedCount) {
      console.warn(`[trackUsage] Matched but not modified for _id=${businessId} (value may be unchanged)`);
      return;
    }

    console.log(`✅ Tracked usage for business ${businessId}: +${incBy} ${type}`);
  } catch (err) {
    console.error('❌ Usage tracking error:', err);
  }
}

module.exports = { trackUsage };
