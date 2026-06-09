const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');
const User = require('./models/User');
const Counter = require('./models/Counter');
const Member = require('./models/Member');
const Deposit = require('./models/Deposit');
const Project = require('./models/Project');
const Installment = require('./models/Installment');

// Force Node to use Google DNS for SRV record lookup resolution
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('Failed to set custom DNS servers in seed:', e.message);
}

dotenv.config();

const seedSystem = async () => {
  try {
    console.log('Connecting to database for seeding...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected.');

    // 1. Seed default counter sequence for members
    const counter = await Counter.findOne({ id: 'memberId' });
    if (!counter) {
      await Counter.create({ id: 'memberId', seq: 1000 });
      console.log('Member sequence counter initialized to 1000.');
    } else {
      console.log('Member sequence counter already exists.');
    }

    // 2. Seed default admin user
    const adminUser = await User.findOne({ username: 'admin' });
    if (!adminUser) {
      await User.create({
        name: 'এডমিন',
        mobile: '01700000000',
        username: 'admin',
        password: 'password123', // Will be hashed by User pre-save hook
        role: 'admin',
        status: 'active'
      });
      console.log('Default Admin user created successfully.');
      console.log('Username: admin');
      console.log('Password: password123');
    } else {
      console.log('Admin user already exists.');
    }

    // 3. Create User accounts for all Members
    // First: delete all existing member-role users so we recreate them fresh
    console.log('\n--- Creating member user accounts ---');
    const deletedMemberUsers = await User.deleteMany({ role: 'member' });
    console.log(`Deleted ${deletedMemberUsers.deletedCount} old member user accounts.`);

    const allMembers = await Member.find({}).sort({ memberId: 1 });
    const createdCredentials = [];

    for (const member of allMembers) {
      const username = member.mobile;        // mobile number as username
      const password = `tusomiti@${member.memberId}`; // e.g. arif@1001

      // Skip if user already exists with this username
      const existing = await User.findOne({ username });
      if (existing) {
        // Update the memberId link in case it's missing
        if (!existing.memberId || String(existing.memberId) !== String(member._id)) {
          existing.memberId = member._id;
          await existing.save();
        }
        createdCredentials.push({ memberId: member.memberId, name: member.name, username, password: '(already existed — unchanged)', mobile: member.mobile });
        console.log(`  SKIP  memberId ${member.memberId} (${member.name}) — user "${username}" already exists`);
        continue;
      }

      await User.create({
        name: member.name,
        mobile: member.mobile,
        username,
        password,   // hashed by pre-save hook
        role: 'member',
        status: 'active',
        memberId: member._id
      });

      createdCredentials.push({ memberId: member.memberId, name: member.name, username, password, mobile: member.mobile });
      console.log(`  OK    memberId ${member.memberId} (${member.name}) — username: ${username}  password: ${password}`);
    }

    // 4. Update all members' joiningDate to 01 Jul 2024
    // Business rule: members pay current month's dues in the next month (arrears).
    // With billing cutoff = previous month, Jul 2024 -> May 2026 = 23 months x 2,000 = 46,000 tk
    console.log("\nUpdating all members' joiningDate to 2024-07-01...");
    const targetDate = new Date('2024-07-01T00:00:00.000Z');
    const updateResult = await Member.updateMany({}, { $set: { joiningDate: targetDate } });
    console.log(`Updated joiningDate to 2024-07-01 for ${updateResult.matchedCount} members (modified: ${updateResult.modifiedCount}).`);

    // 5. Seed per-member monthly deposits
    // Business rule: members pay in arrears - July's dues are paid in August, etc.
    // Deposit date = 1st of the NEXT month after the due month.
    // Monthly rate = 2000 tk. Payments run consecutively from July 2024.
    //
    // memberId format: 1001, 1002, ..., 1016 (counter starts at 1000, first member = 1001)
    const memberBalances = [
      { memberId: '1',  totalPaid: 44000 },
      { memberId: '2',  totalPaid: 40000 },
      { memberId: '3',  totalPaid: 36000 },
      { memberId: '4',  totalPaid: 42000 },
      { memberId: '5',  totalPaid: 40000 },
      { memberId: '6',  totalPaid: 40000 },
      { memberId: '7',  totalPaid: 44000 },
      { memberId: '8',  totalPaid: 36000 },
      { memberId: '9',  totalPaid: 44000 },
      { memberId: '10', totalPaid: 42000 },
      { memberId: '11', totalPaid: 40000 },
      { memberId: '12', totalPaid: 44000 },
      { memberId: '13', totalPaid: 44000 },
      { memberId: '14', totalPaid: 38000 },
      { memberId: '15', totalPaid: 38000 },
      { memberId: '16', totalPaid: 36000 },
    ];

    const MONTHLY_AMOUNT = 2000;

    // Generate full month list: Jul 2024 -> May 2026 (23 months)
    const allMonths = [];
    let cur = new Date(2024, 6, 1); // July 2024 (JS month 6 = July)
    const endMonth = new Date(2026, 4, 1); // May 2026 (JS month 4 = May)
    while (cur <= endMonth) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      allMonths.push(`${y}-${m}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    console.log(`\nMonth range: ${allMonths[0]} -> ${allMonths[allMonths.length - 1]} (${allMonths.length} months)`);

    // Clear all existing deposits before re-seeding
    const deleted = await Deposit.deleteMany({});
    console.log(`Cleared ${deleted.deletedCount} existing deposit records.`);

    const currentAdmin = await User.findOne({ username: 'admin' });
    let totalDepositsCreated = 0;

    for (const { memberId, totalPaid } of memberBalances) {
      const member = await Member.findOne({ memberId });
      if (!member) {
        console.warn(`  WARNING: Member with memberId ${memberId} not found, skipping.`);
        continue;
      }

      const monthsPaid = Math.round(totalPaid / MONTHLY_AMOUNT);
      const paidMonths = allMonths.slice(0, monthsPaid);

      const deposits = paidMonths.map((monthStr) => {
        // Deposit date = 1st of following month (arrears: July's due paid in August)
        // monthStr e.g. "2024-07" -> m=7 (1-indexed) -> new Date(2024, 7, 1) = Aug 1, 2024
        const [y, m] = monthStr.split('-').map(Number);
        const depositDate = new Date(y, m, 1); // m is already 1-indexed, JS 0-indexed = next month
        return {
          member: member._id,
          amount: MONTHLY_AMOUNT,
          month: monthStr,
          date: depositDate,
          recordedBy: currentAdmin?._id
        };
      });

      await Deposit.insertMany(deposits);
      console.log(`  OK memberId ${memberId}: ${monthsPaid} months x tk${MONTHLY_AMOUNT} = tk${totalPaid} (${paidMonths[0]} -> ${paidMonths[paidMonths.length - 1]})`);
      totalDepositsCreated += deposits.length;
    }

    console.log(`\nTotal deposit records created: ${totalDepositsCreated}`);

    // ─────────────────────────────────────────────────────────────────
    // PRINT FULL CREDENTIALS TABLE
    // ─────────────────────────────────────────────────────────────────
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║              MEMBER LOGIN CREDENTIALS (SAVE THIS!)               ║');
    console.log('╠══════════╦══════════════════════════╦══════════════════════════╦══╣');
    console.log('║ MemberID ║ Name                     ║ Username (mobile)        ║ Password          ║');
    console.log('╠══════════╬══════════════════════════╬══════════════════════════╬══╣');
    for (const c of createdCredentials) {
      const mid = c.memberId.padEnd(8);
      const name = (c.name || '').substring(0, 24).padEnd(24);
      const user = c.username.padEnd(24);
      const pass = c.password.padEnd(18);
      console.log(`║ ${mid} ║ ${name} ║ ${user} ║ ${pass} ║`);
    }
    console.log('╠══════════╩══════════════════════════╩══════════════════════════╩══╣');
    console.log('║  ADMIN:  username: admin    |  password: password123            ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');

    // ─────────────────────────────────────────────────────────────────
    // 5. Seed Projects and Installments
    // ─────────────────────────────────────────────────────────────────
    console.log('\n--- Seeding projects and installments ---');
    
    // Clear all existing projects and installments
    const deletedProjects = await Project.deleteMany({});
    const deletedInstallments = await Installment.deleteMany({});
    console.log(`Cleared ${deletedProjects.deletedCount} projects and ${deletedInstallments.deletedCount} installments.`);

    const projectsData = [
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "নুরুল হক",
        driverMobile: "01820289251",
        driverAddress: "মহরি পুকুর পাড়, শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547893",
        nomineeName: "আব্দুল আজিজ",
        nomineeMobile: "01800000000",
        investmentAmount: 78000,
        returnAmount: 96000,
        startDate: new Date('2024-10-11T00:00:00.000Z'),
        installmentDuration: 10,
        monthlyInstallmentAmount: 10000,
        totalPaid: 96000,
        status: "completed"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "মোহাম্মদ জাবের",
        driverMobile: "01830000000",
        driverAddress: "বাঁশখালী, চট্টগ্রাম",
        driverNid: "4612547894",
        nomineeName: "মোঃ আনসার",
        nomineeMobile: "01800000000",
        investmentAmount: 120000,
        returnAmount: 127300,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 127300,
        status: "completed"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "নুরুল হক",
        driverMobile: "01840000000",
        driverAddress: "মনকিচর, শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547895",
        nomineeName: "আবু তাহের",
        nomineeMobile: "01800000000",
        investmentAmount: 120000,
        returnAmount: 150000,
        startDate: new Date('2024-11-03T00:00:00.000Z'),
        installmentDuration: 15,
        monthlyInstallmentAmount: 10000,
        totalPaid: 143000,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "আব্দুল আজিজ",
        driverMobile: "01850070745",
        driverAddress: "মনকিচর, শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547896",
        nomineeName: "নুরুল হক",
        nomineeMobile: "01800000000",
        investmentAmount: 122000,
        returnAmount: 152000,
        startDate: new Date('2025-05-21T00:00:00.000Z'),
        installmentDuration: 16,
        monthlyInstallmentAmount: 10000,
        totalPaid: 126500,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "মোহাম্মদ এরশাদ",
        driverMobile: "01860000000",
        driverAddress: "বাঁশখালী, চট্টগ্রাম",
        driverNid: "4612547897",
        nomineeName: "মোঃ ফোরকান",
        nomineeMobile: "01800000000",
        investmentAmount: 120000,
        returnAmount: 150000,
        startDate: new Date('2025-05-28T00:00:00.000Z'),
        installmentDuration: 15,
        monthlyInstallmentAmount: 10000,
        totalPaid: 115000,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "আবছার মহল্লাপাড়া",
        driverMobile: "01806982744",
        driverAddress: "মহল্লাপাড়া, মনকিচর,শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547898",
        nomineeName: "নেজাম উদ্দিন",
        nomineeMobile: "01800000000",
        investmentAmount: 91000,
        returnAmount: 121000,
        startDate: new Date('2025-07-01T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 79000,
        status: "active"
      },
      {
        projectName: "পুরাতন গাড়ি",
        projectType: "অটো রিকশা",
        driverName: "আব্দুর রহিম",
        driverMobile: "01870000000",
        driverAddress: "নয়া গোনা, বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547899",
        nomineeName: "সেলিম উদ্দিন",
        nomineeMobile: "01800000000",
        investmentAmount: 100000,
        returnAmount: 124000,
        startDate: new Date('2025-07-06T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 114000,
        status: "active"
      },
      {
        projectName: "পুরাতন গাড়ি",
        projectType: "অটো রিকশা",
        driverName: "শফিকুর রহমান",
        driverMobile: "01880000000",
        driverAddress: "নয়াগুনা, বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547900",
        nomineeName: "মোঃ জামাল",
        nomineeMobile: "01800000000",
        investmentAmount: 66000,
        returnAmount: 75000,
        startDate: new Date('2025-07-21T00:00:00.000Z'),
        installmentDuration: 8,
        monthlyInstallmentAmount: 10000,
        totalPaid: 75000,
        status: "completed"
      },
      {
        projectName: "পুরাতন গাড়ি",
        projectType: "অটো রিকশা",
        driverName: "আব্দুর রশিদ",
        driverMobile: "01810237045",
        driverAddress: "মহল্লাপাড়া, মনকিচর,শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547901",
        nomineeName: "নূর হোসেন",
        nomineeMobile: "01800000000",
        investmentAmount: 35000,
        returnAmount: 45000,
        startDate: new Date('2025-08-11T00:00:00.000Z'),
        installmentDuration: 9,
        monthlyInstallmentAmount: 5000,
        totalPaid: 15000,
        status: "active"
      },
      {
        projectName: "পুরাতন চাল দিয়ে গাড়ি",
        projectType: "অটো রিকশা",
        driverName: "আহমাদুল্লাহ",
        driverMobile: "01829190275",
        driverAddress: "মহল্লাপাড়া, মনকিচর,শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547902",
        nomineeName: "জাহাঙ্গীর",
        nomineeMobile: "01800000000",
        investmentAmount: 100000,
        returnAmount: 130000,
        startDate: new Date('2025-09-16T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 61000,
        status: "active"
      },
      {
        projectName: "মিশুক",
        projectType: "অটো রিকশা",
        driverName: "আবসার পেলেহাজি",
        driverMobile: "01827106706",
        driverAddress: "পেলেহাজি পাড়া,বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547903",
        nomineeName: "মোঃ আমির",
        nomineeMobile: "01800000000",
        investmentAmount: 100000,
        returnAmount: 130000,
        startDate: new Date('2025-10-20T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 46900,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "আনিচ",
        driverMobile: "01890000000",
        driverAddress: "মহল্লাপাড়া, মনকিচর,শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547904",
        nomineeName: "শহীদুল্লাহ",
        nomineeMobile: "01800000000",
        investmentAmount: 127500,
        returnAmount: 157500,
        startDate: new Date('2025-11-05T00:00:00.000Z'),
        installmentDuration: 16,
        monthlyInstallmentAmount: 10000,
        totalPaid: 59500,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "মোঃ ইমরান উদ্দিন বিজয়",
        driverMobile: "01895000000",
        driverAddress: "মনকিচর, শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "4612547905",
        nomineeName: "আবুল কালাম",
        nomineeMobile: "01800000000",
        investmentAmount: 95000,
        returnAmount: 125000,
        startDate: new Date('2025-12-12T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 47500,
        status: "active"
      },
      {
        projectName: "বিবাটেক",
        projectType: "অটো রিকশা",
        driverName: "মোঃ আবু সালেক",
        driverMobile: "01896000000",
        driverAddress: "মহল্লাপাড়া, মনকিচর,শিলকূপ বাঁশখালী চট্টগ্রাম",
        driverNid: "19941510894000098",
        nomineeName: "আবুল কালাম",
        nomineeMobile: "01800000000",
        investmentAmount: 120000,
        returnAmount: 127000,
        startDate: new Date('2026-02-15T00:00:00.000Z'),
        installmentDuration: 13,
        monthlyInstallmentAmount: 10000,
        totalPaid: 127000,
        status: "completed"
      },
      {
        projectName: "মিশুক",
        projectType: "অটো রিকশা",
        driverName: "মোঃ মিনহাজ",
        driverMobile: "01897000000",
        driverAddress: "বাঁশখালী, চট্টগ্রাম",
        driverNid: "4612547906",
        nomineeName: "নেজাম উদ্দিন",
        nomineeMobile: "01800000000",
        investmentAmount: 50000,
        returnAmount: 65000,
        startDate: new Date('2026-03-14T00:00:00.000Z'),
        installmentDuration: 11,
        monthlyInstallmentAmount: 6000,
        totalPaid: 12000,
        status: "active"
      },
      {
        projectName: "মিশুক পুরাতন",
        projectType: "অটো রিকশা",
        driverName: "মোহাম্মদ রাশেদ",
        driverMobile: "01824164219",
        driverAddress: "নয়াগোনা",
        driverNid: "4612547907",
        nomineeName: "ইমরান",
        nomineeMobile: "01800000000",
        investmentAmount: 80000,
        returnAmount: 100000,
        startDate: new Date('2026-04-18T00:00:00.000Z'),
        installmentDuration: 10,
        monthlyInstallmentAmount: 10000,
        totalPaid: 20000,
        status: "active"
      },
      {
        projectName: "বিভাটেক",
        projectType: "অটো রিকশা",
        driverName: "মোহাম্মদ ইউনুস",
        driverMobile: "01825000000",
        driverAddress: "বাঁশখালী, চট্টগ্রাম",
        driverNid: "4612547908",
        nomineeName: "ইউসুফ",
        nomineeMobile: "01800000000",
        investmentAmount: 173000,
        returnAmount: 218000,
        startDate: new Date('2026-05-28T00:00:00.000Z'),
        installmentDuration: 19,
        monthlyInstallmentAmount: 12000,
        totalPaid: 20000,
        status: "active"
      }
    ];

    const calculateMonthsElapsedLocal = (startD) => {
      const start = new Date(startD);
      const end = new Date();
      if (start > end) return 0;
      const startYear = start.getFullYear();
      const startMonth = start.getMonth();
      const endYear = end.getFullYear();
      const endMonth = end.getMonth();
      return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    };

    const generateProjectMonthsListLocal = (startD, durationMonths) => {
      const start = new Date(startD);
      const list = [];
      for (let i = 0; i < durationMonths; i++) {
        const temp = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const year = temp.getFullYear();
        const month = String(temp.getMonth() + 1).padStart(2, '0');
        list.push(`${year}-${month}`);
      }
      return list;
    };

    const distributeInstallmentsLocal = (totalPaid, monthlyAmount, numMonths) => {
      if (numMonths <= 0) return [];
      let remaining = totalPaid;
      const payments = [];
      for (let i = 0; i < numMonths - 1; i++) {
        const remainingMonths = numMonths - i - 1;
        const maxFutureSpend = remainingMonths * monthlyAmount * 1.5;
        const minAmt = Math.max(0, remaining - maxFutureSpend);
        const maxAmt = Math.min(remaining, monthlyAmount * 1.5);

        const choices = [1.0, 0.8, 0.5, 1.2, 0.0];
        const factor = choices[(i + numMonths) % choices.length];
        let amt = Math.round(monthlyAmount * factor);

        if (amt < minAmt) amt = minAmt;
        if (amt > maxAmt) amt = maxAmt;

        amt = Math.round(amt / 100) * 100;
        if (amt > remaining) amt = remaining;

        payments.push(amt);
        remaining -= amt;
      }
      payments.push(Math.round(remaining));
      return payments;
    };

    let totalInstallmentsCreated = 0;

    for (const pData of projectsData) {
      const project = await Project.create({
        projectName: pData.projectName,
        projectType: pData.projectType,
        driverName: pData.driverName,
        driverMobile: pData.driverMobile,
        driverAddress: pData.driverAddress,
        driverNid: pData.driverNid,
        nomineeName: pData.nomineeName,
        nomineeMobile: pData.nomineeMobile,
        investmentAmount: pData.investmentAmount,
        returnAmount: pData.returnAmount,
        startDate: pData.startDate,
        installmentDuration: pData.installmentDuration,
        monthlyInstallmentAmount: pData.monthlyInstallmentAmount,
        status: pData.status
      });

      const elapsed = calculateMonthsElapsedLocal(pData.startDate);
      const activeMonths = pData.status === 'completed' 
        ? pData.installmentDuration 
        : Math.min(pData.installmentDuration, elapsed);

      const monthsList = generateProjectMonthsListLocal(pData.startDate, activeMonths);
      const payments = distributeInstallmentsLocal(pData.totalPaid, pData.monthlyInstallmentAmount, activeMonths);

      const installmentsToInsert = [];
      for (let i = 0; i < monthsList.length; i++) {
        const monthStr = monthsList[i];
        const amount = payments[i];
        if (amount > 0) {
          const [y, m] = monthStr.split('-').map(Number);
          const paymentDate = new Date(y, m - 1, 15);
          
          installmentsToInsert.push({
            project: project._id,
            amount: amount,
            month: monthStr,
            date: paymentDate,
            recordedBy: currentAdmin?._id
          });
        }
      }

      if (installmentsToInsert.length > 0) {
        await Installment.insertMany(installmentsToInsert);
        totalInstallmentsCreated += installmentsToInsert.length;
      }
      
      console.log(`  OK project for ${pData.driverName}: Created ${installmentsToInsert.length} installments totaling ${pData.totalPaid} (Remaining Dues: ${pData.returnAmount - pData.totalPaid})`);
    }

    console.log(`\nTotal project installments created: ${totalInstallmentsCreated}`);

    console.log('\nDatabase seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error(`Seeding error: ${error.message}`);
    process.exit(1);
  }
};

seedSystem();
