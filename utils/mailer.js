const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "mail.privateemail.com",
  port: 587, // or 465 for SSL
  secure: false, // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER || "info@moaawen.ai",
    pass: process.env.EMAIL_PASS || "h1h1@#$@#$", // should be in .env
  },
});

// Function to generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Function to send verification email
async function sendVerificationEmail(toEmail, otp, userName = '') {
  try {
    const info = await transporter.sendMail({
      from: '"Moaawen" <info@moaawen.ai>',
      to: toEmail,
      subject: "Verify Your Email - Moaawen",
      text: `Hello ${userName},\n\nWelcome to Moaawen! Please verify your email address using the OTP code below:\n\n${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't create an account with us, please ignore this email.\n\nBest regards,\nMoaawen Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Moaawen</h1>
            <p style="color: #6b7280; margin: 5px 0;">Business Communication Platform</p>
          </div>
          
          <div style="background-color: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #1f2937; margin-top: 0;">Verify Your Email Address</h2>
            <p style="color: #4b5563; line-height: 1.5;">Hello ${userName || 'there'},</p>
            <p style="color: #4b5563; line-height: 1.5;">Welcome to Moaawen! To complete your registration and secure your account, please verify your email address using the verification code below:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #2563eb; color: white; font-size: 32px; font-weight: bold; padding: 15px 30px; border-radius: 8px; letter-spacing: 3px; display: inline-block;">
                ${otp}
              </div>
            </div>
            
            <p style="color: #ef4444; font-size: 14px; text-align: center; margin-top: 20px;">
              ⏰ This code will expire in 10 minutes
            </p>
            
            <p style="color: #4b5563; line-height: 1.5; margin-top: 30px;">
              If you didn't create an account with Moaawen, please ignore this email and no further action is required.
            </p>
          </div>
          
          <div style="text-align: center; color: #6b7280; font-size: 12px;">
            <p>© 2025 Moaawen. All rights reserved.</p>
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      `,
    });

    console.log("✅ Verification email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("❌ Error sending verification email:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  generateOTP,
  sendVerificationEmail
};
