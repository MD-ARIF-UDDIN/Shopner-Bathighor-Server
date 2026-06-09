const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  projectName: { type: String, required: true },
  projectType: { type: String, required: true }, // e.g. "রিকশা", "দোকান"
  driverName: { type: String, required: true },
  driverMobile: { type: String, required: true },
  driverAddress: { type: String, required: true },
  driverNid: { type: String, required: true },
  nomineeName: { type: String, required: true },
  nomineeMobile: { type: String, required: true },
  investmentAmount: { type: Number, required: true },
  interestPercentage: { type: Number },
  returnAmount: { type: Number, required: true },
  startDate: { type: Date, required: true },
  installmentDuration: { type: Number, required: true }, // In months
  monthlyInstallmentAmount: { type: Number, required: true },
  status: { type: String, enum: ['active', 'completed', 'due'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Project', ProjectSchema);
