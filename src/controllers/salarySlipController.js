const SalarySlip = require('../models/SalarySlip');
const Employee = require('../models/Employee');

// Get All Salary Slips (Admin)
exports.getAllSalarySlips = async (req, res, next) => {
  try {
    const salarySlips = await SalarySlip.find().populate('employeeId', 'name designation grossSalary dateOfJoining');
    res.json(salarySlips);
  } catch (error) {
    next(error);
  }
};

// Create Salary Slip
exports.createSalarySlip = async (req, res, next) => {
  try {
    const salarySlipData = req.body;
    
    // Check if duplicate slip exists for this employee and month
    const existingSlip = await SalarySlip.findOne({
      employeeId: salarySlipData.employeeId,
      monthOfSalary: salarySlipData.monthOfSalary
    });
    if (existingSlip) {
      return res.status(400).json({ error: `Salary slip already generated for this employee for ${salarySlipData.monthOfSalary}.` });
    }

    const salaryByWorkDays = Math.floor(salarySlipData.salaryByWorkDays || 0);
    const overtimeSalary = Math.floor(salarySlipData.overtimeSalary || 0);
    const nightShiftHours = parseFloat(salarySlipData.nightShiftHours || 0);
    const nightShiftDays = parseInt(salarySlipData.nightShiftDays || 0);
    const nightShiftRate = Math.floor(parseFloat(salarySlipData.nightShiftRate || 0));
    
    let nightShiftAllowance = 0;
    if (nightShiftHours > 0) {
      nightShiftAllowance = Math.floor(nightShiftHours * nightShiftRate);
    } else {
      nightShiftAllowance = Math.floor(nightShiftDays * nightShiftRate);
    }
    
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary + nightShiftAllowance + Math.floor(parseFloat(salarySlipData.hra || 0)));
    const esic = Math.floor(salarySlipData.esic || 0);
    const advance = Math.floor(salarySlipData.advance || 0);
    const lunchDeduction = Math.floor(salarySlipData.lunchDeduction || 0);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);

    const salarySlip = new SalarySlip({
      ...salarySlipData,
      hra: Math.floor(parseFloat(salarySlipData.hra || 0)),
      salaryByWorkDays,
      overtimeSalary,
      nightShiftHours,
      nightShiftDays,
      nightShiftRate,
      nightShiftAllowance,
      totalSalary,
      esic,
      advance,
      lunchDeduction,
      inHandSalary
    });

    const savedSalarySlip = await salarySlip.save();
    res.status(201).json(savedSalarySlip);
  } catch (error) {
    next(error);
  }
};

// Delete Salary Slip
exports.deleteSalarySlip = async (req, res, next) => {
  try {
    const deletedSalarySlip = await SalarySlip.findByIdAndDelete(req.params.id);
    if (!deletedSalarySlip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }
    res.json({ message: 'Salary slip deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Get My Salary Slips (Self or Admin query)
exports.getMySalarySlips = async (req, res, next) => {
  try {
    const email = req.query.email || (req.user && req.user.email);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email identifier is missing.' });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(200).json([]);
    }

    const salarySlips = await SalarySlip.find({ employeeId: employee._id })
      .populate('employeeId', 'name designation grossSalary dateOfJoining');
      
    res.status(200).json(salarySlips);
  } catch (error) {
    next(error);
  }
};

// Update Salary Slip By ID
exports.updateSalarySlip = async (req, res, next) => {
  try {
    const salarySlipData = req.body;
    
    // Recalculate using strict intermediate flooring
    const workDays = parseInt(salarySlipData.workDays || 0);
    const otHours = parseFloat(salarySlipData.otHours || 0);
    const advance = Math.floor(parseFloat(salarySlipData.advance || 0));
    const esic = Math.floor(parseFloat(salarySlipData.esic || 0));
    const lunchDays = parseInt(salarySlipData.lunchDays || 0);
    const lunchRate = Math.floor(parseFloat(salarySlipData.lunchRate || 0));
    const shiftHours = parseInt(salarySlipData.shiftHours || 8);
    
    // Query gross salary of employee
    const employee = await Employee.findById(salarySlipData.employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }
    
    const monthOfSalary = salarySlipData.monthOfSalary || '';
    const [monthName, yearStr] = monthOfSalary.split(' ');
    const monthMap = {
      'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
      'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    };
    const monthNum = monthMap[monthName] || 1;
    const yearNum = parseInt(yearStr) || new Date().getFullYear();
    const calendarDays = new Date(yearNum, monthNum, 0).getDate();
    
    const nightShiftHours = parseFloat(salarySlipData.nightShiftHours || 0);
    const nightShiftDays = parseInt(salarySlipData.nightShiftDays || 0);
    const nightShiftRate = Math.floor(parseFloat(salarySlipData.nightShiftRate || 0));
    
    let nightShiftAllowance = 0;
    if (nightShiftHours > 0) {
      nightShiftAllowance = Math.floor(nightShiftHours * nightShiftRate);
    } else {
      nightShiftAllowance = Math.floor(nightShiftDays * nightShiftRate);
    }
    
    const dailyRate = Math.floor(employee.grossSalary / calendarDays);
    const salaryByWorkDays = Math.floor(workDays * dailyRate);
    const hourlyOtRate = Math.floor(dailyRate / shiftHours);
    const overtimeSalary = Math.floor(otHours * hourlyOtRate);
    const hra = Math.floor(parseFloat(salarySlipData.hra || 0));
    const totalSalary = Math.floor(salaryByWorkDays + overtimeSalary + nightShiftAllowance + hra);
    const lunchDeduction = Math.floor(lunchDays * lunchRate);
    const inHandSalary = Math.floor(totalSalary - esic - advance - lunchDeduction);
    
    const updatedSalarySlip = await SalarySlip.findByIdAndUpdate(
      req.params.id,
      {
        workDays,
        salaryByWorkDays,
        overtimeHours: otHours,
        overtimeSalary,
        nightShiftHours,
        nightShiftDays,
        nightShiftRate,
        nightShiftAllowance,
        totalSalary,
        advance,
        esic,
        lunchDays,
        lunchRate,
        lunchDeduction,
        shiftHours,
        hra,
        inHandSalary,
        monthOfSalary
      },
      { new: true }
    );
    
    if (!updatedSalarySlip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }
    res.json(updatedSalarySlip);
  } catch (error) {
    next(error);
  }
};
