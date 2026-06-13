const crypto = require('crypto');
const AttendanceRequest = require('../models/AttendanceRequest');
const AttendanceApproval = require('../models/AttendanceApproval');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { sendAttendanceRequestEmail } = require('../services/mailService');

// Verify token validity
exports.checkToken = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required.' });
    }

    const request = await AttendanceRequest.findOne({ token });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Invalid attendance request link.' });
    }

    if (request.isSubmitted) {
      return res.status(400).json({
        success: false,
        isSubmitted: true,
        date: request.date,
        message: 'Attendance for this request has already been submitted and is locked.'
      });
    }

    if (new Date() > request.expiresAt) {
      return res.status(400).json({
        success: false,
        isExpired: true,
        message: 'This attendance request link has expired (24-hour limit).'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        date: request.date,
        email: request.email
      }
    });
  } catch (error) {
    next(error);
  }
};

// Supervisor submits attendance list
exports.submitAttendance = async (req, res, next) => {
  try {
    const { token, records } = req.body;
    if (!token || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Invalid payload: token and records array required.' });
    }

    // 1. Verify token
    const request = await AttendanceRequest.findOne({ token });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Invalid attendance request link.' });
    }

    if (request.isSubmitted) {
      return res.status(400).json({ success: false, message: 'Attendance already submitted and locked.' });
    }

    if (new Date() > request.expiresAt) {
      return res.status(400).json({ success: false, message: 'This attendance request has expired.' });
    }

    // 2. Insert supervisor records to AttendanceApproval queue
    const supervisorId = req.user._id;
    const date = request.date;

    const approvalDocs = records.map(rec => ({
      employeeId: rec.employeeId,
      date: date, // locked to request token date
      status: rec.status,
      workedDay: rec.status === 'Present' ? !!rec.workedDay : false,
      workedNight: rec.status === 'Present' ? !!rec.workedNight : false,
      checkIn: rec.status === 'Present' && rec.workedDay && rec.checkIn ? new Date(`${date}T${rec.checkIn}:00+05:30`) : null,
      checkOut: rec.status === 'Present' && rec.workedDay && rec.checkOut ? new Date(`${date}T${rec.checkOut}:00+05:30`) : null,
      nightCheckIn: rec.status === 'Present' && rec.workedNight && rec.nightCheckIn ? new Date(`${date}T${rec.nightCheckIn}:00+05:30`) : null,
      nightCheckOut: rec.status === 'Present' && rec.workedNight && rec.nightCheckOut ? new Date(`${date}T${rec.nightCheckOut}:00+05:30`) : null,
      overtimeHours: rec.status === 'Present' ? Number(rec.overtimeHours) || 0 : 0,
      isNightShift: rec.status === 'Present' ? !!rec.isNightShift : false,
      nightShiftHours: rec.status === 'Present' ? Number(rec.nightShiftHours) || 0 : 0,
      supervisorId: supervisorId,
      approvalStatus: 'pending'
    }));

    // Perform atomic upsert for each record to prevent duplicate conflicts
    for (const doc of approvalDocs) {
      await AttendanceApproval.findOneAndUpdate(
        { employeeId: doc.employeeId, date: doc.date },
        doc,
        { upsert: true, new: true }
      );
    }

    // 3. Mark request token as submitted
    request.isSubmitted = true;
    request.submittedAt = new Date();
    await request.save();

    res.status(200).json({
      success: true,
      message: 'Attendance submitted for approval successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Admin fetches pending or all approvals
exports.getPendingApprovals = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== 'all') {
      query.approvalStatus = status;
    } else if (!status) {
      query.approvalStatus = 'pending';
    }

    const pendings = await AttendanceApproval.find(query)
      .populate('employeeId', 'name designation location defaultShift')
      .populate('supervisorId', 'name email')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: pendings
    });
  } catch (error) {
    next(error);
  }
};

