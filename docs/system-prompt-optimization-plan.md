# System Prompt Optimization Plan

## Executive Summary
This document outlines a comprehensive plan to optimize the AI system prompt by analyzing conflicts and redundancies between the base prompt and dynamic advanced settings, ensuring consistent behavior and eliminating contradictory instructions.

## Current Analysis

### 1. Identified Conflicts and Duplications

#### **Language Handling Conflicts** 🚨 HIGH PRIORITY
- **Base Prompt**: Fixed instruction to "respond in EXACT SAME LANGUAGE and dialect they used"
- **Advanced Settings**: `language.default` allows overriding to English or Arabic
- **Conflict**: Base prompt forces language matching, but advanced settings want default language
- **Impact**: Settings can't enforce a preferred language due to base prompt override

#### **Response Length Redundancy** ⚠️ MEDIUM PRIORITY
- **Base Prompt**: Contains natural conversational length guidance
- **Advanced Settings**: Specific length preferences (short/medium/long)
- **Duplication**: Both try to control response length but may contradict
- **Impact**: Unclear which instruction takes precedence

#### **Tone and Personality Inconsistency** ⚠️ MEDIUM PRIORITY
- **Base Prompt**: Fixed "warm, conversational, helpful" tone with emojis
- **Advanced Settings**: Tone options (formal/casual/playful/concise)
- **Conflict**: Base prompt enforces casual/playful tone, formal setting can't override
- **Impact**: Formal businesses can't maintain professional tone

#### **Feature Instructions Placement** ⚠️ MEDIUM PRIORITY
- **Base Prompt**: No mention of voice/image capabilities
- **Advanced Settings**: Adds restrictions at the end
- **Issue**: Restrictions added after extensive product instructions
- **Impact**: Late restrictions may be ignored due to prompt position

### 2. Structural Issues

#### **Prompt Length and Complexity** 📏
- Current prompt is very long (500+ lines estimated)
- Multiple nested sections with overlapping purposes
- Hard to maintain and debug
- Advanced settings appended at end (lower priority in AI attention)

#### **Inconsistent Formatting** 📝
- Mix of markdown, plain text, and special formatting
- Inconsistent section headers and structure
- Hard to parse priority and importance

## Optimization Strategy

### Phase 1: Core Prompt Refactoring (Week 1)

#### 1.1 Create Modular Prompt Architecture
```javascript
// New structure
const systemPrompt = {
  core: buildCorePrompt(business),
  personality: buildPersonalitySection(advancedSettings),
  language: buildLanguageSection(advancedSettings), 
  products: buildProductSection(products, advancedSettings),
  orders: buildOrderSection(advancedSettings),
  restrictions: buildRestrictionSection(advancedSettings)
};
```

#### 1.2 Priority-Based Section Ordering
1. **CORE IDENTITY** - Who you are, what business you represent
2. **BEHAVIOR RULES** - Personality, tone, language preferences  
3. **CAPABILITIES** - What you can/cannot do (features, restrictions)
4. **CONTENT KNOWLEDGE** - Products, services, business info
5. **INTERACTION PATTERNS** - Order flow, conversation handling

### Phase 2: Conflict Resolution (Week 2)

#### 2.1 Language Handling Resolution
**Problem**: Base prompt forces language matching vs. advanced settings default language
**Solution**: Implement hierarchical language logic
```javascript
// New language priority system
if (advancedSettings.language?.default && !userChangedLanguage) {
  // Use business preferred language
  useLanguage = advancedSettings.language.default;
} else {
  // Match user's current message language  
  useLanguage = detectUserLanguage(userMessage);
}
```

#### 2.2 Tone and Personality Integration
**Problem**: Fixed casual tone vs. dynamic tone settings
**Solution**: Make base prompt tone-neutral, apply dynamic tone
```javascript
// Remove tone from base prompt, apply dynamically
const baseTone = "professional and helpful"; // neutral
const dynamicTone = getToneInstructions(advancedSettings.aiPersonality?.tone);
```

