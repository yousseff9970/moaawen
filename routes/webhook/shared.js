// routes/webhook/shared.js
const express = require('express');
const fs = require('fs');
const xss = require('xss');
const { scheduleBatchedReply } = require('../../services/openai');
const { sendMessengerMessage, sendInstagramMessage } = require('../../services/meta');
const { downloadVoiceFile, transcribeWithWhisper } = require('../../services/transcribeVoice');
const { downloadMedia } = require('../../services/downloadMedia');
const { matchImageAndGenerateReply } = require('../../services/imageMatcher');
const { logConversation } = require('../../utils/logger');
const { getBusinessInfo } = require('../../services/business');
const { checkAccess } = require('../../utils/businessPolicy');
const { trackUsage } = require('../../utils/trackUsage');

const processedMessages = new Set();
const processedEvents = new Map(); // Track events by timestamp + sender + recipient

// Clean up old processed messages every 30 minutes to prevent memory leaks
setInterval(() => {
  if (processedMessages.size > 1000) {
    console.log(`🧹 Cleaning up processed messages cache (${processedMessages.size} entries)`);
    processedMessages.clear();
  }
  if (processedEvents.size > 1000) {
    console.log(`🧹 Cleaning up processed events cache (${processedEvents.size} entries)`);
    processedEvents.clear();
  }
}, 30 * 60 * 1000);

// Helper function to create unique event signature
function createEventSignature(event, pageId) {
  const senderId = event.sender?.id;
  const timestamp = event.timestamp;
  const messageText = event.message?.text;
  
  return `${pageId}-${senderId}-${timestamp}-${messageText?.substring(0, 50)}`;
}

// Helper function to check if event is duplicate
function isDuplicateEvent(event, pageId) {
  const signature = createEventSignature(event, pageId);
  const now = Date.now();
  
  if (processedEvents.has(signature)) {
    const lastSeen = processedEvents.get(signature);
    // If we've seen this exact event in the last 5 minutes, it's a duplicate
    if (now - lastSeen < 5 * 60 * 1000) {
      return true;
    }
  }
  
  processedEvents.set(signature, now);
  return false;
}

function getFallback(reason) {
  if (reason.includes('expired')) return '⚠️ Your subscription expired. Please renew.';
  if (reason.includes('inactive')) return '⚠️ Your account is inactive.';
  if (reason.includes('message_limit')) return '⚠️ Message limit reached. Upgrade your plan.';
  if (reason.find(r => r.startsWith('feature:voiceInput'))) return '🎤 Voice not allowed in your plan.';
  if (reason.find(r => r.startsWith('feature:imageAnalysis'))) return '🖼️ Image analysis not allowed in your plan.';

  return '🚫 Access denied.';
}

async function respond(platform, id, msg, token) {
  if (platform === 'instagram') {
    await sendInstagramMessage(id, msg, token);
  } else {
    await sendMessengerMessage(id, msg, token);
  }
}

module.exports = {
  express,
  fs,
  xss,
  scheduleBatchedReply,
  sendMessengerMessage,
  sendInstagramMessage,
  downloadVoiceFile,
  transcribeWithWhisper,
  downloadMedia,
  matchImageAndGenerateReply,
  logConversation,
  getBusinessInfo,
  checkAccess,
  trackUsage,
  processedMessages,
  processedEvents,
  createEventSignature,
  isDuplicateEvent,
  getFallback,
  respond
};
