const Invoice = require('../models/Invoice');
const pdfService = require('../services/pdfService');
const aiService = require('../services/aiService');
const { cleanNumber } = require('../utils/numberHelper');
const { formatDateToISO } = require('../utils/dateHelper');
const { convertNumberToWordsBackend } = require('../utils/numberToWords');
const config = require('../config/config');

// Create Invoice
exports.createInvoice = async (req, res, next) => {
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
    next(error);
  }
};

// Bulk Upload & Parse PDFs (Groq AI with Regex Fallback)
exports.bulkUpload = async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const results = [];
    const errors = [];
    const seenInvoiceNos = new Set();

    for (const file of files) {
      try {
        // 1. Extract text from PDF
        const cleanText = await pdfService.extractTextFromPDF(file.buffer);

        // 2. Variables to capture invoice fields
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

        let parsedByAI = false;

        // Try AI parsing if Groq Key is present
        if (config.GROQ_API_KEY) {
          try {
            console.log(`[AI Parsing] Parsing ${file.originalname} using Groq AI...`);
            const maskedText = aiService.maskSensitiveData(cleanText);
            
            const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.GROQ_API_KEY}`,
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

        // Fallback to Regex Parsing if AI parsing failed or wasn't configured
        if (!parsedByAI) {
          console.log(`[Regex Parsing] Parsing ${file.originalname} using regex fallback...`);
          const extracted = pdfService.parseInvoiceTextRegexFallback(cleanText, file.originalname);
          
          invoiceNo = extracted.invoiceNo;
          invoiceDate = extracted.invoiceDate;
          companyName = extracted.companyName;
          gstin = extracted.gstin;
          state = extracted.state;
          stateCode = extracted.stateCode;
          freightCharges = extracted.freightCharges;
          cgst = extracted.cgst;
          sgst = extracted.sgst;
          igst = extracted.igst;
          grandTotal = extracted.grandTotal;
          grandTotalInWords = extracted.grandTotalInWords;
          
          extracted.items.forEach(item => items.push(item));
        }

        // Check duplicate invoice numbers in current upload batch
        if (seenInvoiceNos.has(invoiceNo)) {
          errors.push({
            file: file.originalname,
            error: `Duplicate invoice number: ${invoiceNo} is present multiple times in this upload batch.`
          });
          continue;
        }
        seenInvoiceNos.add(invoiceNo);

        // Check duplicate invoice numbers in DB
        const isDuplicate = await Invoice.findOne({ invoiceNo });
        if (isDuplicate) {
          errors.push({
            file: file.originalname,
            error: `Duplicate invoice number: ${invoiceNo} already exists in database.`
          });
          continue;
        }

        // Save invoice
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
  } catch (error) {
    next(error);
  }
};

// Get All Invoices
exports.getAllInvoices = async (req, res, next) => {
  try {
    const invoices = await Invoice.find();
    res.json(invoices);
  } catch (error) {
    next(error);
  }
};

// Get Specific Invoice By ID
exports.getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

// Update Invoice By ID
exports.updateInvoice = async (req, res, next) => {
  try {
    const updatedInvoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(updatedInvoice);
  } catch (error) {
    next(error);
  }
};

// Delete Invoice By ID
exports.deleteInvoice = async (req, res, next) => {
  try {
    const deletedInvoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!deletedInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    next(error);
  }
};
