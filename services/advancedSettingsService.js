// services/advancedSettingsService.js
const  getDb  = require('../db');
const { ObjectId } = require('mongodb');

/**
 * Get advanced settings for a business
 */
async function getBusinessAdvancedSettings(businessId) {
  try {
    const db = await getDb();
    const businessesCol = db.collection('businesses');
    
    const business = await businessesCol.findOne(
      { _id: new ObjectId(businessId) },
      { projection: { 'settings.advanced': 1 } }
    );
    
    return business?.settings?.advanced || null;
  } catch (error) {
    console.error('Error getting business advanced settings:', error);
    return null;
  }
}

/**
 * Apply advanced settings to AI personality and behavior
 */
function applyAdvancedSettingsToPrompt(advancedSettings, basePrompt) {
  if (!advancedSettings) {
    return basePrompt;
  }

  let enhancedPrompt = basePrompt;

  // Apply AI Personality Settings
  if (advancedSettings.aiPersonality?.tone) {
    const toneInstructions = getToneInstructions(advancedSettings.aiPersonality.tone);
    enhancedPrompt += `\n\n**AI PERSONALITY & TONE:**\n${toneInstructions}`;
  }

  // Apply Response Length Preference
  if (advancedSettings.responses?.lengthPreference) {
    const lengthInstructions = getLengthInstructions(advancedSettings.responses.lengthPreference);
    enhancedPrompt += `\n\n**RESPONSE LENGTH:**\n${lengthInstructions}`;
  }

  // Apply Language Preference
  if (advancedSettings.language?.default) {
    const languageInstructions = getLanguageInstructions(advancedSettings.language.default);
    enhancedPrompt += `\n\n**LANGUAGE PREFERENCE:**\n${languageInstructions}`;
  }

  // Apply Feature Restrictions
  const featureRestrictions = getFeatureRestrictions(advancedSettings.features);
  if (featureRestrictions) {
    enhancedPrompt += `\n\n**FEATURE RESTRICTIONS:**\n${featureRestrictions}`;
  }

  return enhancedPrompt;
}

/**
 * Get tone-specific instructions
 */
function getToneInstructions(tone) {
  const toneMap = {
    formal: `
- Use professional, respectful, and courteous language
- Address customers with formal greetings and closings
- Avoid colloquialisms, slang, or overly casual expressions
- Maintain a business-appropriate tone throughout conversations
- Use proper grammar and complete sentences
- Example: "Good day! I would be delighted to assist you with your inquiry today."`,
    
    casual: `
- Use friendly, conversational, and approachable language
- Feel free to use common expressions and everyday language
- Be warm and personable while maintaining professionalism
- Use contractions and natural speech patterns
- Example: "Hey there! I'd love to help you out with that!"`,
    
    playful: `
- Use fun, engaging, and energetic language
- Include appropriate emojis and enthusiasm in responses
- Be creative with expressions while staying helpful
- Use humor when appropriate (but never offensive)
- Make interactions enjoyable and memorable
- Example: "Hey! 🎉 That's awesome - let me help you find exactly what you're looking for!"`,
    
    concise: `
- Keep responses brief and to the point
- Focus on essential information only
- Avoid unnecessary explanations or elaborations
- Use bullet points or short sentences when possible
- Be direct while remaining helpful and polite
- Example: "Sure! Here are 3 options that match your needs:"`
  };
  
  return toneMap[tone] || toneMap.casual;
}

/**
 * Get response length instructions
 */
function getLengthInstructions(lengthPreference) {
  const lengthMap = {
    short: `
- Keep responses under 2-3 sentences when possible
- Focus on the most essential information
- Use bullet points for lists to save space
- Avoid detailed explanations unless specifically requested
- Be direct and efficient with your communication`,
    
    medium: `
- Aim for balanced responses (3-5 sentences typically)
- Provide sufficient detail without overwhelming
- Include context when helpful but stay focused
- Use examples when they add value to the explanation
- Strike a balance between thorough and concise`,
    
    long: `
- Provide comprehensive and detailed responses
- Include context, examples, and thorough explanations
- Anticipate follow-up questions and address them proactively
- Use detailed descriptions and step-by-step guidance when helpful
- Prioritize completeness and thoroughness in your answers`
  };
  
  return lengthMap[lengthPreference] || lengthMap.medium;
}

/**
 * Get language preference instructions
 */
function getLanguageInstructions(defaultLanguage) {
  const languageMap = {
    english: `
- Primarily respond in English unless the customer specifically uses another language
- If a customer writes in Arabic/Lebanese, you may respond in their language but default to English
- Use clear, international English that's easy to understand`,
    
    arabic: `
- Primarily respond in Arabic unless the customer specifically uses English
- Feel comfortable switching between Arabic, Lebanese dialect, and English as needed
- Use appropriate Arabic greetings and expressions (مرحبا، أهلاً وسهلاً، etc.)
- If technical terms are better explained in English, it's okay to use them`
  };
  
  return languageMap[defaultLanguage] || languageMap.english;
}

/**
 * Get feature restriction instructions
 */
function getFeatureRestrictions(features) {
  const restrictions = [];
  
  if (features?.voicesEnabled === false) {
    restrictions.push('- Voice message processing is DISABLED for this business. Do not reference or encourage voice messages.');
  }
  
  if (features?.imagesEnabled === false) {
    restrictions.push('- Image analysis is DISABLED for this business. Do not reference or encourage image sharing for analysis.');
  }
  
  if (restrictions.length === 0) {
    return null;
  }
  
  return restrictions.join('\n');
}

/**
 * Check if a feature is enabled for a business
 */
function isFeatureEnabled(advancedSettings, featureName) {
  if (!advancedSettings?.features) {
    return true; // Default to enabled if no settings
  }
  
  return advancedSettings.features[featureName] !== false;
}

/**
 * Check if a channel is enabled for a business
 */
function isChannelEnabled(advancedSettings, channelName) {
  if (!advancedSettings?.channels) {
    return true; // Default to enabled if no settings
  }
  
  return advancedSettings.channels[channelName] !== false;
}

/**
 * Get conversation auto-clear duration in milliseconds
 */
function getConversationClearDuration(advancedSettings) {
  const duration = advancedSettings?.conversations?.autoClearAfter || '24hours';
  
  const durationMap = {
    '30mins': 30 * 60 * 1000,
    '2hours': 2 * 60 * 60 * 1000,
    '8hours': 8 * 60 * 60 * 1000,
    '24hours': 24 * 60 * 60 * 1000,
    '1week': 7 * 24 * 60 * 60 * 1000
  };
  
  return durationMap[duration] || durationMap['24hours'];
}

module.exports = {
  getBusinessAdvancedSettings,
  applyAdvancedSettingsToPrompt,
  isFeatureEnabled,
  isChannelEnabled,
  getConversationClearDuration
};
