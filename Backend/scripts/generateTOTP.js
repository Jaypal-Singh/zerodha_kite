// scripts/generateTOTP.js
// Quick utility to generate TOTP code from a secret
// Usage: node scripts/generateTOTP.js YOUR_TOTP_SECRET

import { authenticator } from 'otplib';

const secret = process.argv[2];

if (!secret) {
    console.log('Usage: node scripts/generateTOTP.js YOUR_TOTP_SECRET');
    console.log('Example: node scripts/generateTOTP.js JBSWY3DPEHPK3PXP');
    process.exit(1);
}

// Clean up the secret - remove spaces
const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();

try {
    const token = authenticator.generate(cleanSecret);
    const timeRemaining = 30 - Math.floor((Date.now() / 1000) % 30);

    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║           TOTP CODE GENERATOR          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║   Your OTP:  ${token}                      ║`);
    console.log(`║   Valid for: ${timeRemaining.toString().padStart(2, ' ')} seconds                  ║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log('⚡ Quick! Enter this code in Zerodha before it expires.');
    console.log('');

} catch (error) {
    console.error('❌ Error generating TOTP:', error.message);
    console.error('Make sure your secret is correct. It should be a base32 string.');
    process.exit(1);
}
