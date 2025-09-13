// utils/planSettings.js
const planSettings = {
  starter: {
    name: "Starter Plan",
    originalPriceMonthly: 20,
    priceMonthly: 13,
    originalPriceYearly: 240,
    priceYearly: 210,
    maxMessages: 5000,
    allowedChannels: 1,
    languages: 2,
    voiceMinutes: 0,
    aiImageProcessing: 100,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: false,
      voiceInput: false,
      shopifySync: false,
      wooCommerceSync: false,
      advancedAnalytics: false,
      orderManagement: false,
      aiImageProcessing: true,
      multiLanguageSupport: false
    }
  },
  growth: {
    name: "Growth Plan",
    originalPriceMonthly: 35,
    priceMonthly: 25,
    originalPriceYearly: 420,
    priceYearly: 370,
    maxMessages: 10000,
    allowedChannels: 2,
    languages: 2,
    voiceMinutes: 150,
    aiImageProcessing: 150,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: false,
      wooCommerceSync: false,
      advancedAnalytics: false,
      orderManagement: false,
      aiImageProcessing: true,
      multiLanguageSupport: false
    }
  },
  scale: {
    name: "Scale Plan",
    originalPriceMonthly: 70,
    priceMonthly: 50,
    originalPriceYearly: 840,
    priceYearly: 740,
    maxMessages: 20000,
    allowedChannels: 3,
    languages: 3,
    voiceMinutes: 300,
    aiImageProcessing: 200,
    popular: true,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: true,
      wooCommerceSync: true,
      advancedAnalytics: false,
      orderManagement: false,
      aiImageProcessing: true,
      multiLanguageSupport: true
    }
  },
  enterprise: {
    name: "Enterprise Plan",
    originalPriceMonthly: 140,
    priceMonthly: 100,
    originalPriceYearly: 1680,
    priceYearly: 1400,
    maxMessages: 40000,
    allowedChannels: 5,
    languages: 99, // Multi-language support
    voiceMinutes: 600,
    aiImageProcessing: 300,
    enterprise: true,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: true,
      wooCommerceSync: true,
      advancedAnalytics: true,
      orderManagement: true,
      aiImageProcessing: true,
      multiLanguageSupport: true
    }
  }
};

module.exports = planSettings;
