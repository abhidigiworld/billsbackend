const formatDateToISO = (dateStr) => {
  if (!dateStr) return null;
  const cleanStr = dateStr.trim();
  
  // Try splitting by hyphen, slash, or dot
  const parts = cleanStr.split(/[-\/\.]/);
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

module.exports = {
  formatDateToISO
};
