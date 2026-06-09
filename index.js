// DOMMatrix Polyfill for pdf-parse server-side compatibility
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0;
      this.d = 1; this.e = 0; this.f = 0;
    }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
    static fromFloat64Array() { return new DOMMatrix(); }
    translate() { return this; }
    scale() { return this; }
    multiply() { return this; }
    inverse() { return this; }
    transformPoint(p) { return p; }
  };
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// MongoDB connection
const mongoURI = process.env.MONGODB_URI || "mongodb+srv://astech385_db_user:YfgNjHwgHrnl4tp4@cluster0.ezcouqk.mongodb.net/?appName=Cluster0";
mongoose.connect(mongoURI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mail Transporter & Helper
const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendOTPEmail = async (email, otp, subject, text) => {
  console.log(`[OTP Verification] OTP for ${email}: ${otp}`);
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`SMTP credentials not set. Logging OTP to console: ${otp}`);
    return { loggedToConsole: true };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Sakshi Enterprises" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      text: text,
    });
    return { sent: true };
  } catch (error) {
    console.error('Failed to send SMTP email:', error);
    throw error;
  }
};

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. Hardcoded admin check fallback
  if (username === 'SakshiE2024' && password === 'sakshi0807') {
    return res.json({ success: true, user: { name: 'Sakshi Admin', email: 'SakshiE2024', role: 'admin' } });
  }

  try {
    // 2. Search database by email or name
    const user = await User.findOne({
      $or: [
        { email: username },
        { name: username }
      ]
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 3. Compare password (bcrypt with plaintext fallback)
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (err) {
      isMatch = false;
    }

    if (!isMatch && user.password === password) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 4. Verify user is activated
    if (!user.isVerified) {
      return res.status(400).json({ success: false, message: 'Please verify your email address first' });
    }

    // 5. Return success
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// User Schema
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: 'user', // Default role assigned to new users
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  otp: String,
  otpExpires: Date,
  resetOtp: String,
  resetOtpExpires: Date,
});

const User = mongoose.model('User', userSchema);

// Sign Up Endpoint
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create new user (pending verification)
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      isVerified: false,
      otp,
      otpExpires
    });
    await newUser.save();

    // Send OTP email
    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        otp,
        'Verify your account - Sakshi Enterprises',
        `Your verification code is: ${otp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      console.error('Mail error, but account was created in pending state. Logged OTP to console.');
      isSmtpConfigured = false;
    }

    res.status(201).json({
      success: true,
      message: isSmtpConfigured ? 'Verification OTP sent to your email.' : 'Registration successful! (SMTP not configured, OTP printed to console).',
      email,
      otp: (!process.env.SMTP_USER || !process.env.SMTP_PASS) ? otp : undefined
    });
  } catch (error) {
    console.error('Error during sign up:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Verify OTP Endpoint
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'Account is already verified' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ success: false, message: 'Verification code has expired' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Account verified successfully!' });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Resend OTP Endpoint
app.post('/resend-otp', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'Account is already verified' });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        otp,
        'Verify your account - Sakshi Enterprises',
        `Your verification code is: ${otp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      isSmtpConfigured = false;
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured ? 'New verification OTP sent to your email.' : 'New OTP generated (SMTP not configured, OTP printed to console).',
      otp: (!process.env.SMTP_USER || !process.env.SMTP_PASS) ? otp : undefined
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Forgot Password Endpoint
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate password reset OTP
    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOtp = resetOtp;
    user.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        resetOtp,
        'Reset your password - Sakshi Enterprises',
        `Your password reset code is: ${resetOtp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      isSmtpConfigured = false;
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured ? 'Password reset OTP sent to your email.' : 'Password reset code generated (SMTP not configured, OTP printed to console).',
      otp: (!process.env.SMTP_USER || !process.env.SMTP_PASS) ? resetOtp : undefined
    });
  } catch (error) {
    console.error('Error during forgot password:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Reset Password Endpoint
app.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.resetOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid password reset code' });
    }

    if (new Date() > user.resetOtpExpires) {
      return res.status(400).json({ success: false, message: 'Password reset code has expired' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successful! You can now log in.' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update User Endpoint
app.put('/user/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body;

  try {
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { name, email, role },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete User Endpoint
app.delete('/user/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Mongoose schema
const invoiceSchema = new mongoose.Schema({
  companyName: String,
  gstin: String,
  state: String,
  stateCode: String,
  invoiceNo: String,
  invoiceDate: Date,
  items: [{
      description: String,
      hsnAsc: String,
      quantity: Number,
      rate: Number,
      totalValue: Number
  }],
  freightCharges: Number, 
  cgst: Number, 
  sgst: Number, 
  igst: Number, 
  grandTotal: Number, 
  grandTotalInWords: String 
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

// Route to handle POST requests to /api/invoices
app.post('/api/invoices', async (req, res) => {
  try {
      const invoiceData = req.body;
      const invoice = new Invoice({
          companyName: invoiceData.companyName,
          gstin: invoiceData.gstin,
          state: invoiceData.state,
          stateCode: invoiceData.stateCode,
          invoiceNo: invoiceData.invoiceNo,
          invoiceDate: invoiceData.invoiceDate,
          items: invoiceData.items,
          freightCharges: invoiceData.freightCharges, 
          cgst: invoiceData.cgst, 
          sgst: invoiceData.sgst, 
          igst: invoiceData.igst, 
          grandTotal: invoiceData.grandTotal, 
          grandTotalInWords: invoiceData.grandTotalInWords 
      });
      const savedInvoice = await invoice.save();
      res.status(201).json(savedInvoice);
  } catch (error) {
      console.error('Error saving invoice:', error);
      res.status(500).json({ error: 'An error occurred while saving the invoice' });
  }
});

// Helper to robustly format date strings to ISO YYYY-MM-DD format
const formatDateToISO = (dateStr) => {
  if (!dateStr) return null;
  const cleanStr = dateStr.trim();
  
  // Try splitting by hyphen, slash, or dot
  const parts = cleanStr.split(/[-\/\.]/);
  if (parts.length === 3) {
    // Check if the first part is a 4-digit year (YYYY-MM-DD)
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    // Check if the last part is a 4-digit year (DD-MM-YYYY)
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    // Check if the last part is a 2-digit year (DD-MM-YY)
    if (parts[2].length === 2) {
      const year = parseInt(parts[2]) > 50 ? '19' + parts[2] : '20' + parts[2];
      return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  // Fallback to native Date parser
  const parsed = new Date(cleanStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
};

// Helper to clean numeric strings with currency symbols and commas
const cleanNumber = (val) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[₹$]|Rs\.?|INR|,|\s/gi, '');
  return parseFloat(cleaned) || 0;
};

// Generalized helper to split merged items line into HSN, Quantity, and Total Value
const splitMergedItem = (numStr, subtotal, grandTotal) => {
  const targetVal = subtotal || grandTotal || 0;
  
  let hsnLengths = [8, 6, 4];
  if (numStr.startsWith('9985')) {
    hsnLengths = [4, 6, 8];
  } else if (numStr.startsWith('9983')) {
    hsnLengths = [4, 6, 8];
  }
  
  for (const hsnLen of hsnLengths) {
    if (numStr.length > hsnLen) {
      const hsn = numStr.substring(0, hsnLen);
      const rest = numStr.substring(hsnLen);
      
      for (let qtyLen = 1; qtyLen <= 4 && qtyLen < rest.length; qtyLen++) {
        const qtyStr = rest.substring(0, qtyLen);
        const totalStr = rest.substring(qtyLen);
        
        const qty = parseInt(qtyStr) || 1;
        const total = parseFloat(totalStr) || 0;
        
        if (total > 0) {
          if (targetVal > 0 && Math.abs(total - targetVal) < 1) {
            return { hsn, qty, total };
          }
        }
      }
    }
  }
  
  // Fallbacks
  if (numStr.startsWith('9985')) {
    const hsn = '9985';
    const rest = numStr.substring(4);
    if (rest.length >= 7) {
      const qty = cleanNumber(rest.substring(0, rest.length - 6)) || 1;
      const total = cleanNumber(rest.substring(rest.length - 6));
      return { hsn, qty, total };
    }
  }
  
  if (numStr.startsWith('99') && numStr.length >= 7) {
    const hsn = numStr.substring(0, 6);
    const rest = numStr.substring(6);
    const qty = cleanNumber(rest.substring(0, 1)) || 1;
    const total = cleanNumber(rest.substring(1));
    return { hsn, qty, total };
  }
  
  if (numStr.length >= 12) {
    const hsn = numStr.substring(0, 6);
    const qty = cleanNumber(numStr.substring(6, 7)) || 1;
    const total = cleanNumber(numStr.substring(7));
    return { hsn, qty, total };
  }
  
  if (numStr.length >= 10) {
    const hsn = numStr.substring(0, 4);
    const qty = cleanNumber(numStr.substring(4, 5)) || 1;
    const total = cleanNumber(numStr.substring(5));
    return { hsn, qty, total };
  }
  
  return { hsn: numStr, qty: 1, total: 0 };
};

// Helper for backend number to words conversion (fallback)
const convertNumberToWordsBackend = (number) => {
  if (isNaN(number) || number === null || number === undefined) return '';

  let num = parseFloat(number);
  if (num < 0) return 'Negative ' + convertNumberToWordsBackend(Math.abs(num));
  if (num === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertToWordsLessThanThousand = (val) => {
    let words = '';
    if (val >= 100) {
      words += ones[Math.floor(val / 100)] + ' Hundred ';
      val %= 100;
    }
    if (val >= 20) {
      words += tens[Math.floor(val / 10)] + ' ';
      val %= 10;
    }
    if (val > 0) {
      words += ones[val] + ' ';
    }
    return words.trim();
  };

  let integerPart = Math.floor(num);
  let decimalPart = Math.round((num - integerPart) * 100);
  let result = '';

  if (integerPart >= 10000000) { // Crore (1,00,00,000)
    const crore = Math.floor(integerPart / 10000000);
    result += convertToWordsLessThanThousand(crore) + ' Crore ';
    integerPart %= 10000000;
  }
  if (integerPart >= 100000) { // Lakh (1,00,000)
    const lakh = Math.floor(integerPart / 100000);
    result += convertToWordsLessThanThousand(lakh) + ' Lakh ';
    integerPart %= 100000;
  }
  if (integerPart >= 1000) { // Thousand (1,000)
    const thousand = Math.floor(integerPart / 1000);
    result += convertToWordsLessThanThousand(thousand) + ' Thousand ';
    integerPart %= 1000;
  }
  if (integerPart > 0) {
    result += convertToWordsLessThanThousand(integerPart);
  }

  let words = result.trim();

  // Convert decimal part to words (Paisa)
  if (decimalPart > 0) {
    if (words !== '') {
      words += ' and ' + convertToWordsLessThanThousand(decimalPart) + ' Paisa';
    } else {
      words = convertToWordsLessThanThousand(decimalPart) + ' Paisa';
    }
  }

  return words.trim();
};

// Bulk Upload PDFs Endpoint
app.post('/api/invoices/bulk-upload', upload.array('files'), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const results = [];
  const errors = [];
  const seenInvoiceNos = new Set();

  for (const file of files) {
    try {
      // 1. Extract text from PDF buffer
      const data = await pdfParse(file.buffer);
      const text = data.text;

      // 2. Parse details
      const cleanText = text.replace(/\r/g, '').trim();

      // Invoice details variables
      let invoiceNo = '';
      let invoiceDate = '';
      let companyName = '';
      let gstin = '';
      let state = '';
      let stateCode = '';
      let freightCharges = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      let grandTotal = 0;
      let grandTotalInWords = '';
      const items = [];

      const hasGroqKey = process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here';
      let parsedByAI = false;

      if (hasGroqKey) {
        try {
          console.log(`[AI Parsing] Parsing ${file.originalname} using Groq AI...`);
          const maskedText = maskSensitiveData(cleanText);
          const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [
                {
                  role: 'system',
                  content: 'You are a structured invoice data extractor. Read the raw text of the invoice and return a JSON object with the following fields: invoiceNo (string), invoiceDate (string YYYY-MM-DD), companyName (string), gstin (string), state (string), stateCode (string), freightCharges (number), cgst (number), sgst (number), igst (number), grandTotal (number), grandTotalInWords (string), items (array of objects with fields: description, hsnAsc, quantity, rate, totalValue). Ensure all numeric fields are numbers. Output only the JSON object, do not explain or include markdown blocks.'
                },
                {
                  role: 'user',
                  content: maskedText
                }
              ],
              temperature: 0.1,
              response_format: { type: "json_object" },
              max_tokens: 1500
            })
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const rawContent = aiData.choices[0].message.content.trim();
            const extracted = JSON.parse(rawContent);

            invoiceNo = extracted.invoiceNo || 'TEMP-' + Math.floor(100 + Math.random() * 900);
            invoiceDate = formatDateToISO(extracted.invoiceDate) || new Date().toISOString().split('T')[0];
            companyName = extracted.companyName || 'Unknown Recipient';
            gstin = (extracted.gstin || '').toUpperCase();
            state = extracted.state || '';
            stateCode = extracted.stateCode || '';
            freightCharges = cleanNumber(extracted.freightCharges);
            cgst = cleanNumber(extracted.cgst);
            sgst = cleanNumber(extracted.sgst);
            igst = cleanNumber(extracted.igst);
            grandTotal = cleanNumber(extracted.grandTotal);
            grandTotalInWords = extracted.grandTotalInWords || convertNumberToWordsBackend(grandTotal);

            if (Array.isArray(extracted.items)) {
              extracted.items.forEach(item => {
                items.push({
                  description: item.description || 'Service',
                  hsnAsc: item.hsnAsc || '-',
                  quantity: cleanNumber(item.quantity) || 1,
                  rate: cleanNumber(item.rate),
                  totalValue: cleanNumber(item.totalValue)
                });
              });
            }
            parsedByAI = true;
            console.log(`[AI Parsing] Successfully parsed ${file.originalname} via Groq.`);
          } else {
            console.warn('[AI Parsing] Groq API returned non-OK status. Falling back to regex.');
          }
        } catch (aiErr) {
          console.error('[AI Parsing] Failed to parse using Groq AI:', aiErr);
        }
      }

      if (!parsedByAI) {
        // Fallback to robust regex-based extraction
        console.log(`[Regex Parsing] Parsing ${file.originalname} using regex fallback...`);

        // 1. Recipient Company Name (excluding supplier "Sakshi")
        let foundCompany = '';
        const companyPatterns = [
          /M\/[sS][.:\s]+([^\n]+)/g,
          /(?:Bill\s+To|Recipient|To)[.:\s]+([^\n]+)/g
        ];
        
        for (const pattern of companyPatterns) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(cleanText)) !== null) {
            const possibleCompany = match[1].trim();
            if (possibleCompany && !possibleCompany.toLowerCase().includes('sakshi')) {
              foundCompany = possibleCompany;
              break;
            }
          }
          if (foundCompany) break;
        }

        if (foundCompany) {
          companyName = foundCompany;
        } else {
          const fallbackMatch = cleanText.match(/M\/[sS][.:\s]+([^\n]+)/i) ||
                                cleanText.match(/(?:Bill\s+To|Recipient|To)[.:\s]+([^\n]+)/i);
          companyName = fallbackMatch ? fallbackMatch[1].trim() : 'Unknown Recipient';
        }

        // 2. Define a text slice representing the recipient address block for localized search
        let recipientBlock = '';
        if (foundCompany) {
          const compIdx = cleanText.indexOf(foundCompany);
          if (compIdx !== -1) {
            recipientBlock = cleanText.substring(compIdx, compIdx + 400);
          }
        }

        // 3. Extract Recipient GSTIN (excluding supplier "07OURPS6573P1ZY")
        let recipientGstin = '';
        if (recipientBlock) {
          const gstinMatch = recipientBlock.match(/GSTIN\s*(?:No)?[.:\s]+([A-Z0-9]{15})/i) ||
                             recipientBlock.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{3}\b/i);
          if (gstinMatch) {
            recipientGstin = gstinMatch[1] ? gstinMatch[1].trim().toUpperCase() : gstinMatch[0].trim().toUpperCase();
          }
        }
        
        if (!recipientGstin) {
          const gstinRegex = /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{3}\b/gi;
          let match;
          while ((match = gstinRegex.exec(cleanText)) !== null) {
            const matchVal = match[0].toUpperCase();
            if (matchVal !== '07OURPS6573P1ZY') {
              recipientGstin = matchVal;
              break;
            }
          }
        }
        
        if (!recipientGstin) {
          const fallbackGstin = cleanText.match(/GSTIN\s*(?:No)?[.:\s]+([A-Z0-9]{15})/i);
          if (fallbackGstin) recipientGstin = fallbackGstin[1].trim().toUpperCase();
        }
        
        gstin = recipientGstin;

        // 4. Recipient State & State Code
        let recipientState = '';
        let recipientStateCode = '';
        
        if (recipientBlock) {
          const stateMatch = recipientBlock.match(/State[.:\s]+([a-zA-Z\s]+?)(?=\s*State\s*Code|\n|$)/i);
          if (stateMatch) recipientState = stateMatch[1].trim();
          
          const codeMatch = recipientBlock.match(/(?:State\s*Code|Code)[.:\s]+(\d+)/i);
          if (codeMatch) recipientStateCode = codeMatch[1].trim();
        }
        
        if (!recipientState) {
          const stateMatch = cleanText.match(/State[.:\s]+([a-zA-Z\s]+?)(?=\s*State\s*Code|\n|$)/i);
          if (stateMatch) recipientState = stateMatch[1].trim();
        }
        
        if (!recipientStateCode) {
          const codeMatch = cleanText.match(/(?:State\s*Code|Code)[.:\s]+(\d+)/i);
          if (codeMatch) recipientStateCode = codeMatch[1].trim();
        }
        
        state = recipientState;
        stateCode = recipientStateCode;

        // 5. Invoice Number & Date
        const noMatch = cleanText.match(/(?:Invoice\s*(?:No|Number)|Bill\s*(?:No|Number))[.:\s]+([A-Za-z0-9\-_/]+)/i);
        if (noMatch) invoiceNo = noMatch[1].trim();
        else {
          invoiceNo = 'TEMP-' + Math.floor(100 + Math.random() * 900);
        }

        const dateMatch = cleanText.match(/(?:Invoice\s*Date|Date|Dated)[.:\s]+([\d\-\/.\s]{8,15})/i);
        if (dateMatch) {
          const rawDate = dateMatch[1].replace(/\s/g, '');
          invoiceDate = formatDateToISO(rawDate) || new Date().toISOString().split('T')[0];
        } else {
          invoiceDate = new Date().toISOString().split('T')[0];
        }

        // 6. Numeric Summary Fields (supporting commas and currency symbols)
        const amtRegexStr = '(?:[₹$]|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d+)?)';

        const freightMatch = cleanText.match(new RegExp('(?:Freight\\s*Charges|Freight)[.:\\s]+' + amtRegexStr, 'i'));
        if (freightMatch) freightCharges = cleanNumber(freightMatch[1]);

        const cgstMatch = cleanText.match(new RegExp('(?:CGST|Central\\s*GST)[.:\\s]+(?:\\d+\\s*%\\s*)?(?:[₹$]|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
        if (cgstMatch) cgst = cleanNumber(cgstMatch[1]);

        const sgstMatch = cleanText.match(new RegExp('(?:SGST|State\\s*GST)[.:\\s]+(?:\\d+\\s*%\\s*)?(?:[₹$]|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
        if (sgstMatch) sgst = cleanNumber(sgstMatch[1]);

        const igstMatch = cleanText.match(new RegExp('(?:IGST|Integrated\\s*GST)[.:\\s]+(?:\\d+\\s*%\\s*)?(?:[₹$]|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
        if (igstMatch) igst = cleanNumber(igstMatch[1]);

        const grandTotalMatch = cleanText.match(new RegExp('\\b(?:Grand\\s*Total|Total\\s*Amount|Total\\s*Payable)\\b[.:\\s]+(?:[₹$]|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
        if (grandTotalMatch) grandTotal = cleanNumber(grandTotalMatch[1]);

        const wordsMatch = cleanText.match(/(?:Grand\s*Total|Total\s*Amount)\s*\(?In\s*Words\)?[:.\s]+([^\n]+)/i);
        if (wordsMatch) {
          grandTotalInWords = wordsMatch[1].trim();
        } else {
          grandTotalInWords = convertNumberToWordsBackend(grandTotal);
        }

        // 7. Stateful Items List Parser
        let itemsText = '';
        const tableStartIdx = cleanText.search(/\bS[l\.]?\s*No\.?/i);
        const tableEndIdx = cleanText.search(/(?:Subtotal|Freight|CGST|SGST|IGST|Total\s*Amount|Grand\s*Total)/i);
        
        if (tableStartIdx !== -1 && tableEndIdx !== -1 && tableEndIdx > tableStartIdx) {
          itemsText = cleanText.substring(tableStartIdx, tableEndIdx);
        } else {
          itemsText = cleanText;
        }

        const lines = itemsText.split('\n').map(l => l.trim()).filter(Boolean);
        
        let currentItem = null;
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;
          
          // Serial number check
          const serMatch = trimmed.match(/^(\d+)[\s.]*$/);
          if (serMatch) {
            const sNo = parseInt(serMatch[1]);
            if (sNo > 0 && sNo < 50) {
              if (currentItem) items.push(currentItem);
              currentItem = {
                description: '',
                hsnAsc: '-',
                quantity: 1,
                rate: 0,
                totalValue: 0
              };
              return;
            }
          }
          
          const qtyRegexStr = '(?:\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.\\d+)?';
          const valRegexStr = '(?:[₹$]|Rs\\.?|INR)?\\s*(?:\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.\\d+)?';
          
          const fullMatch = trimmed.match(new RegExp(`^(\\S+)\\s+(${qtyRegexStr})\\s+(${valRegexStr})\\s+(${valRegexStr})$`)) ||
                            trimmed.match(new RegExp(`^(.+?)\\s+(\\S+)\\s+(${qtyRegexStr})\\s+(${valRegexStr})\\s+(${valRegexStr})$`));
          const mergedMatch = trimmed.match(/^(\d+)$/);

          if (currentItem) {
            if (fullMatch) {
              if (fullMatch.length === 5) {
                currentItem.hsnAsc = fullMatch[1].trim();
                currentItem.quantity = cleanNumber(fullMatch[2]);
                currentItem.rate = cleanNumber(fullMatch[3]);
                currentItem.totalValue = cleanNumber(fullMatch[4]);
              } else if (fullMatch.length === 6) {
                currentItem.description = (currentItem.description + ' ' + fullMatch[1]).trim();
                currentItem.hsnAsc = fullMatch[2].trim();
                currentItem.quantity = cleanNumber(fullMatch[3]);
                currentItem.rate = cleanNumber(fullMatch[4]);
                currentItem.totalValue = cleanNumber(fullMatch[5]);
              }
              items.push(currentItem);
              currentItem = null;
            } else if (mergedMatch) {
              const numStr = mergedMatch[1];
              let guessSubtotal = grandTotal / 1.18;
              const res = splitMergedItem(numStr, guessSubtotal, grandTotal);
              
              currentItem.hsnAsc = res.hsn;
              currentItem.quantity = res.qty;
              currentItem.totalValue = res.total;
              currentItem.rate = currentItem.quantity > 0 ? currentItem.totalValue / currentItem.quantity : currentItem.totalValue;
              
              items.push(currentItem);
              currentItem = null;
            } else {
              const lower = trimmed.toLowerCase();
              if (lower !== 'description' && lower !== 'hsn/sac' && lower !== 'code' && lower !== 'quantityrate' && lower !== 'total' && lower !== 'value') {
                currentItem.description = (currentItem.description + ' ' + trimmed).trim();
              }
            }
          } else {
            if (fullMatch) {
              const newItem = {
                description: fullMatch.length === 6 ? fullMatch[1].trim() : 'Service',
                hsnAsc: fullMatch.length === 6 ? fullMatch[2].trim() : fullMatch[1].trim(),
                quantity: cleanNumber(fullMatch[fullMatch.length - 3]),
                rate: cleanNumber(fullMatch[fullMatch.length - 2]),
                totalValue: cleanNumber(fullMatch[fullMatch.length - 1])
              };
              items.push(newItem);
            }
          }
        });
        
        if (currentItem && currentItem.description) {
          items.push(currentItem);
        }

        if (items.length === 0) {
          items.push({
            description: 'Sales of Services',
            hsnAsc: '9983',
            quantity: 1,
            rate: grandTotal - freightCharges - cgst - sgst - igst,
            totalValue: grandTotal - freightCharges - cgst - sgst - igst
          });
        }
      }

      // Check if invoice number is duplicate in current batch
      if (seenInvoiceNos.has(invoiceNo)) {
        errors.push({
          file: file.originalname,
          error: `Duplicate invoice number: ${invoiceNo} is present multiple times in this upload batch.`
        });
        continue;
      }
      seenInvoiceNos.add(invoiceNo);

      // Check if invoice number is duplicate in database
      const isDuplicate = await Invoice.findOne({ invoiceNo });
      if (isDuplicate) {
        errors.push({
          file: file.originalname,
          error: `Duplicate invoice number: ${invoiceNo} already exists in database.`
        });
        continue;
      }

      const invoice = new Invoice({
        companyName,
        gstin,
        state,
        stateCode,
        invoiceNo,
        invoiceDate,
        items,
        freightCharges,
        cgst,
        sgst,
        igst,
        grandTotal,
        grandTotalInWords
      });

      const savedInvoice = await invoice.save();
      results.push({
        file: file.originalname,
        invoiceNo: savedInvoice.invoiceNo,
        companyName: savedInvoice.companyName,
        grandTotal: savedInvoice.grandTotal
      });

    } catch (err) {
      console.error(`Error parsing file ${file.originalname}:`, err);
      errors.push({
        file: file.originalname,
        error: err.message || 'Unable to parse PDF text.'
      });
    }
  }

  res.json({
    success: true,
    totalUploaded: files.length,
    successCount: results.length,
    failedCount: errors.length,
    results,
    errors
  });
});

// Get all invoices
app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await Invoice.find();
    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'An error occurred while fetching invoices' });
  }
});

// Get a specific invoice by ID
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'An error occurred while fetching the invoice' });
  }
});

// Update an invoice by ID
app.put('/api/invoices/:id', async (req, res) => {
  try {
    const updatedInvoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(updatedInvoice);
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: 'An error occurred while updating the invoice' });
  }
});

// Delete an invoice by ID
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const deletedInvoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!deletedInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'An error occurred while deleting the invoice' });
  }
});
// Mask sensitive corporate or employee data
function maskSensitiveData(text) {
  if (!text) return '';
  let masked = text;
  
  // 1. Bank Account numbers (typically 9-18 digits, preceded by bank keywords)
  masked = masked.replace(/(?:A\/c|Account|A\/C|Acc)(?:[\s.]*(?:No|Number|#))?[\s.:]*\b(\d{9,18})\b/gi, (match, p1) => match.replace(p1, ' [REDACTED_ACCOUNT] '));
  
  // 2. Indian Financial System Code (IFSC) (e.g. SBIN0001234)
  masked = masked.replace(/\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/g, ' [REDACTED_IFSC] ');
  
  // 3. Indian Permanent Account Number (PAN) (e.g. ABCDE1234F)
  masked = masked.replace(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, ' [REDACTED_PAN] ');
  
  // 4. Phone numbers (10 digit mobile, preceded by keywords or with country code)
  masked = masked.replace(/(?:(?:Mob|Mobile|Tel|Phone|Contact|M\.|Ph)[.:\s]*|\+91[\-\s]?)\b([6-9]\d{9})\b/gi, (match, p1) => match.replace(p1, ' [REDACTED_PHONE] '));
  
  // 5. Aadhaar card numbers (12 digits, preceded by Aadhaar/UID or formatted with separators)
  masked = masked.replace(/(?:Aadhaar|Aadhar|UID)[.:\s]*\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b|\b(\d{4}[\s-]\d{4}[\s-]\d{4})\b/gi, (match, p1, p2) => {
    const val = p1 || p2;
    return match.replace(val, ' [REDACTED_AADHAAR] ');
  });

  return masked;
}

// Fetch secure context from Database based on user prompt
const fetchContextFromDb = async (prompt) => {
  if (!prompt || typeof prompt !== 'string') return '';
  let context = '';
  try {
    const promptLower = prompt.toLowerCase();
    
    // 1. Check for specific invoice numbers (e.g. "invoice 45", "invoice no 45", "bill 45")
    const invNoMatch = prompt.match(/(?:invoice|bill|inv)(?:\s*(?:no|number|\#))?\s*(\w+)/i);
    if (invNoMatch) {
      const targetNo = invNoMatch[1];
      let queryVal = targetNo;
      
      const invoices = await Invoice.find({
        $or: [
          { invoiceNo: queryVal },
          { invoiceNo: String(parseInt(queryVal) || queryVal).padStart(3, '0') },
          { invoiceNo: { $regex: queryVal, $options: 'i' } }
        ]
      }).limit(5);
      
      if (invoices.length > 0) {
        context += `\nMatching Invoices found in database:\n`;
        invoices.forEach(inv => {
          context += `* Invoice No: ${inv.invoiceNo}\n`;
          context += `  - Date: ${inv.invoiceDate ? inv.invoiceDate.toISOString().split('T')[0] : 'N/A'}\n`;
          context += `  - Recipient Company: ${inv.companyName}\n`;
          context += `  - Recipient GSTIN: ${inv.gstin || 'N/A'}\n`;
          context += `  - State & Code: ${inv.state} (${inv.stateCode})\n`;
          context += `  - Grand Total: ₹${inv.grandTotal}\n`;
          context += `  - Grand Total in Words: ${inv.grandTotalInWords || 'N/A'}\n`;
          context += `  - Items Details:\n`;
          inv.items.forEach((item, idx) => {
            context += `    [${idx + 1}] ${item.description} | HSN: ${item.hsnAsc} | Qty: ${item.quantity} | Rate: ₹${item.rate} | Total: ₹${item.totalValue}\n`;
          });
          context += `  - Freight Charges: ₹${inv.freightCharges || 0}\n`;
          context += `  - Taxes: CGST ₹${inv.cgst || 0}, SGST ₹${inv.sgst || 0}, IGST ₹${inv.igst || 0}\n\n`;
        });
      }
    }
    
    // 2. Check for company name mentions (e.g. "invoice for avantec")
    const companyKeywords = ['avantec', 'abc', 'corporation', 'industries', 'services', 'enterprise', 'limit', 'ltd'];
    let matchedCompany = null;
    for (const kw of companyKeywords) {
      if (promptLower.includes(kw)) {
        matchedCompany = kw;
        break;
      }
    }
    
    const companyMatch = prompt.match(/(?:invoice|bill|inv)(?:\s*(?:of|for|from|to))?\s+([A-Za-z0-9\s]+)/i);
    let potentialCompany = matchedCompany;
    if (companyMatch && !invNoMatch) {
      const candidate = companyMatch[1].trim();
      if (candidate.length > 2 && !['no', 'number', 'the', 'my', 'any', 'all'].includes(candidate.toLowerCase())) {
        potentialCompany = candidate;
      }
    }
    
    if (potentialCompany) {
      const invoices = await Invoice.find({
        companyName: { $regex: potentialCompany, $options: 'i' }
      }).sort({ invoiceDate: -1 }).limit(5);
      
      if (invoices.length > 0) {
        let hasNewInvoices = invoices.some(inv => !context.includes(inv.invoiceNo));
        if (hasNewInvoices) {
          context += `\nInvoices for company "${potentialCompany}":\n`;
          invoices.forEach(inv => {
            if (!context.includes(inv.invoiceNo)) {
              context += `* Invoice No: ${inv.invoiceNo} | Date: ${inv.invoiceDate ? inv.invoiceDate.toISOString().split('T')[0] : 'N/A'} | Recipient: ${inv.companyName} | Total: ₹${inv.grandTotal}\n`;
              context += `  - Items: ${inv.items.map(i => `${i.description} (Qty: ${i.quantity}, Total: ₹${i.totalValue})`).join(', ')}\n\n`;
            }
          });
        }
      }
    }

    // 3. Match Employee Profiles
    const employees = await Employee.find({});
    const matchedEmployees = [];
    employees.forEach(emp => {
      const nameParts = emp.name.toLowerCase().split(/\s+/);
      const matched = nameParts.some(part => part.length > 2 && promptLower.includes(part));
      if (matched) {
        matchedEmployees.push(emp);
      }
    });

    if (matchedEmployees.length > 0) {
      context += `\nMatching Employee profiles found in database:\n`;
      for (const emp of matchedEmployees) {
        context += `* Employee Name: ${emp.name}\n`;
        context += `  - Designation: ${emp.designation}\n`;
        context += `  - Status: ${emp.status}\n`;
        context += `  - Email: ${emp.email}\n`;
        context += `  - Date of Joining: ${emp.dateOfJoining ? emp.dateOfJoining.toISOString().split('T')[0] : 'N/A'}\n`;
        context += `  - Gross Salary: ₹${emp.grossSalary ? emp.grossSalary.toLocaleString('en-IN') : 'N/A'}\n`;
        context += `  - Default Shift: ${emp.defaultShift || 'Day'}\n`;

        // Fetch salary slips for this employee if prompted
        if (promptLower.includes('salary') || promptLower.includes('pay') || promptLower.includes('slip') || promptLower.includes('wages')) {
          const salarySlips = await SalarySlip.find({ employeeId: emp._id }).sort({ monthOfSalary: -1 }).limit(5);
          if (salarySlips.length > 0) {
            context += `  - Salary Slip History:\n`;
            salarySlips.forEach(slip => {
              context += `    * Month: ${slip.monthOfSalary} | Work Days: ${slip.workDays} | Gross: ₹${slip.totalSalary} | Net In-Hand: ₹${slip.inHandSalary} | OT Hours: ${slip.overtimeHours} | Night Hours: ${slip.nightShiftHours}\n`;
            });
          }
        }

        // Fetch recent attendance logs for this employee if prompted
        if (promptLower.includes('attendance') || promptLower.includes('present') || promptLower.includes('absent') || promptLower.includes('leave') || promptLower.includes('holiday') || promptLower.includes('check')) {
          const attendanceLogs = await Attendance.find({ employeeId: emp._id }).sort({ date: -1 }).limit(10);
          if (attendanceLogs.length > 0) {
            context += `  - Recent Attendance Logs (Latest 10 days):\n`;
            attendanceLogs.forEach(log => {
              const checkInTime = log.checkIn ? new Date(log.checkIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
              const checkOutTime = log.checkOut ? new Date(log.checkOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
              const nightCheckInTime = log.nightCheckIn ? new Date(log.nightCheckIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
              const nightCheckOutTime = log.nightCheckOut ? new Date(log.nightCheckOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
              context += `    * Date: ${log.date} | Status: ${log.status} | Day In/Out: ${checkInTime}/${checkOutTime} | Night In/Out: ${nightCheckInTime}/${nightCheckOutTime} | OT: ${log.overtimeHours} hrs | Night Hrs: ${log.nightShiftHours} hrs\n`;
            });
          }
        }
        context += `\n`;
      }
    }

    // 4. Fetch specific date attendance if date is mentioned (e.g. "attendance for 2026-06-08" or "who is absent today")
    let targetDateStr = null;
    const dateMatch = prompt.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (dateMatch) {
      targetDateStr = dateMatch[0];
    } else if (promptLower.includes('today')) {
      targetDateStr = new Date().toISOString().split('T')[0];
    } else if (promptLower.includes('yesterday')) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDateStr = yesterday.toISOString().split('T')[0];
    }

    if (targetDateStr && (promptLower.includes('attendance') || promptLower.includes('absent') || promptLower.includes('present') || promptLower.includes('leave') || promptLower.includes('holiday'))) {
      const logs = await Attendance.find({ date: targetDateStr }).populate('employeeId', 'name');
      if (logs.length > 0) {
        context += `\nAttendance records for ${targetDateStr}:\n`;
        logs.forEach(log => {
          const empName = log.employeeId?.name || 'Unknown';
          const checkInTime = log.checkIn ? new Date(log.checkIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
          const checkOutTime = log.checkOut ? new Date(log.checkOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
          context += `* Employee: ${empName} | Status: ${log.status} | Day In/Out: ${checkInTime}/${checkOutTime} | Night Shift: ${log.isNightShift ? 'Yes' : 'No'} (${log.nightShiftHours} hrs) | OT: ${log.overtimeHours} hrs\n`;
        });
      } else {
        context += `\nNo attendance logs found for date ${targetDateStr}.\n`;
      }
    }

    // 5. Check for Registered Users / Accounts query
    if (promptLower.includes('user') || promptLower.includes('account') || promptLower.includes('role') || promptLower.includes('admin') || promptLower.includes('registered')) {
      const users = await User.find({}).select('name email role isVerified');
      if (users.length > 0) {
        context += `\nRegistered System Users (Note: Passwords, credentials, and OTP fields are strictly excluded for security):\n`;
        users.forEach(u => {
          context += `* User: ${u.name} | Email: ${u.email} | Role: ${u.role} | Verified: ${u.isVerified ? 'Yes' : 'No'}\n`;
        });
      }
    }

  } catch (err) {
    console.error('Error fetching dynamic database context for AI Chat:', err);
  }
  return context;
};

// In-memory rate limiting cache for AI chat
const rateLimitCache = new Map();

const aiRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 5;

  if (!rateLimitCache.has(ip)) {
    rateLimitCache.set(ip, []);
  }

  const timestamps = rateLimitCache.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitCache.set(ip, timestamps);

  if (timestamps.length > maxRequests) {
    return res.status(429).json({
      error: 'You have reached the limit of 5 queries per minute. Please wait a moment before sending another message.'
    });
  }

  next();
};

// Check if user prompt is querying database statistics or flows
const isDatabaseQuery = (messages) => {
  if (!messages || messages.length === 0) return false;
  const lastMessage = messages[messages.length - 1].content.toLowerCase();
  const keywords = [
    'invoice', 'bill', 'sale', 'earning', 'employee', 'staff', 'worker', 
    'attendance', 'payroll', 'salary', 'how many', 'total', 'summary', 
    'report', 'statistic', 'metrics', 'analytics', 'user', 'account', 
    'role', 'admin', 'how to', 'how do i', 'steps', 'guide', 'navigation', 'workflow'
  ];
  return keywords.some(keyword => lastMessage.includes(keyword));
};

// Fetch real-time aggregated database metadata securely
const getDatabaseSummaryMetadata = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Invoices count and sales total
    const totalInvoices = await Invoice.countDocuments({});
    const salesAggregate = await Invoice.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);
    const totalSales = salesAggregate[0]?.total || 0;

    // Last 6 months sales breakdown
    const monthlySales = await Invoice.aggregate([
      {
        $group: {
          _id: { $substr: ['$invoiceDate', 0, 7] }, // YYYY-MM
          total: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 6 }
    ]);

    // Employee counts
    const totalEmployees = await Employee.countDocuments({});
    const activeEmployees = await Employee.countDocuments({ status: 'Active' });

    // Today's attendance counts
    const attendancePresent = await Attendance.countDocuments({ date: today, status: 'Present' });
    const attendanceAbsent = await Attendance.countDocuments({ date: today, status: 'Absent' });
    const attendanceLeave = await Attendance.countDocuments({ date: today, status: 'Leave' });

    // Build the anonymized summary context string
    let summary = `Current System Database Summary (Real-time aggregates as of ${today}):\n`;
    summary += `- Total Invoices: ${totalInvoices}\n`;
    summary += `- Total Sales Amount: ₹${totalSales.toLocaleString('en-IN')}\n`;
    summary += `- Monthly Sales Breakdown (Last 6 Months):\n`;
    monthlySales.forEach(m => {
      summary += `  * Month ${m._id}: ${m.count} Invoices, Total: ₹${m.total.toLocaleString('en-IN')}\n`;
    });
    summary += `- Total Employees: ${totalEmployees} (${activeEmployees} Active)\n`;
    summary += `- Today's Attendance stats (${today}): ${attendancePresent} Present, ${attendanceAbsent} Absent, ${attendanceLeave} Leave\n`;

    return summary;
  } catch (error) {
    console.error('Error fetching database summary metadata:', error);
    return 'Database summary metadata could not be fetched due to an internal error.';
  }
};

