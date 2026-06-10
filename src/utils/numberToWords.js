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

module.exports = {
  convertNumberToWordsBackend
};
