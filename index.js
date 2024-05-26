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
  if (username === 'Sakshi' && password === '1234') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});


// MongoDB connection

mongoose.connect('mongodb+srv://sakshi:sakshi2003@sakshieneterprises.3ztfuhh.mongodb.net/?retryWrites=true&w=majority&appName=SakshiEneterprises')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err))

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
  }]
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

// Route to handle POST requests to /api/invoices
app.post('/api/invoices', async (req, res) => {
  try {
    const invoice = new Invoice(req.body);
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