// Static Website Navigation Flow FAQ
const WEBSITE_FLOW_GUIDE = `
SYSTEM WORKFLOW & NAVIGATION GUIDE (Sakshi Enterprises):
1. Adding a New Employee:
   - Navigate to "Employee Management" in the sidebar.
   - Click the "+ Add Employee" button next to the "Registered Employees" title.
   - Complete the form (Name, Email, Designation, Joining Date, Gross Salary, and default shift).
   - Submit the form. The overlay modal closes automatically.
2. Editing Employee Profiles:
   - In "Employee Management", locate the employee in the "Registered Employees" table.
   - Click the blue "Edit" button (pencil icon) in their row.
   - Modify the pre-filled fields in the modal and click "Save".
3. Mark Daily Attendance:
   - Navigate to "Attendance Register" in the sidebar.
   - Click any date cell in the employee's row.
   - Select status (Present, Absent, Leave, Holiday).
   - If "Present", check "Day Shift" and/or "Night Shift" to log either or both shifts. Day overtime hours and Night shift hours are calculated automatically based on check-in/out times. Manual hours adjustments can also be made.
   - Click "Save" to save.
4. Blanket Mark Attendance (Multiple Employees):
   - In "Attendance Register", click "Blanket Mark" in the top-right corner.
   - Select the target Day of the Month and Status.
   - Provide standard shift times if status is Present.
   - Click "Apply All" to apply to all active employees.
5. Generating Salary Slips:
   - Navigate to "Salary Slips / Payrolls" in the sidebar.
   - Select the Employee from the dropdown.
   - Select the Month and Year.
   - The system automatically retrieves attendance, overtime, and night shift records from the database.
   - Manually input or adjust parameters (Shift Hours, Advance, ESIC, Lunch Deduction).
   - Review net in-hand salary calculations and click "Generate & Save".
6. Invoices Management & Printing:
   - Navigate to "Invoices" in the sidebar.
   - To create: Click "Create Invoice", fill Consignee details and items grid (description, HSN, quantity, rate). Tax calculations (CGST/SGST/IGST) and grand totals auto-compute.
   - To search or paginate: Use search box at the top, select items-per-page (10, 20, 50, 100) and page navigation controls.
   - To print: Click "View" (eye icon) on any invoice, then click the "Print" button in the top right. Close button is automatically hidden during printing.
`;

