// config/google.js
const fs = require('fs');
const path = require('path');

// Load Google OAuth credentials from JSON file
function loadGoogleCredentials() {
  try {
    const credentialsPath = path.join(__dirname, '..', 'client_secret_1052038364750-chr63r6n4ak4rpo5ev7auq9ig51a8890.apps.googleusercontent.com.json');
    
    if (fs.existsSync(credentialsPath)) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      
      // Set environment variables if not already set
      if (!process.env.GOOGLE_CLIENT_ID) {
        process.env.GOOGLE_CLIENT_ID = credentials.web.client_id;
      }
      if (!process.env.GOOGLE_CLIENT_SECRET) {
        process.env.GOOGLE_CLIENT_SECRET = credentials.web.client_secret;
      }
      
      console.log('✅ Google OAuth credentials loaded from JSON file');
      return true;
    } else {
      console.log('⚠️ Google credentials file not found. Using environment variables.');
      return false;
    }
  } catch (error) {
    console.error('❌ Error loading Google credentials:', error.message);
    return false;
  }
}

module.exports = {
  loadGoogleCredentials
};
