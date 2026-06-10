const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  dateOfJoining: { type: Date, required: true },
  grossSalary: { type: Number, required: true },
  designation: { type: String, default: '' },
  location: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'On Hold', 'On Holiday', 'Inactive', 'Discontinued'], default: 'Active' },
  defaultShift: { type: String, default: 'Day (09:30 - 17:30)' },
  hra: { type: Number, default: 0 }
}, { timestamps: true });

const Employee = mongoose.model('Employee', employeeSchema);

// Sync indexes to ensure unique sparse email index is created correctly
Employee.syncIndexes().catch(err => {
  console.log('Error syncing Employee indexes, attempting dropIndex email_1 first...');
  Employee.collection.dropIndex('email_1')
    .then(() => Employee.syncIndexes())
    .catch(dropErr => console.log('Employee index sync deferred or index already clean:', dropErr.message));
});

module.exports = Employee;