// Helper to parse and execute attendance commands locally (Fallback intent parser)
async function handleLocalAttendanceCommand(message) {
  const employees = await Employee.find({ status: { $nin: ['Inactive', 'Discontinued'] } });
  
  let date = new Date().toISOString().split('T')[0];
  const dateMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (dateMatch) {
    date = dateMatch[0];
  } else if (message.toLowerCase().includes('yesterday')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    date = yesterday.toISOString().split('T')[0];
  }
  
  let status = 'Present';
  const msgLower = message.toLowerCase();
  if (msgLower.includes('absent')) status = 'Absent';
  else if (msgLower.includes('leave')) status = 'Leave';
  else if (msgLower.includes('holiday')) status = 'Holiday';
  
  let checkIn = '09:30';
  let checkOut = '17:30';
  
  const timeRangeRegex = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:to|and|-)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i;
  const match = message.match(timeRangeRegex);
  if (match) {
    let h1 = parseInt(match[1]);
    let m1 = match[2] ? parseInt(match[2]) : 0;
    let amp1 = match[3] ? match[3].toLowerCase() : null;
    
    let h2 = parseInt(match[4]);
    let m2 = match[5] ? parseInt(match[5]) : 0;
    let amp2 = match[6] ? match[6].toLowerCase() : null;
    
    if (amp2 === 'pm' && !amp1 && h1 < 12 && h1 < h2) {
      amp1 = 'am';
    }
    
    if (amp1 === 'pm' && h1 < 12) h1 += 12;
    if (amp1 === 'am' && h1 === 12) h1 = 0;
    
    if (amp2 === 'pm' && h2 < 12) h2 += 12;
    if (amp2 === 'am' && h2 === 12) h2 = 0;
    
    if (!amp1 && !amp2) {
      if (h1 >= 1 && h1 <= 6) h1 += 12;
      if (h2 >= 1 && h2 <= 11 && h2 < h1) h2 += 12;
    }
    
    checkIn = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
    checkOut = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
  }
  
  let targetEmployees = [];
  const isBlanket = msgLower.includes('all') || msgLower.includes('every') || msgLower.includes('blanket');
  
  if (isBlanket) {
    targetEmployees = employees;
  } else {
    targetEmployees = employees.filter(emp => msgLower.includes(emp.name.toLowerCase()));
  }
  
  if (targetEmployees.length === 0) {
    return `I parsed a command to mark attendance, but could not identify which employees to mark. Please specify "all employees" or mention employee names (e.g. Ramesh).`;
  }
  
  let checkInDate = null;
  let checkOutDate = null;
  
  if (status === 'Present') {
    checkInDate = new Date(`${date}T${checkIn}:00+05:30`);
    checkOutDate = new Date(`${date}T${checkOut}:00+05:30`);
  }
  
  const operations = targetEmployees.map(emp => {
    return {
      updateOne: {
        filter: { employeeId: emp._id, date },
        update: {
          $set: {
            status,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            nightCheckIn: null,
            nightCheckOut: null,
            overtimeHours: 0,
            isNightShift: false,
            nightShiftHours: 0
          }
        },
        upsert: true
      }
    };
  });
  
  await Attendance.bulkWrite(operations);
  
  const empNames = targetEmployees.map(e => e.name).join(', ');
  if (isBlanket) {
    return `I have successfully marked all active employees (${targetEmployees.length}) Present for date ${date} from ${checkIn} to ${checkOut} (IST).`;
  } else {
    return `I have successfully marked attendance for ${targetEmployees.length} employees (${empNames}) as ${status} for date ${date}${status === 'Present' ? ` from ${checkIn} to ${checkOut} (IST)` : ''}.`;
  }
}

