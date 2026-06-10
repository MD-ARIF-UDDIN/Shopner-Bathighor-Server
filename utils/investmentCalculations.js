/**
 * Investment calculation helpers.
 * P = principal (investmentAmount)
 * R = interest percentage
 * T = return target (returnAmount)
 * I = total interest at full term (T - P)
 * N = installment duration in months
 * K = active months elapsed (capped at N)
 */

const calcReturnTarget = (P, R) => {
  const principal = Number(P);
  const rate = Number(R);
  if (!principal || isNaN(principal) || isNaN(rate)) return null;
  return principal + (principal * rate) / 100;
};

const calcInterestPercent = (P, T) => {
  const principal = Number(P);
  const target = Number(T);
  if (!principal || isNaN(principal) || isNaN(target) || principal <= 0) return null;
  return ((target - principal) / principal) * 100;
};

const calcMonthlyInstallment = (T, N) => {
  const target = Number(T);
  const duration = Number(N);
  if (!target || !duration || isNaN(target) || isNaN(duration) || duration <= 0) return null;
  return target / duration;
};

const deriveInterestPercentage = (project) => {
  if (project.interestPercentage != null && !isNaN(project.interestPercentage)) {
    return project.interestPercentage;
  }
  const P = project.investmentAmount;
  const T = project.returnAmount;
  if (!P || P <= 0 || T == null) return 0;
  return calcInterestPercent(P, T);
};

const calculateProjectMonthsElapsed = (startDate) => {
  const start = new Date(startDate);
  const end = new Date();
  if (start > end) return 0;

  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const endYear = end.getFullYear();
  const endMonth = end.getMonth();

  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
};

const calcProjectMetrics = (project, totalPaid = 0, monthsElapsed = null) => {
  const P = project.investmentAmount;
  const T = project.returnAmount;
  const N = project.installmentDuration;
  const I = T - P;
  const monthlyInstallment = project.monthlyInstallmentAmount ?? calcMonthlyInstallment(T, N);
  const monthlyInterest = N > 0 ? I / N : 0;
  const monthlyPrincipal = N > 0 ? P / N : 0;

  const elapsed = monthsElapsed != null ? monthsElapsed : calculateProjectMonthsElapsed(project.startDate);
  const activeMonths = Math.min(N, elapsed);
  const K = activeMonths;

  const totalPayable = P + monthlyInterest * K;
  const expectedInstallments = K * monthlyInstallment;
  
  const principalPaid = Math.min(P, totalPaid);
  const interestPaid = Math.max(0, totalPaid - P);
  const duePrincipal = Math.max(0, K * monthlyPrincipal - principalPaid);
  const dueInterest = Math.max(0, K * monthlyInterest - interestPaid);
  const totalDue = duePrincipal + dueInterest;

  const remainingBalance = Math.max(0, totalPayable - totalPaid);
  const profit = I;
  const currentProfit = Math.max(0, totalPaid - P);
  const principalRemaining = Math.max(0, P - totalPaid);
  const futureProfit = Math.max(0, totalPayable - totalPaid - principalRemaining);

  return {
    totalPaid,
    monthsElapsed: elapsed,
    activeMonths: K,
    interestAmount: I,
    monthlyInterest,
    monthlyInstallment,
    totalPayable,
    expectedInstallments,
    totalDue,
    remainingBalance,
    profit,
    currentProfit,
    futureProfit
  };
};

/**
 * Normalize financial fields for create/update.
 * @param {object} data - { investmentAmount, returnAmount, interestPercentage, installmentDuration, lastEdited }
 */
const syncProjectFinancials = (data) => {
  const P = Number(data.investmentAmount);
  const N = Number(data.installmentDuration);
  const lastEdited = data.lastEdited || 'percentage';

  if (!P || P <= 0 || !N || N <= 0) {
    throw new Error('বিনিয়োগের পরিমাণ ও কিস্তির মেয়াদ সঠিকভাবে দিন');
  }

  let R;
  let T;

  if (lastEdited === 'returnAmount' && data.returnAmount != null && data.returnAmount !== '') {
    T = Number(data.returnAmount);
    R = calcInterestPercent(P, T);
  } else if (data.interestPercentage != null && data.interestPercentage !== '') {
    R = Number(data.interestPercentage);
    T = calcReturnTarget(P, R);
  } else if (data.returnAmount != null && data.returnAmount !== '') {
    T = Number(data.returnAmount);
    R = calcInterestPercent(P, T);
  } else {
    throw new Error('মুনাফার হার বা ফেরত লক্ষ্যমাত্রা দিন');
  }

  if (T == null || R == null || isNaN(T) || isNaN(R)) {
    throw new Error('বিনিয়োগ হিসাব সঠিক নয়');
  }

  const monthlyInstallmentAmount = calcMonthlyInstallment(T, N);

  return {
    investmentAmount: P,
    interestPercentage: R,
    returnAmount: T,
    installmentDuration: N,
    monthlyInstallmentAmount
  };
};

module.exports = {
  calcReturnTarget,
  calcInterestPercent,
  calcMonthlyInstallment,
  deriveInterestPercentage,
  calculateProjectMonthsElapsed,
  calcProjectMetrics,
  syncProjectFinancials
};
