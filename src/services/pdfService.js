const pdfParse = require('pdf-parse');
const { formatDateToISO } = require('../utils/dateHelper');
const { cleanNumber, splitMergedItem } = require('../utils/numberHelper');
const { convertNumberToWordsBackend } = require('../utils/numberToWords');

// Extract text from PDF buffer
const extractTextFromPDF = async (buffer) => {
  const data = await pdfParse(buffer);
  return data.text.replace(/\r/g, '').trim();
};

// Regex based fallback parsing of invoice texts
const parseInvoiceTextRegexFallback = (cleanText, originalFilename) => {
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

  return {
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
  };
};

module.exports = {
  extractTextFromPDF,
  parseInvoiceTextRegexFallback
};
