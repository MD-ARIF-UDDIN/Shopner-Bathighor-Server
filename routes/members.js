const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

// Helper to calculate months elapsed since joining date
// Billing cutoff is PREVIOUS month: members pay current month's dues in the next month
// e.g. In June, they pay May's dues → June is NOT yet billable
const calculateMonthsElapsed = (joiningDate) => {
  const start = new Date(joiningDate);
  const now = new Date();
  // Billing ends at previous month
  const billingEnd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (start > billingEnd) return 0;
  
  const startYear = start.getFullYear();
  const startMonth = start.getMonth(); // 0-11
  const endYear = billingEnd.getFullYear();
  const endMonth = billingEnd.getMonth(); // 0-11
  
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
};

// Helper to generate list of months from start date to previous month (billing cutoff)
// Members pay current month's dues in the next month, so current month is not yet billable
const generateMonthList = (startDate) => {
  const start = new Date(startDate);
  const now = new Date();
  const list = [];
  
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  // Billing ends at previous month
  const billingEnd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  
  while (current <= billingEnd) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    list.push(`${year}-${month}`);
    current.setMonth(current.getMonth() + 1);
  }
  
  return list; // Array of "YYYY-MM" strings
};

// @desc    Get all members with calculations
// @route   GET /api/members
// @access  Private (all roles see all members)
router.get('/', protect, async (req, res) => {
  try {
    // All authenticated users (admin & member) can view all members
    const members = await Member.find({}).sort({ createdAt: -1 });
    
    const membersWithCalculations = await Promise.all(
      members.map(async (member) => {
        const deposits = await Deposit.find({ member: member._id });
        const totalDeposited = deposits.reduce((sum, dep) => sum + dep.amount, 0);
        
        const monthsElapsed = calculateMonthsElapsed(member.joiningDate);
        const expectedDeposits = monthsElapsed * member.monthlyDepositAmount;
        
        const totalDue = Math.max(0, expectedDeposits - totalDeposited);
        const currentBalance = totalDeposited;

        return {
          ...member.toObject(),
          totalDeposited,
          totalDue,
          currentBalance,
          monthsElapsed
        };
      })
    );

    res.json(membersWithCalculations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get single member details with calculations & due schedules
// @route   GET /api/members/:id
// @access  Private (all roles can view any member)
router.get('/:id', protect, async (req, res) => {
  try {
    // All authenticated users can view any member's details
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'সদস্য পাওয়া যায়নি' });
    }

    const deposits = await Deposit.find({ member: member._id }).sort({ date: -1 });
    const totalDeposited = deposits.reduce((sum, dep) => sum + dep.amount, 0);
    
    const monthsElapsed = calculateMonthsElapsed(member.joiningDate);
    const expectedDeposits = monthsElapsed * member.monthlyDepositAmount;
    const totalDue = Math.max(0, expectedDeposits - totalDeposited);
    
    // Generate monthly schedule status
    const expectedMonths = generateMonthList(member.joiningDate);
    const schedule = expectedMonths.map((mStr) => {
      // Find deposits corresponding to this specific month YYYY-MM
      const monthDeposits = deposits.filter((d) => d.month === mStr);
      const paidAmount = monthDeposits.reduce((sum, d) => sum + d.amount, 0);
      const isPaid = paidAmount >= member.monthlyDepositAmount;
      
      return {
        month: mStr, // "YYYY-MM"
        expectedAmount: member.monthlyDepositAmount,
        paidAmount,
        isPaid,
        status: isPaid ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'DUE'),
        deposits: monthDeposits
      };
    });

    res.json({
      member,
      calculations: {
        totalDeposited,
        expectedDeposits,
        totalDue,
        currentBalance: totalDeposited,
        monthsElapsed
      },
      schedule,
      deposits
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Add member
// @route   POST /api/members
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
  const { name, mobile, address, nid, joiningDate, monthlyDepositAmount, status } = req.body;

  try {
    const member = new Member({
      name,
      mobile,
      address,
      nid,
      joiningDate,
      monthlyDepositAmount: Number(monthlyDepositAmount),
      status
    });

    const createdMember = await member.save();
    res.status(201).json(createdMember);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Edit member
// @route   PUT /api/members/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
  const { name, mobile, address, nid, joiningDate, monthlyDepositAmount, status } = req.body;

  try {
    const member = await Member.findById(req.params.id);

    if (member) {
      member.name = name || member.name;
      member.mobile = mobile || member.mobile;
      member.address = address || member.address;
      member.nid = nid || member.nid;
      member.joiningDate = joiningDate || member.joiningDate;
      member.monthlyDepositAmount = monthlyDepositAmount !== undefined ? Number(monthlyDepositAmount) : member.monthlyDepositAmount;
      member.status = status || member.status;

      const updatedMember = await member.save();
      res.json(updatedMember);
    } else {
      res.status(404).json({ message: 'সদস্য পাওয়া যায়নি' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Record member deposit
// @route   POST /api/members/:id/deposit
// @access  Private/Admin
router.post('/:id/deposit', protect, admin, async (req, res) => {
  const { amount, month, date } = req.body;

  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'সদস্য পাওয়া যায়নি' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'সঠিক জমার পরিমাণ দিন' });
    }

    if (!month) {
      return res.status(400).json({ message: 'মাস উল্লেখ করুন' });
    }

    const deposit = new Deposit({
      member: member._id,
      amount: Number(amount),
      month, // e.g. "2026-06"
      date: date ? new Date(date) : Date.now(),
      recordedBy: req.user._id
    });

    const savedDeposit = await deposit.save();
    res.status(201).json(savedDeposit);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Get member deposit history
// @route   GET /api/members/:id/history
// @access  Private (all roles can view any member's history)
router.get('/:id/history', protect, async (req, res) => {
  try {
    // All authenticated users can view deposit history
    const deposits = await Deposit.find({ member: req.params.id })
      .populate('recordedBy', 'name')
      .sort({ date: -1 });
      
    res.json(deposits);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete member
// @route   DELETE /api/members/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'সদস্য পাওয়া যায়নি' });
    }

    // Delete associated User accounts
    await User.deleteMany({ memberId: member._id });
    // Delete associated Deposit records
    await Deposit.deleteMany({ member: member._id });
    // Delete the member
    await member.deleteOne();

    res.json({ message: 'সদস্য এবং তার সংশ্লিষ্ট সমস্ত তথ্য সফলভাবে মুছে ফেলা হয়েছে' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete deposit record
// @route   DELETE /api/members/deposit/:id
// @access  Private/Admin
router.delete('/deposit/:id', protect, admin, async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) {
      return res.status(404).json({ message: 'জমার রেকর্ড পাওয়া যায়নি' });
    }

    await deposit.deleteOne();
    res.json({ message: 'জমার রেকর্ডটি সফলভাবে মুছে ফেলা হয়েছে' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