// Helper to extract employee info from chat history
function extractEmployeeInfo(messages) {
  let name = null;
  let grossSalary = null;
  let dateOfJoining = null;
  let designation = null;
  let location = null;
  let email = null;
  let defaultShift = null;
  let forceSave = false;

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const content = msg.content;

    // 1. Check for force save / proceed in the LAST message
    if (msg === messages[messages.length - 1]) {
      if (/\b(?:save|save anyway|proceed|create|confirm|yes|force)\b/i.test(content)) {
        forceSave = true;
      }
    }

    // 2. Extract Name
    const nameMatch1 = content.match(/(?:add|create|register)\s+employee\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
    const nameMatch2 = content.match(/(?:name\s+is|named)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
    const nameMatch1Ins = content.match(/(?:add|create|register)\s+employee\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
    const nameMatch2Ins = content.match(/(?:name\s+is|named)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);

    let parsedName = null;
    if (nameMatch1) parsedName = nameMatch1[1];
    else if (nameMatch2) parsedName = nameMatch2[1];
    else if (nameMatch1Ins) parsedName = nameMatch1Ins[1];
    else if (nameMatch2Ins) parsedName = nameMatch2Ins[1];

    if (parsedName) {
      parsedName = parsedName.replace(/\b(?:salary|joined|joining|designation|location|email|with|whose|and|as)\b.*/i, '').trim();
      if (parsedName.length > 1) {
        name = parsedName;
      }
    }

    // 3. Extract Salary
    const salaryMatch = content.match(/(?:salary|gross|pay|earns|earning)\b\D*(\d+)/i);
    if (salaryMatch) {
      grossSalary = parseInt(salaryMatch[1]);
    }

    // 4. Extract Date of Joining
    const dateMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) {
      dateOfJoining = dateMatch[1];
    } else if (/\bjoined\s+today\b/i.test(content) || /\bjoining\s+today\b/i.test(content)) {
      dateOfJoining = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } else if (/\bjoined\s+yesterday\b/i.test(content)) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      dateOfJoining = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }

    // 5. Extract Designation
    const desigMatch = content.match(/\b(?:designation|role|title|position)\s*(?:is)?\s*([^,;.\n]+)/i);
    const desigMatch2 = content.match(/\bas\s+a\s+([^,;.\n]+)/i);
    if (desigMatch) {
      let val = desigMatch[1].trim();
      val = val.replace(/\b(?:salary|email|location|joined|joining|and|with|date)\b.*/i, '').trim();
      designation = val;
    } else if (desigMatch2) {
      let val = desigMatch2[1].trim();
      val = val.replace(/\b(?:salary|email|location|joined|joining|and|with|date)\b.*/i, '').trim();
      designation = val;
    }

    // 6. Extract Location
    const locMatch = content.match(/\b(?:location|city|based in|works at|office)\s*(?:is)?\s*([^,;.\n]+)/i);
    if (locMatch) {
      let val = locMatch[1].trim();
      val = val.replace(/\b(?:salary|email|designation|joined|joining|and|with|date)\b.*/i, '').trim();
      location = val;
    } else {
      const cityMatch = content.match(/\b(?:in|at)\s+(New\s+Delhi|Delhi|Noida|Mumbai|Bengaluru|Bangalore|Chennai|Kolkata|Gurugram|Gurgaon|Hyderabad|Pune)\b/i);
      if (cityMatch) {
        location = cityMatch[1].trim();
      }
    }

    // 7. Extract Email
    const emailMatch = content.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    if (emailMatch) {
      email = emailMatch[1];
    }

    // 8. Extract Shift
    const shiftMatch = content.match(/\b(day|night)\s*shift\b/i);
    if (shiftMatch) {
      defaultShift = shiftMatch[1].toLowerCase() === 'night' ? 'Night (20:00 - 04:00)' : 'Day (09:30 - 17:30)';
    }
  }

  return { name, grossSalary, dateOfJoining, designation, location, email, defaultShift, forceSave };
}

