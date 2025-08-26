// Test script for OTP functionality
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testOTPFlow() {
  try {
    console.log('🧪 Testing OTP Registration Flow\n');

    // Test data
    const testUser = {
      businessName: 'Test Business',
      email: 'ezediny@gmail.com', // Use real email for testing
      phone: '+1234567890',
      password: 'password123'
    };

    // 1. Test Registration (should send OTP)
    console.log('1️⃣ Testing Registration...');
    try {
      const registerResponse = await axios.post(`${BASE_URL}/auth/user/register`, testUser);
      console.log('✅ Registration Response:', registerResponse.data);
    } catch (error) {
      if (error.response) {
        console.log('Registration Response:', error.response.data);
      } else {
        console.log('Registration Error:', error.message);
      }
    }

    // 2. Test Login Before Verification (should fail)
    console.log('\n2️⃣ Testing Login Before Verification...');
    try {
      const loginResponse = await axios.post(`${BASE_URL}/auth/user/login`, {
        email: testUser.email,
        password: testUser.password
      });
      console.log('Login Response:', loginResponse.data);
    } catch (error) {
      if (error.response) {
        console.log('❌ Login Failed (Expected):', error.response.data);
      } else {
        console.log('Login Error:', error.message);
      }
    }

    console.log('\n🎯 Manual Testing Required:');
    console.log('- Check email for OTP code');
    console.log('- Use received OTP with: POST /auth/user/verify-email');
    console.log('- After verification, login should work');

  } catch (error) {
    console.error('🚨 Test Error:', error.message);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testOTPFlow();
}
