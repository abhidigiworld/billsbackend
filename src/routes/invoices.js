const express = require('express');
const multer = require('multer');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { protect, restrictTo } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// All invoice routes are protected
router.use(protect);

router.post('/api/invoices', invoiceController.createInvoice);
router.post('/api/invoices/bulk-upload', upload.array('files'), invoiceController.bulkUpload);
router.get('/api/invoices', invoiceController.getAllInvoices);
router.get('/api/invoices/:id', invoiceController.getInvoiceById);
router.put('/api/invoices/:id', invoiceController.updateInvoice);

// Admin-only deletion
router.delete('/api/invoices/:id', restrictTo('admin'), invoiceController.deleteInvoice);

module.exports = router;