// Helper to handle multiple employee additions
async function handleLocalMultipleAddEmployee(message) {
  const parts = message.split(/(?:\band\b|,|\n|;)/i);
  const results = [];
  
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    part = part.replace(/^(?:add|create|register)\s+employees?\s*/i, '');
    
    const extracted = extractEmployeeInfo([{ role: 'user', content: `add employee ${part}` }]);
    
    if (extracted.name && extracted.grossSalary) {
      const dateOfJoining = extracted.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      try {
        const employeeData = {
          name: extracted.name,
          grossSalary: Number(extracted.grossSalary),
          dateOfJoining: new Date(dateOfJoining),
          designation: extracted.designation || '',
          location: extracted.location || '',
          defaultShift: extracted.defaultShift || 'Day (09:30 - 17:30)'
        };
        if (extracted.email) {
          employeeData.email = extracted.email;
        }
        const employee = new Employee(employeeData);
        const saved = await employee.save();
        results.push(`Saved ${saved.name} (Salary: ₹${saved.grossSalary}, Location: ${saved.location || 'N/A'})`);
      } catch (err) {
        results.push(`Failed to save ${extracted.name}: ${err.message}`);
      }
    }
  }
  
  if (results.length > 0) {
    return `Bulk Add Result:\n` + results.map(r => `- ${r}`).join('\n');
  } else {
    return `I detected a request to add multiple employees, but could not parse their names and salaries. Please format like: 'Add Ramesh (salary 25000) and Suresh (salary 30000)'.`;
  }
}

// Fallback logic to add employee locally
async function handleLocalAddEmployeeCommand(messages) {
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  const msgLower = lastUserMessage.toLowerCase();

  const isMultipleAdd = (msgLower.includes('employees') || msgLower.includes('and')) && 
                        (msgLower.includes('add') || msgLower.includes('register'));
  
  if (isMultipleAdd && !msgLower.includes('save') && !msgLower.includes('proceed')) {
    const parts = lastUserMessage.split(/\band\b/i);
    if (parts.length > 1 && parts.some(p => p.toLowerCase().includes('salary') || p.toLowerCase().includes('gross'))) {
      return await handleLocalMultipleAddEmployee(lastUserMessage);
    }
  }

  const extracted = extractEmployeeInfo(messages);

  if (!extracted.name) {
    return `I detected you want to add a new employee, but I couldn't find the employee's name. Please say something like: "Add employee Ramesh".`;
  }

  const missing = [];
  if (!extracted.grossSalary) missing.push('Gross Salary (e.g. "salary is 25000")');
  if (!extracted.dateOfJoining) missing.push('Date of Joining (e.g. "joining date 2026-06-01")');
  if (!extracted.designation) missing.push('Designation (e.g. "designation is Developer")');
  if (!extracted.location) missing.push('Location (e.g. "location is Delhi")');

  if (missing.length > 0 && !extracted.forceSave) {
    const missingList = missing.map(m => `- ${m}`).join('\n');
    return `I detected that you want to add **${extracted.name}**.\n\nI still need the following details to complete the registration:\n${missingList}\n\nPlease provide them (e.g. "salary is 25000, location is Noida"), or reply **"save"** to proceed with only the current details.`;
  }

  try {
    const dateOfJoining = extracted.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const grossSalary = extracted.grossSalary || 0;

    const employeeData = {
      name: extracted.name,
      grossSalary: Number(grossSalary),
      dateOfJoining: new Date(dateOfJoining),
      designation: extracted.designation || '',
      location: extracted.location || '',
      defaultShift: extracted.defaultShift || 'Day (09:30 - 17:30)'
    };

    if (extracted.email) {
      employeeData.email = extracted.email;
    }

    const employee = new Employee(employeeData);
    const savedEmployee = await employee.save();

    return `Successfully added new employee **${savedEmployee.name}**! 🎉\n` +
           `- Designation: ${savedEmployee.designation || 'N/A'}\n` +
           `- Location: ${savedEmployee.location || 'N/A'}\n` +
           `- Gross Salary: ₹${savedEmployee.grossSalary}\n` +
           `- Date of Joining: ${dateOfJoining}\n` +
           `- Default Shift: ${savedEmployee.defaultShift}`;
  } catch (err) {
    console.error('Error saving employee locally:', err);
    return `Failed to save employee: ${err.message}`;
  }
}

