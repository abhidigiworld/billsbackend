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
  
  // Try splitting by hyphen or slash
  const parts = cleanStr.split(/[-\/]/);
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

      // Initial check to see if we should call AI fallback
      const noMatch = cleanText.match(/(?:Invoice\s*No|Bill\s*No)[.:\s]+([A-Za-z0-9-/]+)/i);
      const grandTotalMatch = cleanText.match(/(?:Grand\s*Total|Total\s*Amount|Total\s*Payable|Total)[.:\s]+(?:₹|Rs)?\s*([\d,]+(?:\.\d+)?)/i);
      
      const regexInvoiceNo = noMatch ? noMatch[1].trim() : '';
      let regexGrandTotal = 0;
      if (grandTotalMatch) {
        regexGrandTotal = parseFloat(grandTotalMatch[1].replace(/,/g, '')) || 0;
      }

      const hasGroqKey = !!process.env.GROQ_API_KEY;
      let parsedByAI = false;

      if (hasGroqKey && (!regexInvoiceNo || regexGrandTotal === 0)) {
        try {
          console.log(`[AI Fallback] Parsing ${file.originalname} using Groq AI...`);
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

            invoiceNo = extracted.invoiceNo || regexInvoiceNo || 'TEMP-' + Math.floor(100 + Math.random() * 900);
            invoiceDate = formatDateToISO(extracted.invoiceDate) || new Date().toISOString().split('T')[0];
            companyName = extracted.companyName || 'Unknown Recipient';
            gstin = (extracted.gstin || '').toUpperCase();
            state = extracted.state || '';
            stateCode = extracted.stateCode || '';
            freightCharges = parseFloat(extracted.freightCharges) || 0;
            cgst = parseFloat(extracted.cgst) || 0;
            sgst = parseFloat(extracted.sgst) || 0;
            igst = parseFloat(extracted.igst) || 0;
            grandTotal = parseFloat(extracted.grandTotal) || 0;
            grandTotalInWords = extracted.grandTotalInWords || convertNumberToWordsBackend(grandTotal);

            if (Array.isArray(extracted.items)) {
              extracted.items.forEach(item => {
                items.push({
                  description: item.description || 'Service',
                  hsnAsc: item.hsnAsc || '-',
                  quantity: parseInt(item.quantity) || 1,
                  rate: parseFloat(item.rate) || 0,
                  totalValue: parseFloat(item.totalValue) || 0
                });
              });
            }
            parsedByAI = true;
            console.log(`[AI Fallback] Successfully parsed ${file.originalname} via Groq.`);
          } else {
            console.warn('[AI Fallback] Groq API returned non-OK status. Falling back to regex.');
          }
        } catch (aiErr) {
          console.error('[AI Fallback] Failed to parse using Groq AI:', aiErr);
        }
      }

      if (!parsedByAI) {
        // 2. Parse details via Regex
        if (noMatch) invoiceNo = noMatch[1].trim();
        else {
          invoiceNo = 'TEMP-' + Math.floor(100 + Math.random() * 900);
        }

        // Invoice Date
        const dateMatch = cleanText.match(/(?:Invoice\s*Date|Date)[.:\s]+([\d-]{10})/i) || 
                          cleanText.match(/(?:Invoice\s*Date|Date)[.:\s]+([\d-/]{8,10})/i);
        if (dateMatch) {
          const rawDate = dateMatch[1].trim();
          invoiceDate = formatDateToISO(rawDate) || new Date().toISOString().split('T')[0];
        } else {
          invoiceDate = new Date().toISOString().split('T')[0];
        }

        // Recipient Company Name
        const msMatch = cleanText.match(/M\/s[.:\s]+([^\n]+)/i) || 
                        cleanText.match(/M\/S[.:\s]+([^\n]+)/i) ||
                        cleanText.match(/(?:Recipient|Bill\s*To|To)[.:\s]+([^\n]+)/i);
        if (msMatch) {
          companyName = msMatch[1].trim();
        } else {
          companyName = 'Unknown Recipient';
        }

        // GSTIN
        const gstinMatch = cleanText.match(/GSTIN\s*(?:No)?[.:\s]+([A-Z0-9]{15})/i) ||
                           cleanText.match(/GSTIN\s*(?:No)?[.:\s]+(\S+)/i);
        if (gstinMatch) gstin = gstinMatch[1].trim().toUpperCase();

        // State & State Code
        const stateMatch = cleanText.match(/State[.:\s]+([a-zA-Z\s]+?)(?=\s*State\s*Code|\n|$)/i);
        if (stateMatch) state = stateMatch[1].trim();

        const codeMatch = cleanText.match(/(?:State\s*Code|Code)[.:\s]+(\d+)/i);
        if (codeMatch) stateCode = codeMatch[1].trim();

        // Freight
        const freightMatch = cleanText.match(/(?:Freight\s*Charges|Freight)[.:\s]+(?:₹|Rs)?\s*(\d+(?:\.\d+)?)/i);
        if (freightMatch) freightCharges = parseFloat(freightMatch[1]);

        // CGST
        const cgstMatch = cleanText.match(/(?:CGST|Central\s*GST)\s*(?:\(?\d*%\)?)?[.:\s]+(?:₹|Rs)?\s*(\d+(?:\.\d+)?)/i);
        if (cgstMatch) cgst = parseFloat(cgstMatch[1]);

        // SGST
        const sgstMatch = cleanText.match(/(?:SGST|State\s*GST)\s*(?:\(?\d*%\)?)?[.:\s]+(?:₹|Rs)?\s*(\d+(?:\.\d+)?)/i);
        if (sgstMatch) sgst = parseFloat(sgstMatch[1]);

        // IGST
        const igstMatch = cleanText.match(/(?:IGST|Integrated\s*GST)\s*(?:\(?\d*%\)?)?[.:\s]+(?:₹|Rs)?\s*(\d+(?:\.\d+)?)/i);
        if (igstMatch) igst = parseFloat(igstMatch[1]);

        // Grand Total
        if (grandTotalMatch) {
          grandTotal = parseFloat(grandTotalMatch[1].replace(/,/g, '')) || 0;
        }

        // Grand Total in Words
        const wordsMatch = cleanText.match(/(?:Grand\s*Total|Total\s*Amount)\s*\(?In\s*Words\)?[:.\s]+([^\n]+)/i);
        if (wordsMatch) {
          grandTotalInWords = wordsMatch[1].trim();
        } else {
          grandTotalInWords = convertNumberToWordsBackend(grandTotal);
        }

        // Parse items list
        let itemsText = '';
        const tableStartIdx = cleanText.search(/Sl\.?\s*No\.?/i);
        const tableEndIdx = cleanText.search(/(?:Subtotal|Freight\s*Charges|Freight|Total\s*Amount)/i);
        
        if (tableStartIdx !== -1 && tableEndIdx !== -1 && tableEndIdx > tableStartIdx) {
          itemsText = cleanText.substring(tableStartIdx, tableEndIdx);
        } else {
          itemsText = cleanText;
        }

        const lines = itemsText.split('\n').map(l => l.trim()).filter(Boolean);
        
        lines.forEach(line => {
          const match = line.match(/^(?:\d+[\s.]*)?(.+?)\s+(\w+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
          if (match) {
            const description = match[1].trim();
            const hsnAsc = match[2].trim();
            const quantity = parseInt(match[3]) || 0;
            const rate = parseFloat(match[4]) || 0;
            const totalValue = parseFloat(match[5]) || 0;
            
            if (description.toLowerCase() !== 'description' && hsnAsc.toLowerCase() !== 'hsn/asc') {
              items.push({ description, hsnAsc, quantity, rate, totalValue });
            }
          } else {
            const matchNoHsn = line.match(/^(?:\d+[\s.]*)?(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
            if (matchNoHsn) {
              const description = matchNoHsn[1].trim();
              const quantity = parseInt(matchNoHsn[2]) || 0;
              const rate = parseFloat(matchNoHsn[3]) || 0;
              const totalValue = parseFloat(matchNoHsn[4]) || 0;
              if (description.toLowerCase() !== 'description' && description.toLowerCase() !== 'sl.no.') {
                items.push({ description, hsnAsc: '-', quantity, rate, totalValue });
              }
            }
          }
        });

        // Default item if none was parsed
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
  
  // 1. Bank Account numbers (typically 9-18 digits)
  masked = masked.replace(/\b\d{9,18}\b/g, ' [REDACTED_ACCOUNT] ');
  
  // 2. Indian Financial System Code (IFSC) (e.g. SBIN0001234)
  masked = masked.replace(/\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/g, ' [REDACTED_IFSC] ');
  
  // 3. Indian Permanent Account Number (PAN) (e.g. ABCDE1234F)
  masked = masked.replace(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, ' [REDACTED_PAN] ');
  
  // 4. Phone numbers (10 digit mobile, optionally with country code)
  masked = masked.replace(/(?:\+91[\-\s]?)?[6-9]\d{9}\b/g, ' [REDACTED_PHONE] ');
  
  // 5. Aadhaar card numbers (12 digits, often formatted as 4-4-4)
  masked = masked.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, ' [REDACTED_AADHAAR] ');

  return masked;
}

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

// Check if user prompt is querying database statistics
const isDatabaseQuery = (messages) => {
  if (!messages || messages.length === 0) return false;
  const lastMessage = messages[messages.length - 1].content.toLowerCase();
  const keywords = [
    'invoice', 'bill', 'sale', 'earning', 'employee', 'staff', 'worker', 
    'attendance', 'payroll', 'salary', 'how many', 'total', 'summary', 
    'report', 'statistic', 'metrics', 'analytics'
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

// AI Chat Copilot endpoint
app.post('/api/ai/chat', aiRateLimiter, async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages are required and must be an array.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('GROQ_API_KEY is not defined. Returning a stubbed helpful response.');
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
  let systemPromptText = 'You are ABHI digi AI, a secure corporate billing and payroll assistant for Sakshi Enterprises. You help users draft emails (e.g. invoice sending, payment reminders, salary slip notices), explain billing and Indian taxation concepts (CGST, SGST, IGST, HSN codes), and guide them on how to navigate this invoice and payroll system. For security, never ask for or process passwords, bank credentials, or private personal identifiers. Be concise, polite, and professional. IMPORTANT: You are a read-only assistant. You have no write, modify, or delete privileges over the database, invoices, employee payrolls, or attendance records. If a user asks you to edit, create, or delete records, explain that you are a read-only assistant and direct them to use the dashboard controls manually.';

  // Inject real-time MongoDB context if user asks about data analytics/records
  if (isDatabaseQuery(capMessages)) {
    console.log('[AI Chat] Analytics query detected. Fetching secure MongoDB aggregate metadata...');
    const dbSummary = await getDatabaseSummaryMetadata();
    systemPromptText += `\n\nReal-time database context for answering user questions:\n${dbSummary}`;
  }

  const systemPrompt = {
    role: 'system',
    content: systemPromptText
  };

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
  email: { type: String, required: true, unique: true },
  dateOfJoining: { type: Date, required: true },
  grossSalary: { type: Number, required: true },
  designation: { type: String, default: '' },
  location: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'On Hold', 'On Holiday', 'Inactive'], default: 'Active' }
});

const Employee = mongoose.model('Employee', employeeSchema);

// Mongoose schema for Attendance
const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  checkIn: { type: Date },
  checkOut: { type: Date },
  status: { type: String, enum: ['Present', 'Absent', 'Leave', 'Holiday'], default: 'Absent' }
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
    const employee = new Employee(req.body);
    const savedEmployee = await employee.save();
    res.status(201).json(savedEmployee);
  } catch (error) {
    console.error('Error saving employee:', error);
    res.status(500).json({ error: 'An error occurred while saving the employee' });
  }
});

