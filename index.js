require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const app = express();
const port = process.env.PORT || 3000;

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
  status: { type: String, enum: ['Present', 'Absent', 'Leave'], default: 'Present' }
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
    const salarySlips = await SalarySlip.find().populate('employeeId', 'name');
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

    const salarySlips = await SalarySlip.find({ employeeId: employee._id }).populate('employeeId', 'name');
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