// AI Chat Copilot endpoint
app.post('/api/ai/chat', aiRateLimiter, async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages are required and must be an array.' });
  }

  const lastUserMessage = messages[messages.length - 1]?.content || '';
  const msgLower = lastUserMessage.toLowerCase();
  const isAttendanceCommand = msgLower.includes('mark') && 
                              (msgLower.includes('attendance') || 
                               msgLower.includes('present') || 
                               msgLower.includes('absent') || 
                               msgLower.includes('leave') || 
                               msgLower.includes('holiday'));

  let isAddEmployeeTurn = false;
  const isEmployeeAddCommand = msgLower.includes('add') && 
                               (msgLower.includes('employee') || 
                                msgLower.includes('member') || 
                                msgLower.includes('staff') || 
                                msgLower.includes('worker') ||
                                msgLower.includes('profile'));
                                
  if (isEmployeeAddCommand) {
    isAddEmployeeTurn = true;
  } else {
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length > 0) {
      const lastAssistantMsg = assistantMessages[assistantMessages.length - 1].content;
      if (lastAssistantMsg.includes('Please provide the missing details') || 
          lastAssistantMsg.includes('Please provide the remaining recommended field') ||
          lastAssistantMsg.includes('I still need the following details') ||
          lastAssistantMsg.includes('I detected you want to add a new employee')) {
        isAddEmployeeTurn = true;
      }
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  const isPlaceholderKey = !apiKey || apiKey === 'your_groq_api_key_here';

  // Fallback Employee Add Parser for Local Testing/No API Key
  if (isPlaceholderKey && isAddEmployeeTurn) {
    console.log('[AI Chat] Fallback Mode: Parsing local employee add command:', lastUserMessage);
    try {
      const reply = await handleLocalAddEmployeeCommand(messages);
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: reply
            }
          }
        ]
      });
    } catch (err) {
      console.error('[AI Chat] Fallback employee add error:', err);
      return res.status(500).json({ error: 'Failed to execute fallback employee add command.' });
    }
  }

  // Fallback Intent Parser for Local Testing/No API Key
  if (isPlaceholderKey && isAttendanceCommand) {
    console.log('[AI Chat] Fallback Mode: Parsing local attendance command:', lastUserMessage);
    try {
      const reply = await handleLocalAttendanceCommand(lastUserMessage);
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: reply
            }
          }
        ]
      });
    } catch (err) {
      console.error('[AI Chat] Fallback attendance mark error:', err);
      return res.status(500).json({ error: 'Failed to execute fallback attendance command.' });
    }
  }

  if (isPlaceholderKey) {
    console.warn('GROQ_API_KEY is not defined or is placeholder. Returning a stubbed helpful response.');
    return res.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello! I am ABHI digi AI. Currently, the Groq API key is not configured in the backend, but I am ready to help you manage invoices, track attendance, and draft emails once it is set up!'
          }
        }
      ]
    });
  }

  // Cap message history to last 6 messages (3 turns) to control token usage
  const capMessages = messages.slice(-6);

  // Mask sensitive information in user messages before sending to AI
  const sanitizedMessages = capMessages.map(msg => ({
    role: msg.role,
    content: maskSensitiveData(msg.content)
  }));

  // Base system instructions
  let systemPromptText = 'You are ABHI digi AI, a secure corporate billing and payroll assistant for Sakshi Enterprises. You help users draft emails (e.g. invoice sending, payment reminders, salary slip notices), explain billing and Indian taxation concepts (CGST, SGST, IGST, HSN codes), and guide them on how to navigate this invoice and payroll system. For security, never ask for or process passwords, bank credentials, or private personal identifiers. Be concise, polite, and professional. IMPORTANT: For attendance marking, you have access to tools to update attendance logs (blanket mark all active employees, or mark specific employees). Use these tools whenever the user requests to mark attendance. You also have the `addEmployee` tool to register new employees. If a user asks to add an employee, you must interactively gather the required/recommended details: Name, Gross Salary, Date of Joining, Designation, and Location. Do not prompt for Email or Default Shift as they are strictly optional. If any of these recommended/required fields are missing, list them and ask the user to provide them before you invoke the `addEmployee` tool. However, if the user instructs you to save/proceed anyway with the details they have provided, you may execute the tool with what is available. For all other database entities (invoices, employee salary slips, and payroll profiles), you are strictly read-only and cannot write, modify, or delete them. If a user asks you to modify those, instruct them to use the dashboard controls manually.';

  // Inject real-time MongoDB context if user asks about data analytics/records
  if (isDatabaseQuery(capMessages)) {
    console.log('[AI Chat] Analytics query detected. Fetching secure MongoDB aggregate metadata...');
    const dbSummary = await getDatabaseSummaryMetadata();
    systemPromptText += `\n\nReal-time database context for answering user questions:\n${dbSummary}`;
  }

  // Inject specific database document details mentioned in the user prompt (e.g. invoice no 45, employee Ramesh)
  const userPrompt = sanitizedMessages[sanitizedMessages.length - 1]?.content || '';
  const specificContext = await fetchContextFromDb(userPrompt);
  if (specificContext) {
    console.log('[AI Chat] Specific database document context fetched. Injecting...');
    systemPromptText += `\n\nSpecific document details fetched from database to help you answer the user's request:\n${specificContext}`;
  }

  // Inject Website Flow Navigation Guide if user is seeking instructions or help
  const isNavigationQuery = sanitizedMessages.some(msg => {
    const txt = msg.content.toLowerCase();
    return txt.includes('how') || txt.includes('step') || txt.includes('guide') || txt.includes('navigate') || txt.includes('flow') || txt.includes('workflow') || txt.includes('instruction') || txt.includes('help');
  });
  if (isNavigationQuery) {
    console.log('[AI Chat] Navigation instruction query detected. Injecting website flow guide...');
    systemPromptText += `\n\n${WEBSITE_FLOW_GUIDE}`;
  }

  const systemPrompt = {
    role: 'system',
    content: systemPromptText
  };

  const tools = [
    {
      type: 'function',
      function: {
        name: 'blanketMarkAttendance',
        description: 'Mark attendance for all active employees at once for a specific day.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'The date in YYYY-MM-DD format.' },
            status: { type: 'string', enum: ['Present', 'Absent', 'Leave', 'Holiday'], description: 'Attendance status' },
            checkIn: { type: 'string', description: 'Check-in time (HH:MM format, 24-hour clock, defaults to 09:30)' },
            checkOut: { type: 'string', description: 'Check-out time (HH:MM format, 24-hour clock, defaults to 17:30)' }
          },
          required: ['date', 'status']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'markMultipleEmployeesAttendance',
        description: 'Mark attendance for a specific list of employees by their name on a specific day.',
        parameters: {
          type: 'object',
          properties: {
            employeeNames: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of employee names to mark attendance for.' 
            },
            date: { type: 'string', description: 'The date in YYYY-MM-DD format.' },
            status: { type: 'string', enum: ['Present', 'Absent', 'Leave', 'Holiday'], description: 'Attendance status' },
            checkIn: { type: 'string', description: 'Check-in time (HH:MM format, 24-hour clock, defaults to 09:30)' },
            checkOut: { type: 'string', description: 'Check-out time (HH:MM format, 24-hour clock, defaults to 17:30)' }
          },
          required: ['employeeNames', 'date', 'status']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addEmployee',
        description: 'Add a new employee to the database.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name of the employee.' },
            grossSalary: { type: 'number', description: 'Gross monthly salary of the employee in INR.' },
            dateOfJoining: { type: 'string', description: 'Date of joining in YYYY-MM-DD format.' },
            designation: { type: 'string', description: 'Designation / job title (e.g. Developer, Clerk).' },
            location: { type: 'string', description: 'Working location (e.g. Delhi, Noida).' },
            email: { type: 'string', description: 'Email address of the employee (Optional).' },
            defaultShift: { type: 'string', description: 'Default shift timing (e.g. Day (09:30 - 17:30) or Night (20:00 - 04:00)). Default is Day (09:30 - 17:30).' }
          },
          required: ['name', 'grossSalary', 'dateOfJoining']
        }
      }
    }
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [systemPrompt, ...sanitizedMessages],
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', errText);
      return res.status(502).json({ error: 'Failed to communicate with AI service. Please try again.' });
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    // Parse and execute text-based tool calls in content field (e.g. from Llama 3.1)
    let content = message?.content || '';
    const textToolRegex = /<function>(\w+)>?(.*?)<\/function>/gs;
    let textToolMatch;
    let textResults = [];
    let executedAnyTextTool = false;

    textToolRegex.lastIndex = 0;
    while (message && (textToolMatch = textToolRegex.exec(content)) !== null) {
      const funcName = textToolMatch[1];
      const argsStr = textToolMatch[2].trim();
      console.log(`[AI Chat] Intercepted text-based tool call in content: ${funcName} with args: ${argsStr}`);
      
      let args = {};
      try {
        if (argsStr) {
          args = JSON.parse(argsStr);
        }
      } catch (e) {
        console.error('[AI Chat] Failed to parse text-based tool call JSON arguments:', e);
      }

      let resultMsg = "";
      try {
        if (funcName === 'addEmployee') {
          executedAnyTextTool = true;
          const employeeData = {
            name: args.name,
            grossSalary: Number(args.grossSalary),
            dateOfJoining: args.dateOfJoining ? new Date(args.dateOfJoining) : new Date(),
            designation: args.designation || '',
            location: args.location || '',
            defaultShift: args.defaultShift || 'Day (09:30 - 17:30)'
          };
          if (args.email && args.email.trim() !== '') {
            employeeData.email = args.email;
          }
          const employee = new Employee(employeeData);
          const savedEmployee = await employee.save();
          resultMsg = `Successfully added new employee **${savedEmployee.name}**! 🎉\n` +
                      `- Designation: ${savedEmployee.designation || 'N/A'}\n` +
                      `- Location: ${savedEmployee.location || 'N/A'}\n` +
                      `- Gross Salary: ₹${savedEmployee.grossSalary}\n` +
                      `- Date of Joining: ${args.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}`;
        } else if (funcName === 'blanketMarkAttendance') {
          executedAnyTextTool = true;
          const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
          let checkInDate = null;
          let checkOutDate = null;
          if (args.status === 'Present') {
            const checkIn = args.checkIn || '09:30';
            const checkOut = args.checkOut || '17:30';
            checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
            checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
          }
          const operations = employees.map(emp => ({
            updateOne: {
              filter: { employeeId: emp._id, date: args.date },
              update: {
                $set: {
                  status: args.status,
                  checkIn: checkInDate,
                  checkOut: checkOutDate,
                  nightCheckIn: null,
                  nightCheckOut: null,
                  overtimeHours: 0,
                  isNightShift: false,
                  nightShiftHours: 0
                }
              },
              upsert: true
            }
          }));
          await Attendance.bulkWrite(operations);
          resultMsg = `Successfully marked all active employees (${employees.length}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
        } else if (funcName === 'markMultipleEmployeesAttendance') {
          executedAnyTextTool = true;
          const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
          const names = args.employeeNames.map(n => n.toLowerCase());
          const targetEmployees = employees.filter(emp => names.some(n => emp.name.toLowerCase().includes(n) || n.includes(emp.name.toLowerCase())));

          if (targetEmployees.length === 0) {
            resultMsg = `Could not find any active employees matching the names: ${args.employeeNames.join(', ')}.`;
          } else {
            let checkInDate = null;
            let checkOutDate = null;
            if (args.status === 'Present') {
              const checkIn = args.checkIn || '09:30';
              const checkOut = args.checkOut || '17:30';
              checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
              checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
            }
            const operations = targetEmployees.map(emp => ({
              updateOne: {
                filter: { employeeId: emp._id, date: args.date },
                update: {
                  $set: {
                    status: args.status,
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    nightCheckIn: null,
                    nightCheckOut: null,
                    overtimeHours: 0,
                    isNightShift: false,
                    nightShiftHours: 0
                  }
                },
                upsert: true
              }
            }));
            await Attendance.bulkWrite(operations);
            const matchedNames = targetEmployees.map(e => e.name).join(', ');
            resultMsg = `Successfully marked attendance for ${targetEmployees.length} employees (${matchedNames}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
          }
        }
      } catch (err) {
        console.error(`Error executing text tool ${funcName}:`, err);
        resultMsg = `Failed to execute tool ${funcName}: ${err.message}`;
      }

      if (resultMsg) {
        textResults.push(resultMsg);
      }
    }

    // Clean up content from any function tags
    content = content.replace(/<function>.*?<\/function>/gs, '').trim();

    if (executedAnyTextTool) {
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: textResults.join('\n') + (content ? `\n\n${content}` : '')
            }
          }
        ]
      });
    }

    if (message) {
      message.content = content;
    }

    if (message && message.tool_calls && message.tool_calls.length > 0) {
      console.log('[AI Chat] LLM triggered tool calls:', message.tool_calls.map(tc => tc.function.name));
      const results = [];
      for (const call of message.tool_calls) {
        const funcName = call.function.name;
        const args = JSON.parse(call.function.arguments);
        let resultMsg = "";

        try {
          if (funcName === 'blanketMarkAttendance') {
            const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
            let checkInDate = null;
            let checkOutDate = null;
            if (args.status === 'Present') {
              const checkIn = args.checkIn || '09:30';
              const checkOut = args.checkOut || '17:30';
              checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
              checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
            }
            const operations = employees.map(emp => ({
              updateOne: {
                filter: { employeeId: emp._id, date: args.date },
                update: {
                  $set: {
                    status: args.status,
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    nightCheckIn: null,
                    nightCheckOut: null,
                    overtimeHours: 0,
                    isNightShift: false,
                    nightShiftHours: 0
                  }
                },
                upsert: true
              }
            }));
            await Attendance.bulkWrite(operations);
            resultMsg = `Successfully marked all active employees (${employees.length}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
          } else if (funcName === 'markMultipleEmployeesAttendance') {
            const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
            const names = args.employeeNames.map(n => n.toLowerCase());
            const targetEmployees = employees.filter(emp => names.some(n => emp.name.toLowerCase().includes(n) || n.includes(emp.name.toLowerCase())));

            if (targetEmployees.length === 0) {
              resultMsg = `Could not find any active employees matching the names: ${args.employeeNames.join(', ')}.`;
            } else {
              let checkInDate = null;
              let checkOutDate = null;
              if (args.status === 'Present') {
                const checkIn = args.checkIn || '09:30';
                const checkOut = args.checkOut || '17:30';
                checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
                checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
              }
              const operations = targetEmployees.map(emp => ({
                updateOne: {
                  filter: { employeeId: emp._id, date: args.date },
                  update: {
                    $set: {
                      status: args.status,
                      checkIn: checkInDate,
                      checkOut: checkOutDate,
                      nightCheckIn: null,
                      nightCheckOut: null,
                      overtimeHours: 0,
                      isNightShift: false,
                      nightShiftHours: 0
                    }
                  },
                  upsert: true
                }
              }));
              await Attendance.bulkWrite(operations);
              const matchedNames = targetEmployees.map(e => e.name).join(', ');
              resultMsg = `Successfully marked attendance for ${targetEmployees.length} employees (${matchedNames}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
            }
          } else if (funcName === 'addEmployee') {
            const employeeData = {
              name: args.name,
              grossSalary: Number(args.grossSalary),
              dateOfJoining: new Date(args.dateOfJoining),
              designation: args.designation || '',
              location: args.location || '',
              defaultShift: args.defaultShift || 'Day (09:30 - 17:30)'
            };
            if (args.email && args.email.trim() !== '') {
              employeeData.email = args.email;
            }
            try {
              const employee = new Employee(employeeData);
              const savedEmployee = await employee.save();
              resultMsg = `Successfully added new employee ${savedEmployee.name} with Designation: ${savedEmployee.designation || 'N/A'}, Location: ${savedEmployee.location || 'N/A'}, Salary: ₹${savedEmployee.grossSalary}, and Date of Joining: ${args.dateOfJoining}.`;
            } catch (saveErr) {
              resultMsg = `Failed to add employee: ${saveErr.message}`;
            }
          }
        } catch (err) {
          console.error(`Error executing tool ${funcName}:`, err);
          resultMsg = `Failed to execute tool ${funcName}: ${err.message}`;
        }
        results.push(resultMsg);
      }

      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: results.join('\n')
            }
          }
        ]
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Error in AI Chat API:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Mongoose schema for Employee
const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  dateOfJoining: { type: Date, required: true },
  grossSalary: { type: Number, required: true },
  designation: { type: String, default: '' },
  location: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'On Hold', 'On Holiday', 'Inactive', 'Discontinued'], default: 'Active' },
  defaultShift: { type: String, default: 'Day (09:30 - 17:30)' }
});

