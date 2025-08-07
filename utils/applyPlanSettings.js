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
    maxMessages: config.maxMessages,
    usedMessages: 0,
    allowedChannels: config.allowedChannels,
    enabledChannels: {
      whatsapp: true,
      instagram: false,
      messenger: false
    },
    languages: config.languages,
    voiceMinutes: config.voiceMinutes || 0,
    usedVoiceMinutes: 0,
    features: config.features
  };
}

module.exports = { generateSettingsFromPlan };
