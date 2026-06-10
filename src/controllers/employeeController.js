const Employee = require('../models/Employee');

// Get All Employees
exports.getAllEmployees = async (req, res, next) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (error) {
    next(error);
  }
};

// Add Employee
exports.createEmployee = async (req, res, next) => {
  try {
    const employeeData = { ...req.body };
    // If email is empty string or undefined, delete it so the sparse unique index is not violated
    if (!employeeData.email || employeeData.email.trim() === '') {
      delete employeeData.email;
    }
    const employee = new Employee(employeeData);
    const savedEmployee = await employee.save();
    res.status(201).json(savedEmployee);
  } catch (error) {
    next(error);
  }
};

// Update Employee
exports.updateEmployee = async (req, res, next) => {
  try {
    const updateData = { ...req.body };
    const updateQuery = {};
    if (!updateData.email || updateData.email.trim() === '') {
      delete updateData.email;
      updateQuery.$set = updateData;
      updateQuery.$unset = { email: "" };
    } else {
      updateQuery.$set = updateData;
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(req.params.id, updateQuery, { new: true });
    if (!updatedEmployee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(updatedEmployee);
  } catch (error) {
    next(error);
  }
};

// Delete Employee
exports.deleteEmployee = async (req, res, next) => {
  try {
    const deletedEmployee = await Employee.findByIdAndDelete(req.params.id);
    if (!deletedEmployee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Get All Active Employees (status is not Inactive or Discontinued)
exports.getActiveEmployees = async (req, res, next) => {
  try {
    const activeEmployees = await Employee.find({ status: { $nin: ['Inactive', 'Discontinued'] } });
    res.json(activeEmployees);
  } catch (error) {
    next(error);
  }
};

// Get Employee Profile (Self or Admin Query)
exports.getMyProfile = async (req, res, next) => {
  try {
    // Check email from query param (fallback) or from authenticated user
    const email = req.query.email || (req.user && req.user.email);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email identifier is missing.' });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }
    res.status(200).json(employee);
  } catch (error) {
    next(error);
  }
};
