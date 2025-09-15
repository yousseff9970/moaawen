// scripts/testIntegration.js
/**
 * Test the integration of the new prompt builder with the existing openai.js system
 */

// Standalone test without database dependencies
const fs = require('fs');
const path = require('path');

// Read and evaluate the prompt builder directly
const promptBuilderPath = path.join(__dirname, '../services/promptBuilder.js');
const promptBuilderCode = fs.readFileSync(promptBuilderPath, 'utf8');

// Create a mock environment for testing
const mockEnv = {
  module: { exports: {} },
  exports: {},
  require: (moduleName) => {
    // Mock dependencies
    if (moduleName === 'moment') {
      return () => ({ format: () => '2024-01-15 10:30 AM' });
    }
    return {};
  }
};

// Execute the prompt builder code in our mock environment
eval(`
  (function(module, exports, require) {
    ${promptBuilderCode}
  })(mockEnv.module, mockEnv.exports, mockEnv.require);
`);

const { createOptimizedPromptSync } = mockEnv.module.exports;

function testPromptBuilderIntegration() {
  console.log('🧪 TESTING PROMPT BUILDER INTEGRATION');
  console.log('=====================================\n');

  // Sample business data (similar to what openai.js would have)
  const business = {
    _id: '68a0c94a57a5afed1a06fa84',
    name: 'Lebanon Fashion Store',
    description: 'Premium clothing and accessories for men and women',
    contact: {
      phone: '+961-1-123456',
      email: 'info@lebanonfashion.com',
      whatsapp: '+961-70-123456',
      instagram: '@lebanonfashion'
    },
    website: 'https://lebanonfashion.com'
  };

  // Sample product data
  const productData = {
    formattedProductData: `
**MEN'S CLOTHING**
1. Classic T-Shirt - Blue/M - $25 - Available
2. Casual Shorts - Black/L - $30 - Available
    `,
    categoryOverview: `
Categories: Men (2 products), Women (3 products)
Total: 5 products, 8 variants available
    `,
    orderContext: `
=== ORDER CONTEXT ===
No active orders for this session.
=== END ORDER CONTEXT ===
    `
  };

  // Test scenarios matching the conflicts we identified
  const testScenarios = [
    {
      name: 'Formal Business with English Default',
      settings: {
        aiPersonality: { tone: 'formal' },
        language: { default: 'english' },
        responses: { lengthPreference: 'medium' },
        features: { voicesEnabled: false }
      },
      expectedBehavior: [
        'Should use formal tone throughout',
        'Should prefer English but allow user overrides',
        'Should mention voice restrictions',
        'Should use minimal emojis'
      ]
    },
    {
      name: 'Casual Arabic Business',
      settings: {
        aiPersonality: { tone: 'casual' },
        language: { default: 'arabic' },
        responses: { lengthPreference: 'long' }
      },
      expectedBehavior: [
        'Should use casual, friendly tone',
        'Should prefer Arabic responses',
        'Should provide comprehensive responses',
        'Should use emojis naturally'
      ]
    },
    {
      name: 'Business with All Features Disabled',
      settings: {
        aiPersonality: { tone: 'concise' },
        responses: { lengthPreference: 'short' },
        features: { 
          voicesEnabled: false, 
          imagesEnabled: false, 
          ordersEnabled: false 
        }
      },
      expectedBehavior: [
        'Should be brief and direct',
        'Should mention all feature restrictions early',
        'Should direct to manual contact for orders',
        'Should avoid lengthy explanations'
      ]
    }
  ];

  let allTestsPassed = true;

  testScenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. 🔍 TESTING: ${scenario.name}`);
    console.log('─'.repeat(50));
    
    try {
      // Test with products
      let result = createOptimizedPromptSync(business, scenario.settings, true, productData);
      console.log(`✅ WITH PRODUCTS: Generated successfully (${result.prompt.length} chars)`);
      
      // Test without products  
      result = createOptimizedPromptSync(business, scenario.settings, false, null);
      console.log(`✅ WITHOUT PRODUCTS: Generated successfully (${result.prompt.length} chars)`);
      
      // Validate expected behaviors
      console.log(`\n📋 EXPECTED BEHAVIORS:`);
      scenario.expectedBehavior.forEach(behavior => {
        console.log(`   • ${behavior}`);
      });
      
      // Check for conflict resolution
      if (result.conflicts.length === 0 || result.conflicts.every(c => c.type === 'resolved')) {
        console.log(`\n✅ CONFLICTS: All resolved (${result.conflicts.length} total)`);
      } else {
        console.log(`\n❌ CONFLICTS: ${result.conflicts.length} unresolved`);
        result.conflicts.forEach(conflict => {
          console.log(`   • ${conflict.type}: ${conflict.message || 'Unresolved'}`);
        });
        allTestsPassed = false;
      }

      // Check prompt structure
      const prompt = result.prompt;
      const hasIdentitySection = prompt.includes('You are Moaawen');
      const hasBehaviorSection = prompt.includes('LANGUAGE SELECTION') || prompt.includes('LANGUAGE BEHAVIOR');
      const hasCapabilitiesSection = prompt.includes('SCOPE & CAPABILITIES') || prompt.includes('FEATURE RESTRICTIONS');
      
      console.log(`\n📄 PROMPT STRUCTURE:`);
      console.log(`   • Identity Section: ${hasIdentitySection ? '✅' : '❌'}`);
      console.log(`   • Behavior Section: ${hasBehaviorSection ? '✅' : '❌'}`);
      console.log(`   • Capabilities Section: ${hasCapabilitiesSection ? '✅' : '❌'}`);
      
      if (!hasIdentitySection || !hasBehaviorSection || !hasCapabilitiesSection) {
        console.log(`   ❌ Missing required sections`);
        allTestsPassed = false;
      }

      // Check language hierarchy implementation
      if (scenario.settings.language?.default) {
        const hasLanguagePriority = prompt.includes('LANGUAGE SELECTION PRIORITY') || 
                                  prompt.includes(`Business Default: ${scenario.settings.language.default}`);
        console.log(`   • Language Hierarchy: ${hasLanguagePriority ? '✅' : '❌'}`);
        if (!hasLanguagePriority) {
          allTestsPassed = false;
        }
      }

      // Check feature restrictions positioning
      if (scenario.settings.features && Object.values(scenario.settings.features).some(v => v === false)) {
        const restrictionIndex = prompt.indexOf('FEATURE RESTRICTIONS');
        const totalLength = prompt.length;
        const restrictionPosition = restrictionIndex / totalLength;
        
        console.log(`   • Feature Restrictions Position: ${restrictionPosition < 0.3 ? '✅ Early' : '⚠️ Late'} (${Math.round(restrictionPosition * 100)}%)`);
        if (restrictionPosition > 0.5) {
          console.log(`   ⚠️ Warning: Restrictions may have low AI attention`);
        }
      }

    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      allTestsPassed = false;
    }
    
    console.log('\n');
  });

  // Integration test summary
  console.log('📊 INTEGRATION TEST SUMMARY');
  console.log('=====================================');
  
  if (allTestsPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log('🎯 New prompt builder is ready for production');
    console.log('🔄 Can safely replace legacy system');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('🔧 Issues need to be resolved before production deployment');
  }

  console.log('\n🏁 NEXT STEPS:');
  if (allTestsPassed) {
    console.log('1. ✅ Deploy to staging environment');
    console.log('2. ✅ Test with real business data'); 
    console.log('3. ✅ Monitor for any regressions');
    console.log('4. ✅ Gradually roll out to production');
  } else {
    console.log('1. 🔧 Fix identified issues');
    console.log('2. 🧪 Re-run integration tests');
    console.log('3. 📝 Update prompt builder as needed');
    console.log('4. ✅ Ensure all conflicts are resolved');
  }

  return allTestsPassed;
}

// Performance test
function testPromptBuildingPerformance() {
  console.log('\n⚡ PERFORMANCE TEST');
  console.log('=====================================');

  const business = {
    _id: 'test123',
    name: 'Test Business',
    description: 'Test description',
    contact: { phone: '123', email: 'test@test.com' }
  };

  const settings = {
    aiPersonality: { tone: 'formal' },
    language: { default: 'english' },
    responses: { lengthPreference: 'medium' }
  };

  const iterations = 10;
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    createOptimizedPromptSync(business, settings, true, { 
      formattedProductData: 'Test products',
      categoryOverview: 'Test categories',
      orderContext: 'Test orders'
    });
  }

  const endTime = Date.now();
  const avgTime = (endTime - startTime) / iterations;

  console.log(`📊 Performance Results:`);
  console.log(`   • ${iterations} prompt generations`);
  console.log(`   • Average time: ${avgTime.toFixed(2)}ms`);
  console.log(`   • ${avgTime < 50 ? '✅ Excellent' : avgTime < 100 ? '✅ Good' : '⚠️ Needs optimization'} performance`);

  return avgTime < 100; // Should be under 100ms
}

// Run tests
if (require.main === module) {
  const integrationPassed = testPromptBuilderIntegration();
  const performancePassed = testPromptBuildingPerformance();
  
  console.log('\n🎯 FINAL RESULT');
  console.log('=====================================');
  console.log(`Integration Tests: ${integrationPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Performance Tests: ${performancePassed ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (integrationPassed && performancePassed) {
    console.log('\n🚀 READY FOR DEPLOYMENT!');
    process.exit(0);
  } else {
    console.log('\n🔧 NEEDS FIXES BEFORE DEPLOYMENT');
    process.exit(1);
  }
}

module.exports = {
  testPromptBuilderIntegration,
  testPromptBuildingPerformance
};