const Employee = mongoose.model('Employee', employeeSchema);

// Sync indexes to ensure unique sparse email index is created correctly
Employee.syncIndexes().catch(err => {
  console.log('Error syncing Employee indexes, attempting dropIndex email_1 first...');
  Employee.collection.dropIndex('email_1')
    .then(() => Employee.syncIndexes())
    .catch(dropErr => console.log('Employee index sync deferred or index already clean:', dropErr.message));
});

// Mongoose schema for Attendance
const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  checkIn: { type: Date },
  checkOut: { type: Date },
  nightCheckIn: { type: Date },
  nightCheckOut: { type: Date },
  status: { type: String, enum: ['Present', 'Absent', 'Leave', 'Holiday'], default: 'Absent' },
  overtimeHours: { type: Number, default: 0 },
  isNightShift: { type: Boolean, default: false },
  nightShiftHours: { type: Number, default: 0 }
});

const Attendance = mongoose.model('Attendance', attendanceSchema);

// Route to get all employees
app.get('/api/employees', async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'An error occurred while fetching employees' });
  }
});

// Route to add a new employee
app.post('/api/employees', async (req, res) => {
  try {
    const employeeData = { ...req.body };
    if (!employeeData.email || employeeData.email.trim() === '') {
      delete employeeData.email;
    }
    const employee = new Employee(employeeData);
    const savedEmployee = await employee.save();
    res.status(201).json(savedEmployee);
  } catch (error) {
    console.error('Error saving employee:', error);
    res.status(500).json({ error: error.message || 'An error occurred while saving the employee' });
  }
});

// Route to update an employee by ID
app.put('/api/employees/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    const updateQuery = {};
    if (!updateData.email || updateData.email.trim() === '') {
      delete updateData.email;
      updateQuery.$set = updateData;
      updateQuery.$unset = { email: "" };
    } else {
      updateQuery.$set = updateData;
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(req.params.id, updateQuery, { new: true });
    if (!updatedEmployee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(updatedEmployee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: error.message || 'An error occurred while updating the employee' });
  }
});

// Route to delete an employee by ID
app.delete('/api/employees/:id', async (req, res) => {
  try {
    const deletedEmployee = await Employee.findByIdAndDelete(req.params.id);
    if (!deletedEmployee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'An error occurred while deleting the employee' });
  }
});

// Route to get all active employees (Active, On Hold, On Holiday)
app.get('/api/employees/active', async (req, res) => {
  try {
    // Fetch employees who are not 'Inactive' or 'Discontinued'
    const activeEmployees = await Employee.find({ status: { $nin: ['Inactive', 'Discontinued'] } });
    res.json(activeEmployees);
  } catch (error) {
    console.error('Error fetching active employees:', error);
    res.status(500).json({ error: 'An error occurred while fetching active employees' });
  }
});


// Mongoose schema for Salary Slip
const salarySlipSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  monthOfSalary: { type: String, required: true },
  workDays: { type: Number, required: true },
  salaryByWorkDays: { type: Number, required: true },
  overtimeHours: { type: Number, default: 0 },
  overtimeSalary: { type: Number, default: 0 },
  nightShiftHours: { type: Number, default: 0 },
  nightShiftDays: { type: Number, default: 0 },
  nightShiftRate: { type: Number, default: 0 },
  nightShiftAllowance: { type: Number, default: 0 },
  totalSalary: { type: Number, required: true },
  advance: { type: Number, default: 0 },
  esic: { type: Number, default: 0 },
  lunchDays: { type: Number, default: 0 },
  lunchRate: { type: Number, default: 0 },
  lunchDeduction: { type: Number, default: 0 },
  shiftHours: { type: Number, default: 8 },
  inHandSalary: { type: Number, required: true }
});

const SalarySlip = mongoose.model('SalarySlip', salarySlipSchema);

// Route to get all salary slips
app.get('/api/salary-slips', async (req, res) => {
  try {
    const salarySlips = await SalarySlip.find().populate('employeeId', 'name designation grossSalary dateOfJoining');
    res.json(salarySlips);
  } catch (error) {
    console.error('Error fetching salary slips:', error);
    res.status(500).json({ error: 'An error occurred while fetching salary slips' });
  }
});

// Route to create a new salary slip
app.post('/api/salary-slips', async (req, res) => {
  try {
    const salarySlipData = req.body;
    const salaryByWorkDays = Math.floor(salarySlipData.salaryByWorkDays || 0);
    const overtimeSalary = Math.floor(salarySlipData.overtimeSalary || 0);
    const nightShiftHours = parseFloat(salarySlipData.nightShiftHours || 0);
    const nightShiftDays = parseInt(salarySlipData.nightShiftDays || 0);
    const nightShiftRate = Math.floor(parseFloat(salarySlipData.nightShiftRate || 0));
    
    let nightShiftAllowance = 0;
    if (nightShiftHours > 0) {
      nightShiftAllowance = Math.floor(nightShiftHours * nightShiftRate);
    } else {
      nightShiftAllowance = Math.floor(nightShiftDays * nightShiftRate);
    }
    
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary + nightShiftAllowance);
    const esic = Math.floor(salarySlipData.esic || 0);
    const advance = Math.floor(salarySlipData.advance || 0);
    const lunchDeduction = Math.floor(salarySlipData.lunchDeduction || 0);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);

    const salarySlip = new SalarySlip({
      ...salarySlipData,
      salaryByWorkDays,
      overtimeSalary,
      nightShiftHours,
      nightShiftDays,
      nightShiftRate,
      nightShiftAllowance,
      totalSalary,
      esic,
      advance,
      lunchDeduction,
      inHandSalary
    });

    const savedSalarySlip = await salarySlip.save();
    res.status(201).json(savedSalarySlip);
  } catch (error) {
    console.error('Error saving salary slip:', error);
    res.status(500).json({ error: 'An error occurred while saving the salary slip' });
  }
});

// Route to delete a salary slip by ID
app.delete('/api/salary-slips/:id', async (req, res) => {
  try {
    const deletedSalarySlip = await SalarySlip.findByIdAndDelete(req.params.id);
    if (!deletedSalarySlip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }
    res.json({ message: 'Salary slip deleted successfully' });
  } catch (error) {
    console.error('Error deleting salary slip:', error);
    res.status(500).json({ error: 'An error occurred while deleting the salary slip' });
  }
});

