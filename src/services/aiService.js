const Invoice = require('../models/Invoice');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const config = require('../config/config');

// Mask sensitive corporate or employee data
function maskSensitiveData(text) {
  if (!text) return '';
  let masked = text;
  
  // 1. Bank Account numbers (typically 9-18 digits, preceded by bank keywords)
  masked = masked.replace(/(?:A\/c|Account|A\/C|Acc)(?:[\s.]*(?:No|Number|#))?[\s.:]*\b(\d{9,18})\b/gi, (match, p1) => match.replace(p1, ' [REDACTED_ACCOUNT] '));
  
  // 2. Indian Financial System Code (IFSC) (e.g. SBIN0001234)
  masked = masked.replace(/\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/g, ' [REDACTED_IFSC] ');
  
  // 3. Indian Permanent Account Number (PAN) (e.g. ABCDE1234F)
  masked = masked.replace(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, ' [REDACTED_PAN] ');
  
  // 4. Phone numbers (10 digit mobile, preceded by keywords or with country code)
  masked = masked.replace(/(?:(?:Mob|Mobile|Tel|Phone|Contact|M\.|Ph)[.:\s]*|\+91[\-\s]?)\b([6-9]\d{9})\b/gi, (match, p1) => match.replace(p1, ' [REDACTED_PHONE] '));
  
  // 5. Aadhaar card numbers (12 digits, preceded by Aadhaar/UID or formatted with separators)
  masked = masked.replace(/(?:Aadhaar|Aadhar|UID)[.:\s]*\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b|\b(\d{4}[\s-]\d{4}[\s-]\d{4})\b/gi, (match, p1, p2) => {
    const val = p1 || p2;
    return match.replace(val, ' [REDACTED_AADHAAR] ');
  });

  return masked;
}

// Fetch secure context from Database based on user prompt
const fetchContextFromDb = async (prompt) => {
  if (!prompt || typeof prompt !== 'string') return '';
  let context = '';
  try {
    const promptLower = prompt.toLowerCase();
    
    // Check if employee name mentioned
    const employees = await Employee.find({ status: 'Active' });
    const matchedEmployee = employees.find(emp => promptLower.includes(emp.name.toLowerCase()));
    if (matchedEmployee) {
      context += `Employee profile details for Ramesh/matched worker: Name: ${matchedEmployee.name}, Designation: ${matchedEmployee.designation || 'N/A'}, Gross Salary: ₹${matchedEmployee.grossSalary}, Location: ${matchedEmployee.location || 'N/A'}, Shift: ${matchedEmployee.defaultShift || 'N/A'}.\n`;
      
      // Fetch recent 3 attendance records for this employee
      const recentAttendance = await Attendance.find({ employeeId: matchedEmployee._id }).sort({ date: -1 }).limit(3);
      if (recentAttendance.length > 0) {
        context += `Recent attendance records for ${matchedEmployee.name}:\n`;
        recentAttendance.forEach(a => {
          context += `  * Date: ${a.date}, Status: ${a.status}, Overtime: ${a.overtimeHours} hrs, Night Shift: ${a.isNightShift ? 'Yes' : 'No'} (${a.nightShiftHours} hrs)\n`;
        });
      }
    }
    
    // Check if invoice number mentioned
    const invoiceNoMatch = prompt.match(/\b(?:INV|invoice|bill)[\s#-]*([A-Za-z0-9\-_/]+)\b/i);
    if (invoiceNoMatch) {
      const parsedNo = invoiceNoMatch[1].trim();
      const invoice = await Invoice.findOne({ invoiceNo: new RegExp(`^${parsedNo}$`, 'i') });
      if (invoice) {
        context += `Invoice details found: Invoice No: ${invoice.invoiceNo}, Consignee: ${invoice.companyName}, Date: ${invoice.invoiceDate ? invoice.invoiceDate.toISOString().split('T')[0] : 'N/A'}, Grand Total: ₹${invoice.grandTotal.toLocaleString('en-IN')}, GSTIN: ${invoice.gstin || 'N/A'}, Items: ${invoice.items.map(it => `${it.description} (Qty ${it.quantity} @ ₹${it.rate})`).join(', ')}.\n`;
      }
    }
  } catch (error) {
    console.error('Error fetching database context for AI Chat:', error);
  }
  return context;
};

// Check if user prompt is querying database statistics or flows
const isDatabaseQuery = (messages) => {
  if (!messages || messages.length === 0) return false;
  const lastMessage = messages[messages.length - 1].content.toLowerCase();
  const keywords = [
    'invoice', 'bill', 'sale', 'earning', 'employee', 'staff', 'worker', 
    'attendance', 'payroll', 'salary', 'how many', 'total', 'summary', 
    'report', 'statistic', 'metrics', 'analytics', 'user', 'account', 
    'role', 'admin', 'how to', 'how do i', 'steps', 'guide', 'navigation', 'workflow'
  ];
  return keywords.some(keyword => lastMessage.includes(keyword));
};

// Fetch real-time aggregated database metadata securely
const getDatabaseSummaryMetadata = async () => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    // Invoices count and sales total
    const totalInvoices = await Invoice.countDocuments({});
    const salesAggregate = await Invoice.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);
    const totalSales = salesAggregate[0]?.total || 0;

    // Last 6 months sales breakdown
    const monthlySales = await Invoice.aggregate([
      {
        $group: {
          _id: { $substr: ['$invoiceDate', 0, 7] }, // YYYY-MM
          total: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 6 }
    ]);

    // Employee counts
    const totalEmployees = await Employee.countDocuments({});
    const activeEmployees = await Employee.countDocuments({ status: 'Active' });

    // Today's attendance counts
    const attendancePresent = await Attendance.countDocuments({ date: today, status: 'Present' });
    const attendanceAbsent = await Attendance.countDocuments({ date: today, status: 'Absent' });
    const attendanceLeave = await Attendance.countDocuments({ date: today, status: 'Leave' });

    // Build the anonymized summary context string
    let summary = `Current System Database Summary (Real-time aggregates as of ${today}):\n`;
    summary += `- Total Invoices: ${totalInvoices}\n`;
    summary += `- Total Sales Amount: ₹${totalSales.toLocaleString('en-IN')}\n`;
    summary += `- Monthly Sales Breakdown (Last 6 Months):\n`;
    monthlySales.forEach(m => {
      summary += `  * Month ${m._id}: ${m.count} Invoices, Total: ₹${m.total.toLocaleString('en-IN')}\n`;
    });
    summary += `- Total Employees: ${totalEmployees} (${activeEmployees} Active)\n`;
    summary += `- Today's Attendance stats (${today}): ${attendancePresent} Present, ${attendanceAbsent} Absent, ${attendanceLeave} Leave\n`;

    return summary;
  } catch (error) {
    console.error('Error fetching database summary metadata:', error);
    return 'Database summary metadata could not be fetched due to an internal error.';
  }
};

// Static Website Navigation Flow FAQ
const WEBSITE_FLOW_GUIDE = `
SYSTEM WORKFLOW & NAVIGATION GUIDE (Sakshi Enterprises):
1. Adding a New Employee:
   - Navigate to "Employee Management" in the sidebar.
   - Click the "+ Add Employee" button next to the "Registered Employees" title.
   - Complete the form (Name, Email, Designation, Joining Date, Gross Salary, and default shift).
   - Submit the form. The overlay modal closes automatically.
2. Editing Employee Profiles:
   - In "Employee Management", locate the employee in the "Registered Employees" table.
   - Click the blue "Edit" button (pencil icon) in their row.
   - Modify the pre-filled fields in the modal and click "Save".
3. Mark Daily Attendance:
   - Navigate to "Attendance Register" in the sidebar.
   - Click any date cell in the employee's row.
   - Select status (Present, Absent, Leave, Holiday).
   - If "Present", check "Day Shift" and/or "Night Shift" to log either or both shifts. Day overtime hours and Night shift hours are calculated automatically based on check-in/out times. Manual hours adjustments can also be made.
   - Click "Save" to save.
4. Blanket Mark Attendance (Multiple Employees):
   - In "Attendance Register", click "Blanket Mark" in the top-right corner.
   - Select the target Day of the Month and Status.
   - Provide standard shift times if status is Present.
   - Click "Apply All" to apply to all active employees.
5. Generating Salary Slips:
   - Navigate to "Salary Slips / Payrolls" in the sidebar.
   - Select the Employee from the dropdown.
   - Select the Month and Year.
   - The system automatically retrieves attendance, overtime, and night shift records from the database.
   - Manually input or adjust parameters (Shift Hours, Advance, ESIC, Lunch Deduction).
   - Review net in-hand salary calculations and click "Generate & Save".
6. Invoices Management & Printing:
   - Navigate to "Invoices" in the sidebar.
   - To create: Click "Create Invoice", fill Consignee details and items grid (description, HSN, quantity, rate). Tax calculations (CGST/SGST/IGST) and grand totals auto-compute.
   - To search or paginate: Use search box at the top, select items-per-page (10, 20, 50, 100) and page navigation controls.
   - To print: Click "View" (eye icon) on any invoice, then click the "Print" button in the top right. Close button is automatically hidden during printing.
`;

// Helper to parse and execute attendance commands locally (Fallback intent parser)
async function handleLocalAttendanceCommand(message) {
  const employees = await Employee.find({ status: { $nin: ['Inactive', 'Discontinued'] } });
  
  let date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dateMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (dateMatch) {
    date = dateMatch[0];
  } else if (message.toLowerCase().includes('yesterday')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    date = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  
  let status = 'Present';
  const msgLower = message.toLowerCase();
  if (msgLower.includes('absent')) status = 'Absent';
  else if (msgLower.includes('leave')) status = 'Leave';
  else if (msgLower.includes('holiday')) status = 'Holiday';
  
  let checkIn = '09:30';
  let checkOut = '17:30';
  
  const timeRangeRegex = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:to|and|-)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i;
  const match = message.match(timeRangeRegex);
  if (match) {
    let h1 = parseInt(match[1]);
    let m1 = match[2] ? parseInt(match[2]) : 0;
    let amp1 = match[3] ? match[3].toLowerCase() : null;
    
    let h2 = parseInt(match[4]);
    let m2 = match[5] ? parseInt(match[5]) : 0;
    let amp2 = match[6] ? match[6].toLowerCase() : null;
    
    if (amp2 === 'pm' && !amp1 && h1 < 12 && h1 < h2) {
      amp1 = 'am';
    }
    
    if (amp1 === 'pm' && h1 < 12) h1 += 12;
    if (amp1 === 'am' && h1 === 12) h1 = 0;
    
    if (amp2 === 'pm' && h2 < 12) h2 += 12;
    if (amp2 === 'am' && h2 === 12) h2 = 0;
    
    if (!amp1 && !amp2) {
      if (h1 >= 1 && h1 <= 6) h1 += 12;
      if (h2 >= 1 && h2 <= 11 && h2 < h1) h2 += 12;
    }
    
    checkIn = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
    checkOut = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
  }
  
  let targetEmployees = [];
  const isBlanket = msgLower.includes('all') || msgLower.includes('every') || msgLower.includes('blanket');
  
  if (isBlanket) {
    targetEmployees = employees;
  } else {
    targetEmployees = employees.filter(emp => msgLower.includes(emp.name.toLowerCase()));
  }
  
  if (targetEmployees.length === 0) {
    return `I parsed a command to mark attendance, but could not identify which employees to mark. Please specify "all employees" or mention employee names (e.g. Ramesh).`;
  }
  
  let checkInDate = null;
  let checkOutDate = null;
  
  if (status === 'Present') {
    checkInDate = new Date(`${date}T${checkIn}:00+05:30`);
    checkOutDate = new Date(`${date}T${checkOut}:00+05:30`);
  }
  
  const operations = targetEmployees.map(emp => {
    return {
      updateOne: {
        filter: { employeeId: emp._id, date },
        update: {
          $set: {
            status,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            nightCheckIn: null,
            nightCheckOut: null,
            overtimeHours: 0,
            isNightShift: false,
            nightShiftHours: 0
          }
        },
        upsert: true
      }
    };
  });
  
  await Attendance.bulkWrite(operations);
  
  const empNames = targetEmployees.map(e => e.name).join(', ');
  if (isBlanket) {
    return `I have successfully marked all active employees (${targetEmployees.length}) Present for date ${date} from ${checkIn} to ${checkOut} (IST).`;
  } else {
    return `I have successfully marked attendance for ${targetEmployees.length} employees (${empNames}) as ${status} for date ${date}${status === 'Present' ? ` from ${checkIn} to ${checkOut} (IST)` : ''}.`;
  }
}

// Helper to extract employee info from chat history
function extractEmployeeInfo(messages) {
  let name = null;
  let grossSalary = null;
  let dateOfJoining = null;
  let designation = null;
  let location = null;
  let email = null;
  let defaultShift = null;
  let forceSave = false;

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const content = msg.content;

    // 1. Check for force save / proceed in the LAST message
    if (msg === messages[messages.length - 1]) {
      if (/\b(?:save|save anyway|proceed|create|confirm|yes|force)\b/i.test(content)) {
        forceSave = true;
      }
    }

    // 2. Extract Name
    const nameMatch1 = content.match(/(?:add|create|register)\s+employee\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
    const nameMatch2 = content.match(/(?:name\s+is|named)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
    const nameMatch1Ins = content.match(/(?:add|create|register)\s+employee\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
    const nameMatch2Ins = content.match(/(?:name\s+is|named)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);

    let parsedName = null;
    if (nameMatch1) parsedName = nameMatch1[1];
    else if (nameMatch2) parsedName = nameMatch2[1];
    else if (nameMatch1Ins) parsedName = nameMatch1Ins[1];
    else if (nameMatch2Ins) parsedName = nameMatch2Ins[1];

    if (parsedName) {
      parsedName = parsedName.replace(/\b(?:salary|joined|joining|designation|location|email|with|whose|and|as)\b.*/i, '').trim();
      if (parsedName.length > 1) {
        name = parsedName;
      }
    }

    // 3. Extract Salary
    const salaryMatch = content.match(/(?:salary|gross|pay|earns|earning)\b\D*(\d+)/i);
    if (salaryMatch) {
      grossSalary = parseInt(salaryMatch[1]);
    }

    // 4. Extract Date of Joining
    const dateMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) {
      dateOfJoining = dateMatch[1];
    } else if (/\bjoined\s+today\b/i.test(content) || /\bjoining\s+today\b/i.test(content)) {
      dateOfJoining = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } else if (/\bjoined\s+yesterday\b/i.test(content)) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      dateOfJoining = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }

    // 5. Extract Designation
    const desigMatch = content.match(/\b(?:designation|role|title|position)\s*(?:is)?\s*([^,;.\n]+)/i);
    const desigMatch2 = content.match(/\bas\s+a\s+([^,;.\n]+)/i);
    if (desigMatch) {
      let val = desigMatch[1].trim();
      val = val.replace(/\b(?:salary|email|location|joined|joining|and|with|date)\b.*/i, '').trim();
      designation = val;
    } else if (desigMatch2) {
      let val = desigMatch2[1].trim();
      val = val.replace(/\b(?:salary|email|location|joined|joining|and|with|date)\b.*/i, '').trim();
      designation = val;
    }

    // 6. Extract Location
    const locMatch = content.match(/\b(?:location|city|based in|works at|office)\s*(?:is)?\s*([^,;.\n]+)/i);
    if (locMatch) {
      let val = locMatch[1].trim();
      val = val.replace(/\b(?:salary|email|designation|joined|joining|and|with|date)\b.*/i, '').trim();
      location = val;
    } else {
      const cityMatch = content.match(/\b(?:in|at)\s+(New\s+Delhi|Delhi|Noida|Mumbai|Bengaluru|Bangalore|Chennai|Kolkata|Gurugram|Gurgaon|Hyderabad|Pune)\b/i);
      if (cityMatch) {
        location = cityMatch[1].trim();
      }
    }

    // 7. Extract Email
    const emailMatch = content.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    if (emailMatch) {
      email = emailMatch[1];
    }

    // 8. Extract Shift
    const shiftMatch = content.match(/\b(day|night)\s*shift\b/i);
    if (shiftMatch) {
      defaultShift = shiftMatch[1].toLowerCase() === 'night' ? 'Night (20:00 - 04:00)' : 'Day (09:30 - 17:30)';
    }
  }

  return { name, grossSalary, dateOfJoining, designation, location, email, defaultShift, forceSave };
}

// Helper to handle multiple employee additions
async function handleLocalMultipleAddEmployee(message) {
  const parts = message.split(/(?:\band\b|,|\n|;)/i);
  const results = [];
  
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    part = part.replace(/^(?:add|create|register)\s*(?:employees?)?\s*/i, '');
    
    const extracted = extractEmployeeInfo([{ role: 'user', content: `add employee ${part}` }]);
    
    if (extracted.name && extracted.grossSalary) {
      const dateOfJoining = extracted.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      try {
        const employeeData = {
          name: extracted.name,
          grossSalary: Number(extracted.grossSalary),
          dateOfJoining: new Date(dateOfJoining),
          designation: extracted.designation || '',
          location: extracted.location || '',
          defaultShift: extracted.defaultShift || 'Day (09:30 - 17:30)'
        };
        if (extracted.email) {
          employeeData.email = extracted.email;
        }
        const employee = new Employee(employeeData);
        const saved = await employee.save();
        results.push(`Saved ${saved.name} (Salary: ₹${saved.grossSalary}, Location: ${saved.location || 'N/A'})`);
      } catch (err) {
        results.push(`Failed to save ${extracted.name}: ${err.message}`);
      }
    }
  }
  
  if (results.length > 0) {
    return `Bulk Add Result:\n` + results.map(r => `- ${r}`).join('\n');
  } else {
    return `I detected a request to add multiple employees, but could not parse their names and salaries. Please format like: 'Add Ramesh (salary 25000) and Suresh (salary 30000)'.`;
  }
}

// Fallback logic to add employee locally
async function handleLocalAddEmployeeCommand(messages) {
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  const msgLower = lastUserMessage.toLowerCase();

  const isMultipleAdd = (msgLower.includes('employees') || msgLower.includes('and')) && 
                        (msgLower.includes('add') || msgLower.includes('register'));
  
  if (isMultipleAdd && !msgLower.includes('save') && !msgLower.includes('proceed')) {
    const parts = lastUserMessage.split(/\band\b/i);
    if (parts.length > 1 && parts.some(p => p.toLowerCase().includes('salary') || p.toLowerCase().includes('gross'))) {
      return await handleLocalMultipleAddEmployee(lastUserMessage);
    }
  }

  const extracted = extractEmployeeInfo(messages);

  if (!extracted.name) {
    return `I detected you want to add a new employee, but I couldn't find the employee's name. Please say something like: "Add employee Ramesh".`;
  }

  const missing = [];
  if (!extracted.grossSalary) missing.push('Gross Salary (e.g. "salary is 25000")');
  if (!extracted.dateOfJoining) missing.push('Date of Joining (e.g. "joining date 2026-06-01")');
  if (!extracted.designation) missing.push('Designation (e.g. "designation is Developer")');
  if (!extracted.location) missing.push('Location (e.g. "location is Delhi")');

  if (missing.length > 0 && !extracted.forceSave) {
    const missingList = missing.map(m => `- ${m}`).join('\n');
    return `I detected that you want to add **${extracted.name}**.\n\nI still need the following details to complete the registration:\n${missingList}\n\nPlease provide them (e.g. "salary is 25000, location is Noida"), or reply **"save"** to proceed with only the current details.`;
  }

  try {
    const dateOfJoining = extracted.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const grossSalary = extracted.grossSalary || 0;

    const employeeData = {
      name: extracted.name,
      grossSalary: Number(grossSalary),
      dateOfJoining: new Date(dateOfJoining),
      designation: extracted.designation || '',
      location: extracted.location || '',
      defaultShift: extracted.defaultShift || 'Day (09:30 - 17:30)'
    };

    if (extracted.email) {
      employeeData.email = extracted.email;
    }

    const employee = new Employee(employeeData);
    const savedEmployee = await employee.save();

    return `Successfully added new employee **${savedEmployee.name}**! 🎉\n` +
           `- Designation: ${savedEmployee.designation || 'N/A'}\n` +
           `- Location: ${savedEmployee.location || 'N/A'}\n` +
           `- Gross Salary: ₹${savedEmployee.grossSalary}\n` +
           `- Date of Joining: ${dateOfJoining}\n` +
           `- Default Shift: ${savedEmployee.defaultShift}`;
  } catch (err) {
    console.error('Error saving employee locally:', err);
    return `Failed to save employee: ${err.message}`;
  }
}

module.exports = {
  maskSensitiveData,
  fetchContextFromDb,
  isDatabaseQuery,
  getDatabaseSummaryMetadata,
  WEBSITE_FLOW_GUIDE,
  handleLocalAttendanceCommand,
  handleLocalAddEmployeeCommand
};
