const sessionHistory = new Map();
const sessionTimeouts = new Map();
const summaries = new Map(); // Store long-term memory summaries

/** Simple memory handling without language tracking */
function updateSession(senderId, role, content) {
  if (!sessionHistory.has(senderId)) sessionHistory.set(senderId, []);
  const history = sessionHistory.get(senderId);

  // Add timestamp to each message
  history.push({ 
    role, 
    content, 
    timestamp: Date.now() 
  });

  // Summarize if history > 20
  if (history.length > 20) {
    const oldMessages = history.splice(0, history.length - 20);
    const summaryText = oldMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join(' ')
      .slice(0, 1200);

    const previousSummary = summaries.get(senderId) || '';
    summaries.set(senderId, `${previousSummary} ${summaryText}`.trim());
  }

  // Reset 10-min timer
  if (sessionTimeouts.has(senderId)) clearTimeout(sessionTimeouts.get(senderId));
  const timeout = setTimeout(() => {
    sessionHistory.delete(senderId);
    sessionTimeouts.delete(senderId);
    summaries.delete(senderId);
    console.log(`🗑️ Cleared session history for ${senderId} after 10 min`);
  }, 10 * 60 * 1000);
  sessionTimeouts.set(senderId, timeout);
}

function getSessionHistory(senderId) {
  return sessionHistory.get(senderId) || [];
}

function getSessionSummary(senderId) {
  return summaries.get(senderId) || '';
}

function clearSession(senderId) {
  sessionHistory.delete(senderId);
  sessionTimeouts.delete(senderId);
  summaries.delete(senderId);
  if (sessionTimeouts.has(senderId)) {
    clearTimeout(sessionTimeouts.get(senderId));
  }
}

module.exports = {
  updateSession,
  getSessionHistory,
  getSessionSummary,
  clearSession
};