// Attendance Check-In Endpoint
app.post('/api/attendance/check-in', async (req, res) => {
  const { email } = req.body;

  try {
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found for this email' });
    }

    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const existingAttendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });
    if (existingAttendance) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    const newAttendance = new Attendance({
      employeeId: employee._id,
      date: todayStr,
      checkIn: new Date(),
      status: 'Present'
    });
    await newAttendance.save();

    res.status(201).json({ success: true, message: 'Checked in successfully!', attendance: newAttendance });
  } catch (error) {
    console.error('Error during check-in:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Attendance Check-Out Endpoint
app.post('/api/attendance/check-out', async (req, res) => {
  const { email } = req.body;

  try {
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found for this email' });
    }

    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });
    if (!attendance) {
      return res.status(400).json({ success: false, message: 'Please check in first' });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ success: false, message: 'Already checked out today' });
    }

    attendance.checkOut = new Date();
    await attendance.save();

    res.status(200).json({ success: true, message: 'Checked out successfully!', attendance });
  } catch (error) {
    console.error('Error during check-out:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get My Attendance Records Endpoint
app.get('/api/attendance/my-records', async (req, res) => {
  const { email } = req.query;

  try {
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(200).json([]); // Return empty list if no employee record exists yet
    }

    const records = await Attendance.find({ employeeId: employee._id }).sort({ date: -1 });
    res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get All Attendance Records Endpoint (Admin)
app.get('/api/attendance', async (req, res) => {
  try {
    const records = await Attendance.find().populate('employeeId');
    res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching all attendance records:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get My Salary Slips Endpoint
app.get('/api/salary-slips/my-slips', async (req, res) => {
  const { email } = req.query;

  try {
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(200).json([]);
    }

    const salarySlips = await SalarySlip.find({ employeeId: employee._id }).populate('employeeId', 'name designation grossSalary dateOfJoining');
    res.status(200).json(salarySlips);
  } catch (error) {
    console.error('Error fetching salary slips:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get My Employee Profile Endpoint
app.get('/api/employees/my-profile', async (req, res) => {
  const { email } = req.query;

  try {
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }
    res.status(200).json(employee);
  } catch (error) {
    console.error('Error fetching employee profile:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get All Users Endpoint (Admin Only)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update User Endpoint (Admin Only)
app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, role, isVerified } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, role, isVerified },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Request OTP for Profile Password Update
app.post('/api/users/profile/request-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate a 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    await user.save();

    await sendOTPEmail(
      user.email,
      otp,
      'Password Change Verification OTP - Sakshi Enterprises',
      `Your OTP for updating your account password is: ${otp}. This code is valid for 10 minutes.`
    );

    res.json({ success: true, message: 'OTP sent successfully to your email.' });
  } catch (error) {
    console.error('Error requesting profile OTP:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update User Profile Endpoint (Self Update)
app.put('/api/users/profile/:id', async (req, res) => {
  try {
    const { name, email, password, otp } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({ error: 'Email is already in use' });
      }
      user.email = email;
    }

    if (name) {
      user.name = name;
    }

    if (password && password.trim() !== '') {
      if (!otp) {
        return res.status(400).json({ error: 'OTP is required to update the password.' });
      }
      if (user.otp !== otp || new Date() > user.otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired OTP.' });
      }
      
      user.password = await bcrypt.hash(password, 10);
      user.otp = undefined;
      user.otpExpires = undefined;
    }

    const savedUser = await user.save();
    res.json({
      id: savedUser._id,
      name: savedUser.name,
      email: savedUser.email,
      role: savedUser.role
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete User Endpoint (Admin Only)
app.delete('/api/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update Salary Slip Endpoint (Admin Only)
app.put('/api/salary-slips/:id', async (req, res) => {
  try {
    const salarySlipData = req.body;
    
    // Recalculate using strict intermediate flooring
    const workDays = parseInt(salarySlipData.workDays || 0);
    const otHours = parseFloat(salarySlipData.otHours || 0);
    const advance = Math.floor(parseFloat(salarySlipData.advance || 0));
    const esic = Math.floor(parseFloat(salarySlipData.esic || 0));
    const lunchDays = parseInt(salarySlipData.lunchDays || 0);
    const lunchRate = Math.floor(parseFloat(salarySlipData.lunchRate || 0));
    const shiftHours = parseInt(salarySlipData.shiftHours || 8);
    
    // Query gross salary of employee
    const employee = await Employee.findById(salarySlipData.employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }
    
    const monthOfSalary = salarySlipData.monthOfSalary || '';
    const [monthName, yearStr] = monthOfSalary.split(' ');
    const monthMap = {
      'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
      'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    };
    const monthNum = monthMap[monthName] || 1;
    const yearNum = parseInt(yearStr) || new Date().getFullYear();
    const calendarDays = new Date(yearNum, monthNum, 0).getDate();
    
    const nightShiftHours = parseFloat(salarySlipData.nightShiftHours || 0);
    const nightShiftDays = parseInt(salarySlipData.nightShiftDays || 0);
    const nightShiftRate = Math.floor(parseFloat(salarySlipData.nightShiftRate || 0));
    
    let nightShiftAllowance = 0;
    if (nightShiftHours > 0) {
      nightShiftAllowance = Math.floor(nightShiftHours * nightShiftRate);
    } else {
      nightShiftAllowance = Math.floor(nightShiftDays * nightShiftRate);
    }
    
    const dailyRate = Math.floor(employee.grossSalary / calendarDays);
    const salaryByWorkDays = Math.floor(workDays * dailyRate);
    const hourlyOtRate = Math.floor(dailyRate / shiftHours);
    const overtimeSalary = Math.floor(otHours * hourlyOtRate);
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary + nightShiftAllowance);
    const lunchDeduction = Math.floor(lunchDays * lunchRate);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);
    
    const updatedSalarySlip = await SalarySlip.findByIdAndUpdate(
      req.params.id,
      {
        workDays,
        salaryByWorkDays,
        overtimeHours: otHours,
        overtimeSalary,
        nightShiftHours,
        nightShiftDays,
        nightShiftRate,
        nightShiftAllowance,
        totalSalary,
        advance,
        esic,
        lunchDays,
        lunchRate,
        lunchDeduction,
        shiftHours,
        inHandSalary,
        monthOfSalary
      },
      { new: true }
    );
    
    if (!updatedSalarySlip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }
    res.json(updatedSalarySlip);
  } catch (error) {
    console.error('Error updating salary slip:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Mark Attendance Endpoint (Admin Only)
app.post('/api/attendance/admin-mark', async (req, res) => {
  const { employeeId, date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  try {
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const defaultShift = employee.defaultShift || 'Day (09:30 - 17:30)';
      const isNight = defaultShift.includes('Night');
      
      let defaultDayIn = '09:30';
      let defaultDayOut = '17:30';
      if (defaultShift.includes('09:00')) {
        defaultDayIn = '09:00';
        defaultDayOut = '17:00';
      }
      
      let defaultNightIn = '20:00';
      let defaultNightOut = '04:00';
      
      const timeMatch = defaultShift.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (timeMatch) {
        if (isNight) {
          defaultNightIn = timeMatch[1];
          defaultNightOut = timeMatch[2];
        } else {
          defaultDayIn = timeMatch[1];
          defaultDayOut = timeMatch[2];
        }
      }

      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        const inStr = checkIn || defaultDayIn;
        const outStr = checkOut || defaultDayOut;
        checkInDate = new Date(`${date}T${inStr}:00+05:30`);
        checkOutDate = new Date(`${date}T${outStr}:00+05:30`);
      }

      if (isNightShiftActive) {
        const inStr = nightCheckIn || defaultNightIn;
        const outStr = nightCheckOut || defaultNightOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    let attendance = await Attendance.findOne({ employeeId, date });
    if (attendance) {
      attendance.status = status;
      attendance.checkIn = checkInDate;
      attendance.checkOut = checkOutDate;
      attendance.nightCheckIn = nightCheckInDate;
      attendance.nightCheckOut = nightCheckOutDate;
      attendance.overtimeHours = status === 'Present' ? (Number(overtimeHours) || 0) : 0;
      attendance.isNightShift = status === 'Present' ? isNightShiftActive : false;
      attendance.nightShiftHours = (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0;
      await attendance.save();
    } else {
      attendance = new Attendance({
        employeeId,
        date,
        status,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        nightCheckIn: nightCheckInDate,
        nightCheckOut: nightCheckOutDate,
        overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
        isNightShift: status === 'Present' ? isNightShiftActive : false,
        nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
      });
      await attendance.save();
    }

    res.status(200).json({ success: true, message: 'Attendance updated successfully!', attendance });
  } catch (error) {
    console.error('Error in admin-mark attendance:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Blanket Mark Attendance Endpoint
// Bulk Mark Attendance Endpoint
app.post('/api/attendance/bulk-mark', async (req, res) => {
  const { employeeIds, date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ success: false, message: 'employeeIds array is required.' });
  }
  if (!date || !status) {
    return res.status(400).json({ success: false, message: 'Date and Status are required fields.' });
  }

  try {
    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        checkInDate = checkIn ? new Date(`${date}T${checkIn}:00+05:30`) : new Date(`${date}T09:00:00+05:30`);
        checkOutDate = checkOut ? new Date(`${date}T${checkOut}:00+05:30`) : new Date(`${date}T17:00:00+05:30`);
      }

      if (isNightShiftActive) {
        const defaultIn = '20:00';
        const defaultOut = '04:00';
        const inStr = nightCheckIn || defaultIn;
        const outStr = nightCheckOut || defaultOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    const operations = employeeIds.map(empId => {
      return {
        updateOne: {
          filter: { employeeId: empId, date },
          update: {
            $set: {
              status,
              checkIn: checkInDate,
              checkOut: checkOutDate,
              nightCheckIn: nightCheckInDate,
              nightCheckOut: nightCheckOutDate,
              overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
              isNightShift: status === 'Present' ? isNightShiftActive : false,
              nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
            }
          },
          upsert: true
        }
      };
    });

    await Attendance.bulkWrite(operations);

    res.status(200).json({ success: true, message: `Bulk attendance updated successfully for ${employeeIds.length} employees on ${date}!` });
  } catch (error) {
    console.error('Error in bulk-mark attendance:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/attendance/blanket-mark', async (req, res) => {
  const { date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  if (!date || !status) {
    return res.status(400).json({ success: false, message: 'Date and Status are required fields.' });
  }

  try {
    // Exclude discontinued employees from blanket attendance marking
    const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
    if (!employees || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees found to register attendance.' });
    }

    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        checkInDate = checkIn ? new Date(`${date}T${checkIn}:00+05:30`) : new Date(`${date}T09:00:00+05:30`);
        checkOutDate = checkOut ? new Date(`${date}T${checkOut}:00+05:30`) : new Date(`${date}T17:00:00+05:30`);
      }

      if (isNightShiftActive) {
        const defaultIn = '20:00';
        const defaultOut = '04:00';
        const inStr = nightCheckIn || defaultIn;
        const outStr = nightCheckOut || defaultOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    const operations = employees.map(emp => {
      return {
        updateOne: {
          filter: { employeeId: emp._id, date },
          update: {
            $set: {
              status,
              checkIn: checkInDate,
              checkOut: checkOutDate,
              nightCheckIn: nightCheckInDate,
              nightCheckOut: nightCheckOutDate,
              overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
              isNightShift: status === 'Present' ? isNightShiftActive : false,
              nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
            }
          },
          upsert: true
        }
      };
    });

    await Attendance.bulkWrite(operations);

    res.status(200).json({ success: true, message: `Blanket attendance updated for all active employees on ${date}!` });
  } catch (error) {
    console.error('Error in blanket-mark attendance:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


