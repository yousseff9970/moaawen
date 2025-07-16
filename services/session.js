
const sessionHistory = new Map();
function updateSession(senderId, role, content) {
  if (!sessionHistory.has(senderId)) sessionHistory.set(senderId, []);
  const history = sessionHistory.get(senderId);
  history.push({ role, content });
  if (history.length > 10) history.shift();
}

module.exports = { updateSession };