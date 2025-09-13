// utils/businessPolicy.js
const planSettings = require('./PlanSettings');
const { canUseFeature, hasReachedMessageLimit, hasReachedVoiceLimit, hasReachedImageProcessingLimit } = require('./applyPlanSettings');

/**
 * Business Policy System
 * Comprehensive access control for business features, limits, and permissions
 */

// ================== EXPIRATION CHECKS ==================

/**
 * Check if business subscription is expired
 * @param {object} business - Business object
 * @returns {boolean} True if expired
 */
function isExpired(business) {
  if (!business.expiresAt && !business.subscriptionEndDate) return false;
  
  const expiryDate = new Date(business.expiresAt || business.subscriptionEndDate);
  return expiryDate < new Date();
}

/**
 * Check if business will expire soon (within specified days)
 * @param {object} business - Business object
 * @param {number} days - Days ahead to check (default: 7)
 * @returns {boolean} True if expiring soon
 */
function isExpiringSoon(business, days = 7) {
  if (!business.expiresAt && !business.subscriptionEndDate) return false;
  
  const expiryDate = new Date(business.expiresAt || business.subscriptionEndDate);
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + days);
  
  return expiryDate <= warningDate && expiryDate > new Date();
}

// ================== STATUS CHECKS ==================

/**
 * Check if business is inactive
 * @param {object} business - Business object
 * @returns {boolean} True if inactive
 */
function isInactive(business) {
  return business.status && business.status !== 'active';
}

/**
 * Check if business is suspended
 * @param {object} business - Business object
 * @returns {boolean} True if suspended
 */
function isSuspended(business) {
  return business.status === 'suspended';
}

/**
 * Check if business is in trial period
 * @param {object} business - Business object
 * @returns {boolean} True if in trial
 */
function isInTrial(business) {
  return business.status === 'trial' || !business.subscriptionEndDate;
}

// ================== USAGE LIMIT CHECKS ==================

/**
 * Check if business has reached message limit
 * @param {object} business - Business object
 * @returns {object} { exceeded: boolean, used: number, limit: number, percentage: number }
 */
function checkMessageLimit(business) {
  const used = business.settings?.limits?.usedMessages || business.settings?.usedMessages || 0;
  const limit = business.settings?.limits?.maxMessages || business.settings?.maxMessages || 0;
  
  return {
    exceeded: used >= limit,
    used,
    limit,
    percentage: limit > 0 ? (used / limit) * 100 : 0
  };
}

/**
 * Check if business has reached voice minutes limit
 * @param {object} business - Business object
 * @returns {object} { exceeded: boolean, used: number, limit: number, percentage: number }
 */
function checkVoiceLimit(business) {
  const used = business.settings?.limits?.usedVoiceMinutes || business.settings?.usedVoiceMinutes || 0;
  const limit = business.settings?.limits?.voiceMinutes || business.settings?.voiceMinutes || 0;
  
  return {
    exceeded: limit > 0 && used >= limit, // Only exceeded if there's actually a limit
    used,
    limit,
    percentage: limit > 0 ? (used / limit) * 100 : 0
  };
}

/**
 * Check if business has reached AI image processing limit
 * @param {object} business - Business object
 * @returns {object} { exceeded: boolean, used: number, limit: number, percentage: number }
 */
function checkImageProcessingLimit(business) {
  const used = business.settings?.limits?.usedAiImageProcessing || business.settings?.usedAiImageProcessing || 0;
  const limit = business.settings?.limits?.aiImageProcessing || business.settings?.aiImageProcessing || 0;
  
  return {
    exceeded: used >= limit,
    used,
    limit,
    percentage: limit > 0 ? (used / limit) * 100 : 0
  };
}

/**
 * Check if business has reached channel limit
 * @param {object} business - Business object
 * @returns {object} { exceeded: boolean, used: number, limit: number }
 */
function checkChannelLimit(business) {
  const enabledChannels = business.settings?.enabledChannels || {};
  const used = Object.values(enabledChannels).filter(Boolean).length;
  const limit = business.settings?.limits?.allowedChannels || business.settings?.allowedChannels || 0;
  
  return {
    exceeded: limit > 0 && used >= limit, // Only exceeded if there's actually a limit
    used,
    limit,
    percentage: limit > 0 ? (used / limit) * 100 : 0
  };
}

/**
 * Check language support limit
 * @param {object} business - Business object
 * @param {number} requestedLanguages - Number of languages being requested
 * @returns {object} { allowed: boolean, limit: number }
 */
function checkLanguageLimit(business, requestedLanguages = 1) {
  const limit = business.settings?.limits?.languages || business.settings?.languages || 1;
  
  return {
    allowed: requestedLanguages <= limit,
    limit,
    isMultiLanguage: limit >= 99 // Enterprise level
  };
}

// ================== FEATURE ACCESS CHECKS ==================

