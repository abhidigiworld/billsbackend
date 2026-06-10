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

module.exports = {
  cleanNumber,
  splitMergedItem
};
