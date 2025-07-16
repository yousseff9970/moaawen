const fs = require('fs');
const path = require('path');

function logToJson(data) {
  const logPath = path.join(__dirname, 'logs.json');
  let logs = [];
  if (fs.existsSync(logPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    } catch {
      logs = [];
    }
  }
  logs.push({ timestamp: new Date().toISOString(), ...data });
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
}

module.exports = { logToJson };