/**
 * Check if business has access to a specific feature
 * @param {object} business - Business object
 * @param {string} feature - Feature name
 * @returns {boolean} True if feature is available
 */
function hasFeature(business, feature) {
  return !!business.settings?.features?.[feature];
}

/**
 * Check if business can enable a specific channel
 * @param {object} business - Business object
 * @param {string} channel - Channel name (whatsapp, instagram, messenger, etc.)
 * @returns {boolean} True if channel can be enabled
 */
function canEnableChannel(business, channel) {
  const channelCheck = checkChannelLimit(business);
  const isCurrentlyEnabled = business.settings?.enabledChannels?.[channel];
  
  // If already enabled, allow
  if (isCurrentlyEnabled) return true;
  
  // If under limit, allow
  return !channelCheck.exceeded;
}

/**
 * Check e-commerce integration access
 * @param {object} business - Business object
 * @param {string} platform - Platform name (shopify, woocommerce, etc.)
 * @returns {boolean} True if integration is allowed
 */
function canUseEcommerce(business, platform = 'shopify') {
  const hasShopifySync = hasFeature(business, 'shopifySync');
  const hasWooCommerceSync = hasFeature(business, 'wooCommerceSync');
  
  switch (platform.toLowerCase()) {
    case 'shopify':
      return hasShopifySync;
    case 'woocommerce':
      return hasWooCommerceSync;
    default:
      return hasShopifySync || hasWooCommerceSync;
  }
}

// ================== PLAN-SPECIFIC CHECKS ==================

/**
 * Get current plan information
 * @param {object} business - Business object
 * @returns {object} Plan configuration
 */
function getCurrentPlan(business) {
  const planName = business.settings?.currentPlan || business.plan || 'starter';
  return {
    name: planName,
    config: planSettings[planName] || planSettings.starter,
    details: business.settings?.planDetails || {}
  };
}

/**
 * Check if business can upgrade/downgrade to a specific plan
 * @param {object} business - Business object
 * @param {string} targetPlan - Target plan name
 * @returns {object} { allowed: boolean, reasons: string[] }
 */
function canChangePlan(business, targetPlan) {
  const reasons = [];
  const currentPlan = getCurrentPlan(business);
  
  if (!planSettings[targetPlan]) {
    reasons.push('invalid_plan');
  }
  
  if (isExpired(business)) {
    reasons.push('expired_subscription');
  }
  
  if (isSuspended(business)) {
    reasons.push('suspended_account');
  }
  
  // Check if downgrading would exceed new limits
  if (planSettings[targetPlan]) {
    const targetConfig = planSettings[targetPlan];
    const messageCheck = checkMessageLimit(business);
    const voiceCheck = checkVoiceLimit(business);
    const imageCheck = checkImageProcessingLimit(business);
    
    if (messageCheck.used > targetConfig.maxMessages) {
      reasons.push('exceeds_message_limit');
    }
    
    if (voiceCheck.used > targetConfig.voiceMinutes) {
      reasons.push('exceeds_voice_limit');
    }
    
    if (imageCheck.used > (targetConfig.aiImageProcessing || 0)) {
      reasons.push('exceeds_image_processing_limit');
    }
  }
  
  return {
    allowed: reasons.length === 0,
    reasons,
    currentPlan: currentPlan.name,
    targetPlan
  };
}

// ================== COMPREHENSIVE ACCESS CONTROL ==================

/**
 * Comprehensive access check for any business operation
 * @param {object} business - Business object
 * @param {object} requirements - Access requirements
 * @param {string} requirements.feature - Required feature
 * @param {string} requirements.channel - Required channel
 * @param {number} requirements.messages - Number of messages to consume
 * @param {number} requirements.voiceMinutes - Voice minutes to consume
 * @param {number} requirements.imageProcessing - AI image processing to consume
 * @param {number} requirements.languages - Number of languages required
 * @param {string} requirements.ecommerce - E-commerce platform
 * @param {boolean} requirements.skipUsageCheck - Skip usage limit checks
 * @returns {object} Comprehensive access result
 */
