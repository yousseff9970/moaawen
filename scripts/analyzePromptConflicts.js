// scripts/analyzePromptConflicts.js

/**
 * Simulate the applyAdvancedSettingsToPrompt function for analysis
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

function getToneInstructions(tone) {
  const toneMap = {
    formal: `- Use professional, respectful, and courteous language\n- Address customers with formal greetings and closings`,
    casual: `- Use friendly, conversational, and approachable language\n- Feel free to use common expressions and everyday language`,
    playful: `- Use fun, engaging, and energetic language\n- Include appropriate emojis and enthusiasm in responses`,
    concise: `- Keep responses brief and to the point\n- Focus on essential information only`
  };
  
  return toneMap[tone] || toneMap.casual;
}

function getLengthInstructions(lengthPreference) {
  const lengthMap = {
    short: `- Keep responses under 2-3 sentences when possible\n- Focus on the most essential information`,
    medium: `- Aim for balanced responses (3-5 sentences typically)\n- Provide sufficient detail without overwhelming`,
    long: `- Provide comprehensive and detailed responses\n- Include context, examples, and thorough explanations`
  };
  
  return lengthMap[lengthPreference] || lengthMap.medium;
}

function getLanguageInstructions(defaultLanguage) {
  const languageMap = {
    english: `- Primarily respond in English unless the customer specifically uses another language`,
    arabic: `- Primarily respond in Arabic unless the customer specifically uses English`
  };
  
  return languageMap[defaultLanguage] || languageMap.english;
}

function getFeatureRestrictions(features) {
  const restrictions = [];
  
  if (features?.voicesEnabled === false) {
    restrictions.push('- Voice message processing is DISABLED for this business.');
  }
  
  if (features?.imagesEnabled === false) {
    restrictions.push('- Image analysis is DISABLED for this business.');
  }
  
  if (restrictions.length === 0) {
    return null;
  }
  
  return restrictions.join('\n');
}

/**
 * Analyze conflicts between base prompt and advanced settings
 */
function analyzePromptConflicts() {
  console.log('🔍 SYSTEM PROMPT CONFLICT ANALYSIS');
  console.log('=====================================\n');

  // Sample base prompt (simplified version for analysis)
  const basePrompt = `
You are Moaawen, the helpful assistant for Business.

**CRITICAL LANGUAGE INSTRUCTION**
Analyze the user's most recent message and respond in the EXACT SAME LANGUAGE and dialect they used:
- If they wrote in English → respond in English
- If they wrote in Arabic → respond in Arabic using Arabic script
- If they wrote in Lebanese dialect → respond in Lebanese dialect using Arabic script

**GENERAL RULES:**
1. Be conversational, helpful, warm, and use emojis naturally
2. Response Style: Be conversational, helpful, warm, and use emojis naturally
3. Language Consistency: Always match the user's language and dialect exactly
`;

  // Test different advanced settings scenarios
  const testScenarios = [
    {
      name: 'Formal Business with English Default',
      settings: {
        aiPersonality: { tone: 'formal' },
        language: { default: 'english' },
        responses: { lengthPreference: 'short' }
      }
    },
    {
      name: 'Casual Business with Arabic Default', 
      settings: {
        aiPersonality: { tone: 'casual' },
        language: { default: 'arabic' },
        responses: { lengthPreference: 'long' }
      }
    },
    {
      name: 'Concise Business with Features Disabled',
      settings: {
        aiPersonality: { tone: 'concise' },
        responses: { lengthPreference: 'short' },
        features: { voicesEnabled: false, imagesEnabled: false }
      }
    },
    {
      name: 'Playful Business with Mixed Settings',
      settings: {
        aiPersonality: { tone: 'playful' },
        language: { default: 'english' },
        responses: { lengthPreference: 'medium' }
      }
    }
  ];

  testScenarios.forEach((scenario, index) => {
    console.log(`\n${index + 1}. 🧪 TESTING: ${scenario.name}`);
    console.log('─'.repeat(50));
    
    // Apply advanced settings to base prompt
    const enhancedPrompt = applyAdvancedSettingsToPrompt(scenario.settings, basePrompt);
    
    // Detect conflicts
    const conflicts = detectConflicts(basePrompt, enhancedPrompt, scenario.settings);
    
    console.log(`📋 Settings Applied:`);
    console.log(`   • Tone: ${scenario.settings.aiPersonality?.tone || 'default'}`);
    console.log(`   • Language: ${scenario.settings.language?.default || 'auto-detect'}`);
    console.log(`   • Length: ${scenario.settings.responses?.lengthPreference || 'default'}`);
    console.log(`   • Features: ${JSON.stringify(scenario.settings.features || {})}`);
    
    if (conflicts.length > 0) {
      console.log(`\n❌ CONFLICTS DETECTED (${conflicts.length}):`);
      conflicts.forEach(conflict => {
        const severity = conflict.severity === 'high' ? '🚨' : 
                        conflict.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`   ${severity} ${conflict.type}: ${conflict.description}`);
      });
    } else {
      console.log('\n✅ NO CONFLICTS DETECTED');
    }
    
    console.log('\n📄 Final Prompt Length:', enhancedPrompt.length, 'characters');
  });

  // Summary
  console.log('\n\n📊 CONFLICT ANALYSIS SUMMARY');
  console.log('=====================================');
  
  const allConflicts = [];
  testScenarios.forEach(scenario => {
    const enhancedPrompt = applyAdvancedSettingsToPrompt(scenario.settings, basePrompt);
    const conflicts = detectConflicts(basePrompt, enhancedPrompt, scenario.settings);
    allConflicts.push(...conflicts);
  });

  const conflictTypes = [...new Set(allConflicts.map(c => c.type))];
  const highPriorityConflicts = allConflicts.filter(c => c.severity === 'high');
  const mediumPriorityConflicts = allConflicts.filter(c => c.severity === 'medium');

  console.log(`🚨 High Priority Conflicts: ${highPriorityConflicts.length}`);
  console.log(`⚠️ Medium Priority Conflicts: ${mediumPriorityConflicts.length}`);
  console.log(`📋 Unique Conflict Types: ${conflictTypes.length}`);
  console.log(`   Types: ${conflictTypes.join(', ')}`);

  console.log('\n🎯 RECOMMENDED ACTIONS:');
  if (highPriorityConflicts.length > 0) {
    console.log('1. 🚨 Resolve HIGH priority conflicts immediately');
    console.log('2. ⚙️ Implement hierarchical override system');
    console.log('3. 🔄 Refactor prompt architecture for modularity');
  }
  if (mediumPriorityConflicts.length > 0) {
    console.log('4. ⚠️ Address medium priority conflicts in next iteration');
    console.log('5. 🧪 Implement A/B testing for validation');
  }
  console.log('6. 📖 Document clear precedence rules');
  console.log('7. 🔍 Add automated conflict detection to CI/CD pipeline');
}

