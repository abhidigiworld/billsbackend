const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');

// Check-In
exports.checkIn = async (req, res, next) => {
  try {
    const email = req.body.email || (req.user && req.user.email);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email identifier is missing.' });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found for this email' });
    }

    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const existingAttendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });
    if (existingAttendance) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    const newAttendance = new Attendance({
      employeeId: employee._id,
      date: todayStr,
      checkIn: new Date(),
      status: 'Present'
    });
    await newAttendance.save();

    res.status(201).json({ success: true, message: 'Checked in successfully!', attendance: newAttendance });
  } catch (error) {
    next(error);
  }
};

// Check-Out
exports.checkOut = async (req, res, next) => {
  try {
    const email = req.body.email || (req.user && req.user.email);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email identifier is missing.' });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found for this email' });
    }

    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });
    if (!attendance) {
      return res.status(400).json({ success: false, message: 'Please check in first' });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ success: false, message: 'Already checked out today' });
    }

    attendance.checkOut = new Date();
    await attendance.save();

    res.status(200).json({ success: true, message: 'Checked out successfully!', attendance });
  } catch (error) {
    next(error);
  }
};

// Get My Attendance Records (Self or Admin Query)
exports.getMyAttendance = async (req, res, next) => {
  try {
    const email = req.query.email || (req.user && req.user.email);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email identifier is missing.' });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(200).json([]); // Return empty list if no employee record exists yet
    }

    const records = await Attendance.find({ employeeId: employee._id }).sort({ date: -1 });
    res.status(200).json(records);
  } catch (error) {
    next(error);
  }
};

// Get All Attendance Records (Admin)
exports.getAllAttendance = async (req, res, next) => {
  try {
    const records = await Attendance.find().populate('employeeId');
    res.status(200).json(records);
  } catch (error) {
    next(error);
  }
};

// Admin Mark Attendance (Single Employee)
exports.adminMarkAttendance = async (req, res, next) => {
  const { employeeId, date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  try {
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const defaultShift = employee.defaultShift || 'Day (09:30 - 17:30)';
      const isNight = defaultShift.includes('Night');
      
      let defaultDayIn = '09:30';
      let defaultDayOut = '17:30';
      if (defaultShift.includes('09:00')) {
        defaultDayIn = '09:00';
        defaultDayOut = '17:00';
      }
      
      let defaultNightIn = '20:00';
      let defaultNightOut = '04:00';
      
      const timeMatch = defaultShift.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (timeMatch) {
        if (isNight) {
          defaultNightIn = timeMatch[1];
          defaultNightOut = timeMatch[2];
        } else {
          defaultDayIn = timeMatch[1];
          defaultDayOut = timeMatch[2];
        }
      }

      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        const inStr = checkIn || defaultDayIn;
        const outStr = checkOut || defaultDayOut;
        checkInDate = new Date(`${date}T${inStr}:00+05:30`);
        checkOutDate = new Date(`${date}T${outStr}:00+05:30`);
      }

      if (isNightShiftActive) {
        const inStr = nightCheckIn || defaultNightIn;
        const outStr = nightCheckOut || defaultNightOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    let attendance = await Attendance.findOne({ employeeId, date });
    if (attendance) {
      attendance.status = status;
      attendance.checkIn = checkInDate;
      attendance.checkOut = checkOutDate;
      attendance.nightCheckIn = nightCheckInDate;
      attendance.nightCheckOut = nightCheckOutDate;
      attendance.overtimeHours = status === 'Present' ? (Number(overtimeHours) || 0) : 0;
      attendance.isNightShift = status === 'Present' ? isNightShiftActive : false;
      attendance.nightShiftHours = (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0;
      await attendance.save();
    } else {
      attendance = new Attendance({
        employeeId,
        date,
        status,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        nightCheckIn: nightCheckInDate,
        nightCheckOut: nightCheckOutDate,
        overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
        isNightShift: status === 'Present' ? isNightShiftActive : false,
        nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
      });
      await attendance.save();
    }

    res.status(200).json({ success: true, message: 'Attendance updated successfully!', attendance });
  } catch (error) {
    next(error);
  }
};

// Bulk Mark Attendance (Multiple Specific Employees)
exports.bulkMarkAttendance = async (req, res, next) => {
  const { employeeIds, date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ success: false, message: 'employeeIds array is required.' });
  }
  if (!date || !status) {
    return res.status(400).json({ success: false, message: 'Date and Status are required fields.' });
  }

  try {
    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        checkInDate = checkIn ? new Date(`${date}T${checkIn}:00+05:30`) : new Date(`${date}T09:00:00+05:30`);
        checkOutDate = checkOut ? new Date(`${date}T${checkOut}:00+05:30`) : new Date(`${date}T17:00:00+05:30`);
      }

      if (isNightShiftActive) {
        const defaultIn = '20:00';
        const defaultOut = '04:00';
        const inStr = nightCheckIn || defaultIn;
        const outStr = nightCheckOut || defaultOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    const operations = employeeIds.map(empId => {
      return {
        updateOne: {
          filter: { employeeId: empId, date },
          update: {
            $set: {
              status,
              checkIn: checkInDate,
              checkOut: checkOutDate,
              nightCheckIn: nightCheckInDate,
              nightCheckOut: nightCheckOutDate,
              overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
              isNightShift: status === 'Present' ? isNightShiftActive : false,
              nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
            }
          },
          upsert: true
        }
      };
    });

    await Attendance.bulkWrite(operations);

    res.status(200).json({ success: true, message: `Bulk attendance updated successfully for ${employeeIds.length} employees on ${date}!` });
  } catch (error) {
    next(error);
  }
};