// Route to update an employee by ID
app.put('/api/employees/:id', async (req, res) => {
  try {
    const updatedEmployee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedEmployee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(updatedEmployee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'An error occurred while updating the employee' });
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
    // Fetch employees who are not 'Inactive'
    const activeEmployees = await Employee.find({ status: { $ne: 'Inactive' } });
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
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary);
    const esic = Math.floor(salarySlipData.esic || 0);
    const advance = Math.floor(salarySlipData.advance || 0);
    const lunchDeduction = Math.floor(salarySlipData.lunchDeduction || 0);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);

    const salarySlip = new SalarySlip({
      ...salarySlipData,
      salaryByWorkDays,
      overtimeSalary,
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
    
    // Perform intermediate flooring
    const dailyRate = Math.floor(employee.grossSalary / calendarDays);
    const salaryByWorkDays = Math.floor(workDays * dailyRate);
    const hourlyOtRate = Math.floor(dailyRate / shiftHours);
    const overtimeSalary = Math.floor(otHours * hourlyOtRate);
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary);
    const lunchDeduction = Math.floor(lunchDays * lunchRate);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);
    
    const updatedSalarySlip = await SalarySlip.findByIdAndUpdate(
      req.params.id,
      {
        workDays,
        salaryByWorkDays,
        overtimeHours: otHours,
        overtimeSalary,
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
  const { employeeId, date, status, checkIn, checkOut } = req.body;

  try {
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    let checkInDate = null;
    let checkOutDate = null;

    if (status === 'Present') {
      if (checkIn) {
        checkInDate = new Date(`${date}T${checkIn}:00`);
      } else {
        // Default checkIn to 09:00 if status is Present but not specified
        checkInDate = new Date(`${date}T09:00:00`);
      }
      if (checkOut) {
        checkOutDate = new Date(`${date}T${checkOut}:00`);
      } else {
        // Default checkOut to 17:00 if status is Present but not specified
        checkOutDate = new Date(`${date}T17:00:00`);
      }
    }

    let attendance = await Attendance.findOne({ employeeId, date });
    if (attendance) {
      attendance.status = status;
      attendance.checkIn = checkInDate;
      attendance.checkOut = checkOutDate;
      await attendance.save();
    } else {
      attendance = new Attendance({
        employeeId,
        date,
        status,
        checkIn: checkInDate,
        checkOut: checkOutDate
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
app.post('/api/attendance/blanket-mark', async (req, res) => {
  const { date, status, checkIn, checkOut } = req.body;

  if (!date || !status) {
    return res.status(400).json({ success: false, message: 'Date and Status are required fields.' });
  }

  try {
    const employees = await Employee.find();
    if (!employees || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees found to register attendance.' });
    }

    let checkInDate = null;
    let checkOutDate = null;

    if (status === 'Present') {
      if (checkIn) {
        checkInDate = new Date(`${date}T${checkIn}:00`);
      } else {
        checkInDate = new Date(`${date}T09:00:00`);
      }
      if (checkOut) {
        checkOutDate = new Date(`${date}T${checkOut}:00`);
      } else {
        checkOutDate = new Date(`${date}T17:00:00`);
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
              checkOut: checkOutDate
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