function checkAccess(business, requirements = {}) {
  const result = {
    allowed: true,
    reasons: [],
    warnings: [],
    limits: {},
    plan: getCurrentPlan(business)
  };

  // ============ CRITICAL CHECKS (Always block if failed) ============
  
  if (isExpired(business)) {
    result.allowed = false;
    result.reasons.push('subscription_expired');
  }
  
  if (isSuspended(business)) {
    result.allowed = false;
    result.reasons.push('account_suspended');
  }
  
  if (isInactive(business)) {
    result.allowed = false;
    result.reasons.push('account_inactive');
  }

  // ============ FEATURE ACCESS CHECKS ============
  
  if (requirements.feature && !hasFeature(business, requirements.feature)) {
    result.allowed = false;
    result.reasons.push(`feature_not_available:${requirements.feature}`);
  }
  
  if (requirements.channel && !canEnableChannel(business, requirements.channel)) {
    result.allowed = false;
    result.reasons.push(`channel_limit_exceeded:${requirements.channel}`);
  }
  
  if (requirements.ecommerce && !canUseEcommerce(business, requirements.ecommerce)) {
    result.allowed = false;
    result.reasons.push(`ecommerce_not_available:${requirements.ecommerce}`);
  }

  // ============ LANGUAGE CHECKS ============
  
  if (requirements.languages) {
    const langCheck = checkLanguageLimit(business, requirements.languages);
    if (!langCheck.allowed) {
      result.allowed = false;
      result.reasons.push(`language_limit_exceeded:${requirements.languages}>${langCheck.limit}`);
    }
    result.limits.languages = langCheck;
  }

  // ============ USAGE LIMIT CHECKS ============
  
  if (!requirements.skipUsageCheck) {
    // Message limit checks
    const messageCheck = checkMessageLimit(business);
    result.limits.messages = messageCheck;
    
    if (requirements.messages && (messageCheck.used + requirements.messages > messageCheck.limit)) {
      result.allowed = false;
      result.reasons.push('message_limit_would_exceed');
    } else if (messageCheck.exceeded) {
      result.allowed = false;
      result.reasons.push('message_limit_exceeded');
    }
    
    // Voice limit checks
    const voiceCheck = checkVoiceLimit(business);
    result.limits.voice = voiceCheck;
    
    if (requirements.voiceMinutes && (voiceCheck.used + requirements.voiceMinutes > voiceCheck.limit)) {
      result.allowed = false;
      result.reasons.push('voice_limit_would_exceed');
    } else if (voiceCheck.exceeded && requirements.voiceMinutes) {
      result.allowed = false;
      result.reasons.push('voice_limit_exceeded');
    }
    
    // Image processing limit checks
    const imageCheck = checkImageProcessingLimit(business);
    result.limits.imageProcessing = imageCheck;
    
    if (requirements.imageProcessing && (imageCheck.used + requirements.imageProcessing > imageCheck.limit)) {
      result.allowed = false;
      result.reasons.push('image_processing_limit_would_exceed');
    } else if (imageCheck.exceeded && requirements.imageProcessing) {
      result.allowed = false;
      result.reasons.push('image_processing_limit_exceeded');
    }
  }

  // ============ WARNING CHECKS (Don't block, but warn) ============
  
  if (isExpiringSoon(business)) {
    result.warnings.push('subscription_expiring_soon');
  }
  
  if (result.limits.messages?.percentage >= 90) {
    result.warnings.push('message_limit_warning');
  }
  
  if (result.limits.voice?.percentage >= 90) {
    result.warnings.push('voice_limit_warning');
  }
  
  if (result.limits.imageProcessing?.percentage >= 90) {
    result.warnings.push('image_processing_limit_warning');
  }

  return result;
}

/**
 * Quick feature check - simplified version for common use cases
 * @param {object} business - Business object
 * @param {string} feature - Feature name
 * @returns {boolean} True if feature is accessible
 */
function quickFeatureCheck(business, feature) {
  if (isExpired(business) || isSuspended(business) || isInactive(business)) {
    return false;
  }
  
  return hasFeature(business, feature);
}

/**
 * Get business usage summary
 * @param {object} business - Business object
 * @returns {object} Complete usage summary
 */
function getUsageSummary(business) {
  return {
    plan: getCurrentPlan(business),
    status: {
      active: !isInactive(business),
      expired: isExpired(business),
      suspended: isSuspended(business),
      trial: isInTrial(business),
      expiringSoon: isExpiringSoon(business)
    },
    limits: {
      messages: checkMessageLimit(business),
      voice: checkVoiceLimit(business),
      imageProcessing: checkImageProcessingLimit(business),
      channels: checkChannelLimit(business),
      languages: checkLanguageLimit(business, 1)
    },
    features: business.settings?.features || {},
    enabledChannels: business.settings?.enabledChannels || {}
  };
}

// ================== EXPORTS ==================

module.exports = {
  // Expiration checks
  isExpired,
  isExpiringSoon,
  
  // Status checks
  isInactive,
  isSuspended,
  isInTrial,
  
  // Usage limit checks
  checkMessageLimit,
  checkVoiceLimit,
  checkImageProcessingLimit,
  checkChannelLimit,
  checkLanguageLimit,
  
  // Feature access checks
  hasFeature,
  canEnableChannel,
  canUseEcommerce,
  
  // Plan management
  getCurrentPlan,
  canChangePlan,
  
  // Comprehensive access control
  checkAccess,
  quickFeatureCheck,
  getUsageSummary,
  
  // Legacy support (deprecated but maintained for backward compatibility)
  isOverMessageLimit: (business) => checkMessageLimit(business).exceeded,
  isOverVoiceLimit: (business) => checkVoiceLimit(business).exceeded,
  isChannelEnabled: (business, channel) => !!business.settings?.enabledChannels?.[channel]
};