/**
 * Detect conflicts between base prompt and settings
 */
function detectConflicts(basePrompt, enhancedPrompt, settings) {
  const conflicts = [];

  // Language Conflicts
  if (basePrompt.includes('EXACT SAME LANGUAGE') && settings.language?.default) {
    conflicts.push({
      type: 'language_hierarchy',
      severity: 'high',
      description: `Base prompt forces language matching but settings specify default: ${settings.language.default}`
    });
  }

  // Tone Conflicts
  if (basePrompt.includes('conversational, helpful, warm') && settings.aiPersonality?.tone === 'formal') {
    conflicts.push({
      type: 'tone_mismatch',
      severity: 'medium', 
      description: 'Base prompt enforces casual tone but formal tone requested'
    });
  }

  if (basePrompt.includes('use emojis naturally') && settings.aiPersonality?.tone === 'formal') {
    conflicts.push({
      type: 'emoji_formality',
      severity: 'medium',
      description: 'Base prompt encourages emojis but formal tone typically avoids them'
    });
  }

  // Response Length Conflicts
  if (basePrompt.includes('conversational') && settings.responses?.lengthPreference === 'short') {
    conflicts.push({
      type: 'length_style_mismatch',
      severity: 'low',
      description: 'Conversational style may conflict with short response preference'
    });
  }

  // Concise tone with natural conversation
  if (settings.aiPersonality?.tone === 'concise' && basePrompt.includes('conversational')) {
    conflicts.push({
      type: 'concise_conversational',
      severity: 'medium',
      description: 'Concise tone conflicts with conversational base style'
    });
  }

  // Feature positioning (restrictions added at end)
  if (settings.features && (settings.features.voicesEnabled === false || settings.features.imagesEnabled === false)) {
    if (enhancedPrompt.indexOf('FEATURE RESTRICTIONS') > enhancedPrompt.length * 0.8) {
      conflicts.push({
        type: 'restriction_positioning',
        severity: 'medium',
        description: 'Feature restrictions placed too late in prompt (low AI attention)'
      });
    }
  }

  return conflicts;
}

/**
 * Generate optimization recommendations
 */
function generateRecommendations(conflicts) {
  const recommendations = [];

  if (conflicts.some(c => c.type === 'language_hierarchy')) {
    recommendations.push({
      priority: 'high',
      action: 'Implement hierarchical language selection logic',
      details: 'Create clear precedence: business default → user language switch → auto-detect'
    });
  }

  if (conflicts.some(c => c.type === 'tone_mismatch')) {
    recommendations.push({
      priority: 'high', 
      action: 'Make base prompt tone-neutral',
      details: 'Remove fixed tone from base prompt, apply dynamic tone from settings'
    });
  }

  if (conflicts.some(c => c.type === 'restriction_positioning')) {
    recommendations.push({
      priority: 'medium',
      action: 'Restructure prompt sections',
      details: 'Move restrictions and capabilities to high-priority position'
    });
  }

  return recommendations;
}

// Run the analysis
if (require.main === module) {
  analyzePromptConflicts();
}

module.exports = {
  analyzePromptConflicts,
  detectConflicts,
  generateRecommendations
};
