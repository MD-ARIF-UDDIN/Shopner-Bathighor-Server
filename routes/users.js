const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

// Apply protection & admin filter to all routes
router.use(protect);
router.use(admin);

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}).select('-password').populate('memberId');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create new user
// @route   POST /api/users
// @access  Private/Admin
router.post('/', async (req, res) => {
  let { name, mobile, username, password, role, status, memberId } = req.body;

  if (!name || !mobile || !username || !password) {
    return res.status(400).json({ message: 'নাম, মোবাইল, ইউজারনেম এবং পাসওয়ার্ড পূরণ করা আবশ্যক' });
  }

  name = name.trim();
  mobile = mobile.trim();
  username = username.trim().toLowerCase();

  try {
    const userExists = await User.findOne({ username });

    if (userExists) {
      return res.status(400).json({ message: 'ইউজারনেমটি ইতিমধ্যে ব্যবহৃত হয়েছে' });
    }

    const user = await User.create({
      name,
      mobile,
      username,
      password,
      role: role || 'member',
      status: status || 'active',
      memberId: memberId || null
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      username: user.username,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      memberId: user.memberId
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'এই ইউজারনেমটি ইতিমধ্যে ব্যবহৃত হয়েছে বা ডাটাবেজে কনফ্লিক্ট রয়েছে' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin
router.put('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.id || req.params.id);

    if (user) {
      user.name = req.body.name || user.name;
      user.mobile = req.body.mobile || user.mobile;
      user.username = req.body.username || user.username;
      user.role = req.body.role || user.role;
      user.status = req.body.status || user.status;
      user.memberId = req.body.memberId !== undefined ? req.body.memberId : user.memberId;

      if (req.body.password) {
        user.password = req.body.password; // Pre-save hook hashes this
      }

      const updatedUser = await user.save();
      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        username: updatedUser.username,
        mobile: updatedUser.mobile,
        role: updatedUser.role,
        status: updatedUser.status,
        memberId: updatedUser.memberId
      });
    } else {
      res.status(404).json({ message: 'ব্যবহারকারী পাওয়া যায়নি' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      if (user.username === 'admin') {
        return res.status(400).json({ message: 'মূল এডমিন ইউজারটি ডিলিট করা সম্ভব নয়' });
      }
      await User.deleteOne({ _id: req.params.id });
      res.json({ message: 'ব্যবহারকারী মুছে ফেলা হয়েছে' });
    } else {
      res.status(404).json({ message: 'ব্যবহারকারী পাওয়া যায়নি' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
