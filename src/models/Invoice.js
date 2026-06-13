const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  companyName: String,
  gstin: String,
  state: String,
  stateCode: String,
  invoiceNo: { type: String, required: true, unique: true },
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
}, { timestamps: true });

const Invoice = mongoose.model('Invoice', invoiceSchema);

module.exports = Invoice;