#### 2.3 Response Length Coordination  
**Problem**: Overlapping length guidance
**Solution**: Remove length hints from base prompt, use only advanced settings
```javascript
// Base prompt: no length guidance
// Advanced settings: complete control over response length
```

### Phase 3: Advanced Settings Enhancement (Week 3)

#### 3.1 Enhanced Advanced Settings Schema
```javascript
const advancedSettingsSchema = {
  aiPersonality: {
    tone: 'formal|casual|playful|concise',
    enthusiasm: 'low|medium|high',
    emoji_usage: 'none|minimal|moderate|heavy',
    creativity: 'strict|balanced|creative'
  },
  language: {
    default: 'english|arabic',
    fallback_behavior: 'match_user|force_default|smart_detect',
    dialect_handling: 'formal|colloquial|mixed'
  },
  responses: {
    lengthPreference: 'short|medium|long',
    detail_level: 'minimal|standard|comprehensive',
    structure: 'paragraph|bullet|mixed'
  },
  features: {
    voicesEnabled: boolean,
    imagesEnabled: boolean,
    ordersEnabled: boolean,
    proactive_suggestions: boolean
  },
  business_rules: {
    price_display: 'always|on_request|never',
    stock_mention: 'explicit|implicit|hidden',
    upselling: 'aggressive|moderate|minimal|none'
  }
};
```

#### 3.2 Smart Conflict Detection
```javascript
function detectPromptConflicts(basePrompt, advancedSettings) {
  const conflicts = [];
  
  // Check language conflicts
  if (basePrompt.includes('EXACT SAME LANGUAGE') && 
      advancedSettings.language?.default) {
    conflicts.push({
      type: 'language_override',
      severity: 'high',
      description: 'Base prompt forces language matching but settings specify default'
    });
  }
  
  // Check tone conflicts
  if (basePrompt.includes('casual') && 
      advancedSettings.aiPersonality?.tone === 'formal') {
    conflicts.push({
      type: 'tone_mismatch', 
      severity: 'medium',
      description: 'Base casual tone conflicts with formal setting'
    });
  }
  
  return conflicts;
}
```

### Phase 4: Implementation Plan (Week 4)

#### 4.1 New Prompt Builder Service
```javascript
// services/promptBuilder.js
class PromptBuilder {
  constructor(business, advancedSettings) {
    this.business = business;
    this.settings = advancedSettings;
    this.conflicts = this.detectConflicts();
  }
  
  buildOptimizedPrompt() {
    return {
      system: this.buildSystemSection(),
      personality: this.buildPersonalitySection(),
      capabilities: this.buildCapabilitiesSection(),
      knowledge: this.buildKnowledgeSection(),
      instructions: this.buildInstructionSection()
    };
  }
  
  detectConflicts() {
    // Analyze conflicts between base rules and settings
  }
  
  resolveConflicts() {
    // Apply conflict resolution logic
  }
}
```

#### 4.2 Migration Strategy
1. **Phase 4a**: Create new prompt builder service
2. **Phase 4b**: Implement alongside existing system for A/B testing
3. **Phase 4c**: Gradually migrate businesses to new system
4. **Phase 4d**: Remove old prompt system after validation

## Detailed Conflict Analysis

### Critical Issues to Resolve

#### 1. Language Hierarchy Conflict
**Current State**: 
- Base: "respond in EXACT SAME LANGUAGE"
- Settings: `language.default = 'english'`
- Result: Settings ignored

**Resolution**: 
```javascript
const languageLogic = `
**LANGUAGE SELECTION PRIORITY:**
1. If business has language.default AND this is first interaction → use default
2. If user clearly switches language → match their new language  
3. If user language unclear → use business default
4. If no business default → match user's detected language
`;
```

#### 2. Tone Authority Conflict
**Current State**:
- Base: "Be conversational, helpful, warm, and use emojis naturally"
- Settings: tone = 'formal'
- Result: Formal businesses get casual responses