// Admin fetches request logs history
exports.getRequestLogs = async (req, res, next) => {
  try {
    const { page, limit } = req.query;

    if (page) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const skipNum = (pageNum - 1) * limitNum;

      const totalItems = await AttendanceRequest.countDocuments({});
      const totalPages = Math.ceil(totalItems / limitNum);

      const logs = await AttendanceRequest.find({})
        .populate('supervisorId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum);

      return res.status(200).json({
        success: true,
        data: logs,
        pagination: {
          totalItems,
          totalPages,
          currentPage: pageNum,
          limit: limitNum
        }
      });
    }

    const logs = await AttendanceRequest.find({})
      .populate('supervisorId', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
};

// Admin triggers a manual email link for a specific date
exports.sendManualRequest = async (req, res, next) => {
  try {
    const { date, supervisorId } = req.body;
    if (!date || !supervisorId) {
      return res.status(400).json({ success: false, message: 'Date (YYYY-MM-DD) and supervisorId are required.' });
    }

    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(404).json({ success: false, message: 'Active supervisor not found with given ID.' });
    }

    // Generate token and request record
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

    const newRequest = new AttendanceRequest({
      token,
      date,
      supervisorId,
      email: supervisor.email,
      triggerType: 'manual',
      expiresAt
    });
    await newRequest.save();

    // Send email
    const appUrl = 'https://sakshienterprises.netlify.app';
    const link = `${appUrl}/supervisor-attendance?token=${token}`;
    await sendAttendanceRequestEmail(supervisor.email, supervisor.name, date, link);

    res.status(200).json({
      success: true,
      message: `Manual attendance request sent successfully to ${supervisor.name} (${supervisor.email}) for date ${date}`
    });
  } catch (error) {
    next(error);
  }
};

// Admin approves pending submissions (moving them to main Attendance collection)
exports.approveAttendance = async (req, res, next) => {
  try {
    const { records } = req.body; // Array of finalized records sent by admin
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'An array of records is required.' });
    }

    for (const rec of records) {
      // Find matching approval record in database
      const approvalRec = await AttendanceApproval.findById(rec._id);
      if (!approvalRec) continue;

      // Build payload for main Attendance record
      const mainPayload = {
        employeeId: approvalRec.employeeId,
        date: approvalRec.date,
        status: rec.status,
        workedDay: rec.status === 'Present' ? !!rec.workedDay : false,
        workedNight: rec.status === 'Present' ? !!rec.workedNight : false,
        checkIn: rec.status === 'Present' && rec.workedDay && rec.checkIn ? new Date(rec.checkIn) : null,
        checkOut: rec.status === 'Present' && rec.workedDay && rec.checkOut ? new Date(rec.checkOut) : null,
        nightCheckIn: rec.status === 'Present' && rec.workedNight && rec.nightCheckIn ? new Date(rec.nightCheckIn) : null,
        nightCheckOut: rec.status === 'Present' && rec.workedNight && rec.nightCheckOut ? new Date(rec.nightCheckOut) : null,
        overtimeHours: rec.status === 'Present' ? Number(rec.overtimeHours) || 0 : 0,
        isNightShift: rec.status === 'Present' ? !!rec.isNightShift : false,
        nightShiftHours: rec.status === 'Present' ? Number(rec.nightShiftHours) || 0 : 0
      };

      // Upsert into main Attendance collection
      await Attendance.findOneAndUpdate(
        { employeeId: mainPayload.employeeId, date: mainPayload.date },
        mainPayload,
        { upsert: true, new: true }
      );

      // Update approval queue entry status
      approvalRec.approvalStatus = 'approved';
      // Sync edits to the approval document too so admin modifications are kept for audit
      approvalRec.status = rec.status;
      approvalRec.workedDay = mainPayload.workedDay;
      approvalRec.workedNight = mainPayload.workedNight;
      approvalRec.checkIn = mainPayload.checkIn;
      approvalRec.checkOut = mainPayload.checkOut;
      approvalRec.nightCheckIn = mainPayload.nightCheckIn;
      approvalRec.nightCheckOut = mainPayload.nightCheckOut;
      approvalRec.overtimeHours = mainPayload.overtimeHours;
      approvalRec.isNightShift = mainPayload.isNightShift;
      approvalRec.nightShiftHours = mainPayload.nightShiftHours;
      await approvalRec.save();
    }

    res.status(200).json({
      success: true,
      message: 'Finalized attendance logs approved and saved successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Admin discards/rejects pending submissions
exports.rejectAttendance = async (req, res, next) => {
  try {
    const { ids } = req.body; // Array of pending approval ids to discard
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'An array of attendance approval record IDs is required.' });
    }

    await AttendanceApproval.updateMany(
      { _id: { $in: ids } },
      { $set: { approvalStatus: 'rejected' } }
    );

    res.status(200).json({
      success: true,
      message: 'Pending supervisor attendance logs rejected successfully.'
    });
  } catch (error) {
    next(error);
  }
};
