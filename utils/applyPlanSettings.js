// utils/applyPlanSettings.js
const planSettings = require('./PlanSettings');

/**
 * Generate business settings based on a plan name
 * @param {string} plan - One of: "starter", "growth", "scale", "enterprise"
 * @returns {object} settings
 */
function generateSettingsFromPlan(plan = 'starter') {
  const config = planSettings[plan] || planSettings['starter'];

  return {
    currentPlan: plan,
    planDetails: {
      name: config.name,
      originalPriceMonthly: config.originalPriceMonthly,
      priceMonthly: config.priceMonthly,
      originalPriceYearly: config.originalPriceYearly,
      priceYearly: config.priceYearly,
      popular: config.popular || false,
      enterprise: config.enterprise || false
    },
    limits: {
      maxMessages: config.maxMessages,
      usedMessages: 0,
      allowedChannels: config.allowedChannels,
      languages: config.languages,
      voiceMinutes: config.voiceMinutes || 0,
      usedVoiceMinutes: 0,
      aiImageProcessing: config.aiImageProcessing || 0,
      usedAiImageProcessing: 0
    },
    enabledChannels: {
      whatsapp: true,
      instagram: false,
      messenger: false,
      website: false,
      telegram: false
    },
    features: {
      ...config.features
    }
  };
}

/**
 * Check if a business can use a specific feature based on their plan
 * @param {object} businessSettings - Business settings object
 * @param {string} featureName - Name of the feature to check
 * @returns {boolean} Whether the feature is available
 */
function canUseFeature(businessSettings, featureName) {
  return businessSettings?.features?.[featureName] === true;
}

/**
 * Check if a business has reached their message limit
 * @param {object} businessSettings - Business settings object
 * @returns {boolean} Whether the message limit is reached
 */
function hasReachedMessageLimit(businessSettings) {
  return businessSettings?.limits?.usedMessages >= businessSettings?.limits?.maxMessages;
}

/**
 * Check if a business has reached their voice minutes limit
 * @param {object} businessSettings - Business settings object
 * @returns {boolean} Whether the voice minutes limit is reached
 */
function hasReachedVoiceLimit(businessSettings) {
  return businessSettings?.limits?.usedVoiceMinutes >= businessSettings?.limits?.voiceMinutes;
}

/**
 * Check if a business has reached their AI image processing limit
 * @param {object} businessSettings - Business settings object
 * @returns {boolean} Whether the AI image processing limit is reached
 */
function hasReachedImageProcessingLimit(businessSettings) {
  return businessSettings?.limits?.usedAiImageProcessing >= businessSettings?.limits?.aiImageProcessing;
}

/**
 * Increment usage counters
 * @param {object} businessSettings - Business settings object
 * @param {string} type - Type of usage: 'messages', 'voiceMinutes', 'aiImageProcessing'
 * @param {number} amount - Amount to increment
 * @returns {object} Updated business settings
 */
function incrementUsage(businessSettings, type, amount = 1) {
  const updatedSettings = { ...businessSettings };
  
  switch (type) {
    case 'messages':
      updatedSettings.limits.usedMessages = Math.min(
        updatedSettings.limits.usedMessages + amount,
        updatedSettings.limits.maxMessages
      );
      break;
    case 'voiceMinutes':
      updatedSettings.limits.usedVoiceMinutes = Math.min(
        updatedSettings.limits.usedVoiceMinutes + amount,
        updatedSettings.limits.voiceMinutes
      );
      break;
    case 'aiImageProcessing':
      updatedSettings.limits.usedAiImageProcessing = Math.min(
        updatedSettings.limits.usedAiImageProcessing + amount,
        updatedSettings.limits.aiImageProcessing
      );
      break;
  }
  
  return updatedSettings;
}

module.exports = { 
  generateSettingsFromPlan,
  canUseFeature,
  hasReachedMessageLimit,
  hasReachedVoiceLimit,
  hasReachedImageProcessingLimit,
  incrementUsage
};