**Resolution**:
```javascript
const baseTone = `
**COMMUNICATION APPROACH:**
Be ${advancedSettings.aiPersonality?.tone || 'helpful and professional'} in your interactions.
${getToneInstructions(advancedSettings.aiPersonality?.tone)}
`;
```

#### 3. Feature Restriction Timing
**Current State**: Restrictions added after 400+ lines of product instructions
**Resolution**: Move restrictions to top priority position

### Minor Issues to Address

#### 1. Emoji Usage Inconsistency
- Base prompt encourages emoji use
- Formal tone setting should minimize emojis
- Solution: Make emoji usage dynamic based on tone

#### 2. Response Structure Conflicts
- Base prompt suggests natural conversation
- Some settings prefer bullet points or concise format
- Solution: Apply structure preferences dynamically

#### 3. Proactivity Levels
- Base prompt encourages proactive suggestions
- Some businesses may prefer reactive responses only
- Solution: Add proactivity settings

## Testing Strategy

### 1. Conflict Detection Tests
```javascript
describe('Prompt Conflicts', () => {
  test('should detect language hierarchy conflicts', () => {
    const conflicts = detectConflicts(basePrompt, {
      language: { default: 'english' }
    });
    expect(conflicts).toContain('language_override');
  });
  
  test('should detect tone mismatches', () => {
    const conflicts = detectConflicts(casualBasePrompt, {
      aiPersonality: { tone: 'formal' }
    });
    expect(conflicts).toContain('tone_mismatch');
  });
});
```

### 2. A/B Testing Framework
- Test old vs. new prompt system with same businesses
- Measure response quality, consistency, and user satisfaction
- Monitor for regressions in product knowledge or order handling

### 3. Business-Specific Testing
- Formal businesses: Ensure professional tone maintained
- Casual businesses: Ensure personality comes through
- Multi-language businesses: Test language switching behavior

## Success Metrics

### 1. Conflict Elimination
- Zero high-priority conflicts detected
- Reduced medium-priority conflicts by 80%
- Clear precedence rules for all settings

### 2. Consistency Improvement
- Same business settings produce consistent responses
- Advanced settings reliably override base behavior
- No contradictory instructions in final prompt

### 3. Maintainability Enhancement
- Modular prompt structure easier to debug
- New settings can be added without conflicts
- Clear separation of concerns between components

## Implementation Timeline

### Week 1: Analysis and Design
- [ ] Complete conflict analysis
- [ ] Design new modular architecture
- [ ] Create detailed technical specifications

### Week 2: Core Development
- [ ] Build new PromptBuilder service
- [ ] Implement conflict detection system
- [ ] Create unit tests for conflict resolution

### Week 3: Advanced Features
- [ ] Enhance advanced settings schema
- [ ] Implement hierarchical override system
- [ ] Add dynamic instruction generation

### Week 4: Testing and Migration
- [ ] Deploy A/B testing framework
- [ ] Test with subset of businesses
- [ ] Gather feedback and iterate
- [ ] Plan full migration strategy

## Risk Mitigation

### 1. Regression Risks
- **Risk**: New system breaks existing functionality
- **Mitigation**: Extensive testing, gradual rollout, fallback system

### 2. Business Disruption
- **Risk**: Changes affect customer interactions negatively
- **Mitigation**: A/B testing, business notification, quick rollback capability

### 3. Performance Impact
- **Risk**: More complex prompt building affects response time
- **Mitigation**: Caching, optimization, performance monitoring

## Conclusion

This optimization plan addresses critical conflicts between the base system prompt and dynamic advanced settings while improving maintainability and consistency. The modular approach ensures future enhancements can be made without introducing new conflicts, and the hierarchical override system gives businesses true control over their AI's behavior.

The implementation should be done incrementally with thorough testing to ensure no regression in the system's core functionality while dramatically improving the reliability and predictability of advanced settings.
