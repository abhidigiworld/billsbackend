const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'SakshiE2024' && password === 'sakshi0807') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// MongoDB connection


mongoose.connect("mongodb+srv://sakshi:sakshi2003@sakshieneterprises.49cthwx.mongodb.net/?retryWrites=true&w=majority&appName=SakshiEneterprises")
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err))


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

    // Create new user
    const newUser = new User({ name, email, password });
    await newUser.save();

    res.status(201).json({ success: true, message: 'User registered successfully' });
  } catch (error) {
    console.error('Error during sign up:', error);
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
  dateOfJoining: { type: Date, required: true },
  grossSalary: { type: Number, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
});

const Employee = mongoose.model('Employee', employeeSchema);

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

// Route to get all active employees
app.get('/api/employees/active', async (req, res) => {
  try {
    // Fetch employees with 'Active' status
    const activeEmployees = await Employee.find({ status: 'Active' });
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
    const totalSalary = salarySlipData.salaryByWorkDays + salarySlipData.overtimeSalary;
    const inHandSalary = totalSalary - (salarySlipData.esic || 0) - (salarySlipData.advance || 0);

    const salarySlip = new SalarySlip({
      ...salarySlipData,
      totalSalary,
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
