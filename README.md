# একতা সঞ্চয় ও উদ্যোগ ফাউন্ডেশন  (Backend Server)

This is the Express + Node.js + MongoDB backend server application for **Tarun Udyokta Samonbay Samiti** (Cooperative Management System).

## 🚀 Key Features

1. **Sequential Member IDs**:
   - Implements an atomic counter system (`Counter` model) that sequentially issues new IDs starting from `1000`, completely avoiding manual ID errors.

2. **Automated Interest & Savings Calculations**:
   - Computes expected member savings deposits based on dynamic timeline metrics (`monthsElapsed`).
   - Calculates outstanding member dues dynamically in real-time.
   - Computes project installments schedules, outstanding dues, and project profit/losses based on elapsed timelines.

3. **Secure Authentication & Permissions**:
   - Uses `JSON Web Tokens (JWT)` with cookies or authorization headers.
   - Fully guards restricted routes via custom `protect` and `adminOnly` express middlewares.

4. **Comprehensive Financial Reporting Endpoints**:
   - Serves unified dashboard statistics including split dues (Member savings dues vs Project returns dues).
   - Generates filterable ledgers for savings deposits, overdue lists, installment collections, project debts, and profit yields.

---

## 🛠️ API Architecture

### 📬 Endpoints
- **`/api/auth`**: Users login (`POST /login`) and session context lookup (`GET /me`).
- **`/api/users`**: Admin utility for user management and login credential creation.
- **`/api/members`**: Member directory, deposit additions, history, and individual payment schedules.
- **`/api/projects`**: Project directory, capital investments, installment collection logs, and timelines.
- **`/api/reports`**: Real-time KPI summaries and customizable date/month/year filter reports.

### 🗄️ Database Schema & Models
- `Counter` - Atomic increment registers for identifiers.
- `User` - Login credentials, usernames, mobile, and user roles (`admin` | `member`).
- `Member` - Full profiles, mobile, joining date, monthly savings obligations, total savings deposits, and cumulative due calculations.
- `Deposit` - Transaction history logs for member savings.
- `Project` - Capital investment records, drivers, nominees, capital costs, return targets, active months, and status checks.
- `Installment` - Transaction history logs for project collections.

---

## 💻 Startup & Configurations

### 1. Installation
Install server dependencies:
```bash
npm install
```

### 2. Environment Variables (`.env`)
Create a `.env` file in the root directory with the following variables:
```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
```

### 3. Database Seeding
To initialize the counters and create the default admin account:
```bash
npm run seed
```

### 4. Running the Server
Start the development server:
```bash
npm run dev
```
Starts the API on `http://localhost:5000`.
