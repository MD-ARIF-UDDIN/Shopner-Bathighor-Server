const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Installment = require('../models/Installment');
const { protect, admin } = require('../middleware/auth');
const {
  calcProjectMetrics,
  syncProjectFinancials,
  deriveInterestPercentage
} = require('../utils/investmentCalculations');

const enrichProject = (projectObj) => ({
  ...projectObj,
  interestPercentage: deriveInterestPercentage(projectObj)
});

// Helper to generate list of months from start date up to installment duration
const generateProjectMonthsList = (startDate, durationMonths) => {
  const start = new Date(startDate);
  const list = [];

  for (let i = 0; i < durationMonths; i++) {
    const temp = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const year = temp.getFullYear();
    const month = String(temp.getMonth() + 1).padStart(2, '0');
    list.push(`${year}-${month}`);
  }

  return list;
};

// @desc    Get all projects with calculations
// @route   GET /api/projects
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const projects = await Project.find({}).sort({ createdAt: -1 });

    const projectsWithCalculations = await Promise.all(
      projects.map(async (project) => {
        const installments = await Installment.find({ project: project._id });
        const totalPaid = installments.reduce((sum, inst) => sum + inst.amount, 0);
        const projectObj = enrichProject(project.toObject());
        const metrics = calcProjectMetrics(projectObj, totalPaid, null, installments);

        return {
          ...projectObj,
          ...metrics
        };
      })
    );

    res.json(projectsWithCalculations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get single project details with calculations & schedules
// @route   GET /api/projects/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'প্রজেক্ট পাওয়া যায়নি' });
    }

    const installments = await Installment.find({ project: project._id }).sort({ date: -1 });
    const totalPaid = installments.reduce((sum, inst) => sum + inst.amount, 0);
    const projectObj = enrichProject(project.toObject());
    const metrics = calcProjectMetrics(projectObj, totalPaid, null, installments);

    const durationMonthsList = generateProjectMonthsList(project.startDate, project.installmentDuration);
    const currentStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    const schedule = durationMonthsList.map((mStr) => {
      const monthInstallments = installments.filter((inst) => inst.month === mStr);
      const paidAmount = monthInstallments.reduce((sum, inst) => sum + inst.amount, 0);
      const isPaid = paidAmount >= project.monthlyInstallmentAmount;

      let status = 'DUE';
      if (isPaid) {
        status = 'PAID';
      } else if (paidAmount > 0) {
        status = 'PARTIAL';
      } else if (mStr > currentStr) {
        status = 'UPCOMING';
      }

      return {
        month: mStr,
        expectedAmount: project.monthlyInstallmentAmount,
        paidAmount,
        status,
        installments: monthInstallments
      };
    });

    res.json({
      project: projectObj,
      calculations: metrics,
      schedule,
      installments
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create project
// @route   POST /api/projects
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
  const {
    projectName,
    projectType,
    driverName,
    driverMobile,
    driverAddress,
    driverNid,
    nomineeName,
    nomineeMobile,
    startDate,
    status,
    lastEdited
  } = req.body;

  try {
    const financials = syncProjectFinancials({ ...req.body, lastEdited });

    const project = new Project({
      projectName,
      projectType,
      driverName,
      driverMobile,
      driverAddress,
      driverNid,
      nomineeName,
      nomineeMobile,
      ...financials,
      startDate,
      status
    });

    const createdProject = await project.save();
    res.status(201).json(enrichProject(createdProject.toObject()));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Edit project
// @route   PUT /api/projects/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (project) {
      project.projectName = req.body.projectName || project.projectName;
      project.projectType = req.body.projectType || project.projectType;
      project.driverName = req.body.driverName || project.driverName;
      project.driverMobile = req.body.driverMobile || project.driverMobile;
      project.driverAddress = req.body.driverAddress || project.driverAddress;
      project.driverNid = req.body.driverNid || project.driverNid;
      project.nomineeName = req.body.nomineeName || project.nomineeName;
      project.nomineeMobile = req.body.nomineeMobile || project.nomineeMobile;
      project.startDate = req.body.startDate || project.startDate;
      project.status = req.body.status || project.status;

      const financials = syncProjectFinancials({
        investmentAmount: req.body.investmentAmount ?? project.investmentAmount,
        interestPercentage: req.body.interestPercentage ?? project.interestPercentage,
        returnAmount: req.body.returnAmount ?? project.returnAmount,
        installmentDuration: req.body.installmentDuration ?? project.installmentDuration,
        lastEdited: req.body.lastEdited
      });

      Object.assign(project, financials);

      const updatedProject = await project.save();
      res.json(enrichProject(updatedProject.toObject()));
    } else {
      res.status(404).json({ message: 'প্রজেক্ট পাওয়া যায়নি' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Collect installment
// @route   POST /api/projects/:id/installment
// @access  Private/Admin
router.post('/:id/installment', protect, admin, async (req, res) => {
  const { amount, month, date } = req.body;

  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'প্রজেক্ট পাওয়া যায়নি' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'সঠিক কিস্তির পরিমাণ দিন' });
    }

    if (!month) {
      return res.status(400).json({ message: 'মাস উল্লেখ করুন' });
    }

    const installment = new Installment({
      project: project._id,
      amount: Number(amount),
      month,
      date: date ? new Date(date) : Date.now(),
      recordedBy: req.user._id
    });

    const savedInstallment = await installment.save();
    res.status(201).json(savedInstallment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Get project installment history
// @route   GET /api/projects/:id/history
// @access  Private
router.get('/:id/history', protect, async (req, res) => {
  try {
    const installments = await Installment.find({ project: req.params.id })
      .populate('recordedBy', 'name')
      .sort({ date: -1 });

    res.json(installments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'প্রজেক্ট পাওয়া যায়নি' });
    }

    // Delete associated Installment records
    await Installment.deleteMany({ project: project._id });
    // Delete the project
    await project.deleteOne();

    res.json({ message: 'প্রজেক্ট এবং তার সংশ্লিষ্ট সমস্ত কিস্তির রেকর্ড সফলভাবে মুছে ফেলা হয়েছে' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete installment record
// @route   DELETE /api/projects/installment/:id
// @access  Private/Admin
router.delete('/installment/:id', protect, admin, async (req, res) => {
  try {
    const installment = await Installment.findById(req.params.id);
    if (!installment) {
      return res.status(404).json({ message: 'কিস্তির রেকর্ড পাওয়া যায়নি' });
    }

    await installment.deleteOne();
    res.json({ message: 'কিস্তির রেকর্ডটি সফলভাবে মুছে ফেলা হয়েছে' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