// Blanket Mark Attendance (All Active Employees)
exports.blanketMarkAttendance = async (req, res, next) => {
  const { date, status, checkIn, checkOut, overtimeHours, isNightShift, nightShiftHours, nightCheckIn, nightCheckOut, workedDay, workedNight } = req.body;

  if (!date || !status) {
    return res.status(400).json({ success: false, message: 'Date and Status are required fields.' });
  }

  try {
    // Exclude discontinued employees from blanket attendance marking
    const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
    if (!employees || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees found to register attendance.' });
    }

    let checkInDate = null;
    let checkOutDate = null;
    let nightCheckInDate = null;
    let nightCheckOutDate = null;
    let isNightShiftActive = false;

    if (status === 'Present') {
      const hasAnyTimeInput = checkIn || checkOut || nightCheckIn || nightCheckOut;
      const isDayShiftActive = workedDay !== false && (checkIn || checkOut || !hasAnyTimeInput);
      isNightShiftActive = workedNight || (isNightShift && !hasAnyTimeInput) || (nightCheckIn || nightCheckOut);

      if (isDayShiftActive) {
        checkInDate = checkIn ? new Date(`${date}T${checkIn}:00+05:30`) : new Date(`${date}T09:00:00+05:30`);
        checkOutDate = checkOut ? new Date(`${date}T${checkOut}:00+05:30`) : new Date(`${date}T17:00:00+05:30`);
      }

      if (isNightShiftActive) {
        const defaultIn = '20:00';
        const defaultOut = '04:00';
        const inStr = nightCheckIn || defaultIn;
        const outStr = nightCheckOut || defaultOut;

        nightCheckInDate = new Date(`${date}T${inStr}:00+05:30`);
        nightCheckOutDate = new Date(`${date}T${outStr}:00+05:30`);
        if (nightCheckOutDate <= nightCheckInDate) {
          nightCheckOutDate.setDate(nightCheckOutDate.getDate() + 1);
        }
      }
    }

    const operations = employees.map(emp => {
      return {
        updateOne: {
          filter: { employeeId: emp._id, date },
          update: {
            $set: {
              status,
              checkIn: checkInDate,
              checkOut: checkOutDate,
              nightCheckIn: nightCheckInDate,
              nightCheckOut: nightCheckOutDate,
              overtimeHours: status === 'Present' ? (Number(overtimeHours) || 0) : 0,
              isNightShift: status === 'Present' ? isNightShiftActive : false,
              nightShiftHours: (status === 'Present' && isNightShiftActive) ? (Number(nightShiftHours) || 0) : 0
            }
          },
          upsert: true
        }
      };
    });

    await Attendance.bulkWrite(operations);

    res.status(200).json({ success: true, message: `Blanket attendance updated for all active employees on ${date}!` });
  } catch (error) {
    next(error);
  }
};
