// utils/planSettings.js
const planSettings = {
  starter: {
    name: "Starter",
    price: 13,
    maxMessages: 5000,
    allowedChannels: 1,
    languages: 2,
    voiceMinutes: 0,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: false,
      voiceInput: false,
      shopifySync: false,
      advancedAnalytics: false,
      orderManagement: false,
      advancedImageProcessing: false
    }
  },
  growth: {
    name: "Growth",
    price: 25,
    maxMessages: 10000,
    allowedChannels: 2,
    languages: 2,
    voiceMinutes: 150,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: false,
      advancedAnalytics: false,
      orderManagement: false,
      advancedImageProcessing: false
    }
  },
  scale: {
    name: "Scale",
    price: 50,
    maxMessages: 20000,
    allowedChannels: 3,
    languages: 2,
    voiceMinutes: 300,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: true,
      advancedAnalytics: false,
      orderManagement: false,
      advancedImageProcessing: false
    }
  },
  enterprise: {
    name: "Enterprise",
    price: 100,
    maxMessages: 40000,
    allowedChannels: 5,
    languages: 99,
    voiceMinutes: 600,
    features: {
      aiReplies: true,
      textMessaging: true,
      faq: true,
      analytics: true,
      imageAnalysis: true,
      voiceInput: true,
      shopifySync: true,
      advancedAnalytics: true,
      orderManagement: true,
      advancedImageProcessing: true
    }
  }
};

module.exports = planSettings;
