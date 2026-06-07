const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');
const User = require('./models/User');

try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('Failed to set custom DNS servers:', e.message);
}

dotenv.config();

const seedSystem = async () => {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected.');

    // Create admin user only
    const adminUser = await User.findOne({ username: 'admin' });

    if (!adminUser) {
      await User.create({
        name: 'এডমিন',
        mobile: '01700000000',
        username: 'admin',
        password: 'password123', // hashed by pre-save hook
        role: 'admin',
        status: 'active'
      });

      console.log('✅ Admin user created successfully');
      console.log('Username: admin');
      console.log('Password: password123');
    } else {
      console.log('ℹ️ Admin user already exists');
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error(`Seeding error: ${error.message}`);
    process.exit(1);
  }
};

seedSystem();