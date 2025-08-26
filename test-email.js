// Test email sending functionality
const { sendVerificationEmail, generateOTP } = require('./utils/mailer');

async function testEmailSending() {
  console.log('🧪 Testing Email Sending...\n');
  
  try {
    const otp = generateOTP();
    console.log('Generated OTP:', otp);
    
    // Test with a real email
    const result = await sendVerificationEmail('ezediny@gmail.com', otp, 'Test User');
    
    if (result.success) {
      console.log('✅ Email sent successfully!');
      console.log('Message ID:', result.messageId);
    } else {
      console.log('❌ Email sending failed:', result.error);
    }
  } catch (error) {
    console.error('🚨 Test failed:', error.message);
  }
}

testEmailSending();
