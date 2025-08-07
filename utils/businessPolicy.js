function isExpired(business) {
  return business.expiresAt && new Date(business.expiresAt) < new Date();
}

function isInactive(business) {
  return business.status && business.status !== 'active';
}

function isOverMessageLimit(business) {
  return (
    (business.settings?.usedMessages || 0) >=
    (business.settings?.maxMessages || Infinity)
  );
}

function isOverVoiceLimit(business) {
  return (
    (business.settings?.usedVoiceMinutes || 0) >=
    (business.settings?.voiceMinutes || Infinity)
  );
}

function hasFeature(business, feature) {
  return !!business.settings?.features?.[feature];
}

function isChannelEnabled(business, channel) {
  return !!business.settings?.enabledChannels?.[channel];
}

/**
 * Check overall access based on all relevant policies
 * @param {object} business - Business object
 * @param {object} requirements - { messages, voiceMinutes, feature, channel }
 * @returns {object} { allowed: boolean, reasons: string[] }
 */
function checkAccess(business, requirements = {}) {
  const reasons = [];

  if (isExpired(business)) reasons.push('expired');
  if (isInactive(business)) reasons.push('inactive');

  if (requirements.messages && isOverMessageLimit(business)) {
    reasons.push('message_limit');
  }

  if (requirements.voiceMinutes && isOverVoiceLimit(business)) {
    reasons.push('voice_limit');
  }

  if (requirements.feature && !hasFeature(business, requirements.feature)) {
    reasons.push(`feature:${requirements.feature}`);
  }

  if (requirements.channel && !isChannelEnabled(business, requirements.channel)) {
    reasons.push(`channel:${requirements.channel}`);
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

module.exports = {
  isExpired,
  isInactive,
  isOverMessageLimit,
  isOverVoiceLimit,
  hasFeature,
  isChannelEnabled,
  checkAccess
};
