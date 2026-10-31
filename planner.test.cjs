'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, validateProfile, money } = require('./planner.js');
const profile = overrides => ({ asOf: '2030-09-30', balance: 2800, salary: 1600, cashIncome: 250,
  monthlyExpenses: 700, carPayment: 200, motherDebt: 300, motherDue: '2030-10',
  fatherDebt: 2400, emergencyReserve: 800, goalAmount: 18000, goalDeadline: '2031-12-31',
  extraIncome: 0, newCarDate: '2033-05-01', ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('initial payment protects operating cash and the next payment; future cash is not opening cash', () => {
  const p = buildPlan(profile());
  assert.equal(p.initialFatherPayment, 1000);
  assert.equal(p.startingAfterFather, 1800);
  assert.equal(p.initialReservedForMother, 300);
  assert.equal(p.operatingReserve, 1500);
  assert.equal(p.rows[0].income, 1850);
  assert.equal(p.rows[0].cashBeforeIncome, 800);
  assert.equal(p.rows[0].fatherPayment, 1150);
  assert.equal(p.rows[0].fatherRemaining, 250);
  assert.equal(p.rows[1].fatherPayment, 250);
  assert.equal(p.fatherPaidMonth, '2030-11');
});

test('every row and the full horizon reconcile without counting saved cash twice', () => {
  const input = profile();
  const p = buildPlan(input);
  let previous = p.startingAfterPayments;
  let assigned = p.initialGoalSaved;
  for (const row of p.rows) {
    close(row.openingBalance, previous);
    close(row.totalBalance, previous + row.income - row.expenses - row.motherPayment - row.fatherPayment);
    if (row.fatherRemaining > 0) assert.equal(row.goalSaved, 0);
    else close(row.goalSaved, Math.max(0, row.totalBalance - row.operatingReserve - row.reservedForMother));
    assigned += row.goalContribution;
    previous = row.totalBalance;
  }
  close(assigned, p.goalSavedByDeadline);
  close(p.endingBalance, input.balance + p.totalIncome - p.totalExpenses - p.totalMotherPaid - p.totalFatherPaid);
  assert.equal(p.totalFatherPaid, input.fatherDebt);
  assert.equal(p.totalMotherPaid, input.motherDebt);
  assert.equal(p.monthCount, 15);
});

test('the minimum additional monthly income closes the gap, one cent less does not', () => {
  const input = profile();
  const p = buildPlan(input);
  assert.ok(p.shortfall > 0);
  assert.ok(p.extraMonthlyNeeded > 0);
  const closes = buildPlan({ ...input, extraIncome: p.extraMonthlyNeeded });
  assert.equal(closes.shortfall, 0);
  assert.equal(closes.fatherRemaining, 0);
  const almost = buildPlan({ ...input, extraIncome: Math.round((p.extraMonthlyNeeded - 0.01) * 100) / 100 });
  assert.ok(almost.shortfall > 0);
});

test('configured additional income is included only once', () => {
  const p = buildPlan(profile({ extraIncome: 150 }));
  assert.equal(p.incomeMonthly, 2000);
  assert.equal(p.rows[0].income, 2000);
  const closes = buildPlan(profile({ extraIncome: 150 + p.extraMonthlyNeeded }));
  assert.equal(closes.shortfall, 0);
});

test('insufficient operating money never triggers a payment to father or fictitious savings', () => {
  const p = buildPlan(profile({ balance: 100, salary: 0, cashIncome: 0, goalAmount: 1000 }));
  assert.equal(p.initialFatherPayment, 0);
  assert.equal(p.initialGoalSaved, 0);
  assert.ok(p.rows.every(row => row.fatherPayment === 0 && row.goalSaved === 0));
  assert.ok(p.liquidityGap > 0);
  assert.ok(p.extraMonthlyNeeded > 0);
  assert.equal(p.fatherRemaining, 2400);
});

test('future family payment is reserved one month before it is due, and paid once', () => {
  const p = buildPlan(profile({ motherDue: '2030-12' }));
  assert.equal(p.initialReservedForMother, 0);
  assert.equal(p.rows.find(row => row.month === '2030-11').reservedForMother, 300);
  assert.equal(p.rows.find(row => row.month === '2030-12').motherPayment, 300);
  assert.equal(p.rows.filter(row => row.motherPayment > 0).length, 1);
  assert.equal(p.totalMotherPaid, 300);
});

test('a current or overdue payment is deducted today and never a second time', () => {
  const p = buildPlan(profile({ motherDue: '2030-09' }));
  assert.equal(p.initialMotherPayment, 300);
  assert.equal(p.totalMotherPaid, 300);
  assert.ok(p.rows.every(row => row.motherPayment === 0));
  assert.equal(p.initialFatherPayment, 1000);
});

test('a fully funded goal needs no extra income', () => {
  const p = buildPlan(profile({ balance: 40000, fatherDebt: 0, motherDebt: 0 }));
  assert.equal(p.extraMonthlyNeeded, 0);
  assert.equal(p.shortfall, 0);
  assert.equal(p.goalCompletionMonth, '2030-09');
});

test('dates, horizon and amount validation reject malformed inputs', () => {
  for (const overrides of [
    { asOf: '2030-02-30' }, { goalDeadline: '2031-02-29' }, { goalDeadline: '2030-09-30' },
    { goalDeadline: '2080-10-01' }, { motherDue: '2030-13' }, { balance: NaN },
    { salary: Infinity }, { fatherDebt: -1 }, { cashIncome: '250' },
    { newCarDate: '2033-13-01' }, { carPayment: 701 }, { goalAmount: 1000000001 }
  ]) assert.throws(() => validateProfile(profile(overrides)), JSON.stringify(overrides));
  assert.throws(() => validateProfile(null));
  assert.doesNotThrow(() => validateProfile(profile({ asOf: '2032-02-29', goalDeadline: '2033-02-28' })));
});

test('one-month horizon, rounding to cents, zero income and large values terminate', () => {
  const p = buildPlan(profile({ goalDeadline: '2030-10-31', balance: 1234.567, salary: 0, cashIncome: 0 }));
  assert.equal(p.monthCount, 1);
  assert.equal(p.normalizedProfile.balance, 1234.57);
  assert.ok(Number.isFinite(p.extraMonthlyNeeded));
  assert.ok(buildPlan(profile({ goalAmount: 999999999, goalDeadline: '2080-09-30' })).extraMonthlyNeeded > 0);
  assert.match(money(12.34), /12,34/);
});

test('old profiles default account balances to zero; declared account balances must fit the total', () => {
  const normalized = validateProfile(profile());
  assert.equal(normalized.savingsBalance, 0);
  assert.equal(normalized.cashBalance, 0);
  for (const values of [
    { savingsBalance: -1 }, { cashBalance: -1 }, { savingsBalance: '800' },
    { savingsBalance: 2700, cashBalance: 101 }, { savingsBalance: 2801 },
    { cashBalance: Infinity }
  ]) assert.throws(() => validateProfile(profile(values)));
  assert.doesNotThrow(() => validateProfile(profile({ balance: 0.3, savingsBalance: 0.1, cashBalance: 0.2 })));
});

test('initial account allocation keeps upcoming bills in BBVA and counts the savings transfer once', () => {
  const p = buildPlan(profile());
  assert.equal(p.initialSavingsTarget, 800);
  assert.equal(p.initialSavingsTransfer, 800);
  assert.equal(p.initialOperatingTarget, 1000);
  assert.equal(p.initialAvailableForSavings, 800);
  assert.equal(p.initialBbvaBalance, 2800);
  assert.equal(p.initialSavingsBalance, 0);
  assert.equal(p.initialCashBalance, 0);
  close(p.initialSavingsTarget + p.initialOperatingTarget, p.startingAfterPayments);
  close(p.initialBbvaBalance - p.initialFatherPayment - p.initialMotherPayment - p.initialSavingsTransfer, p.initialOperatingTarget);
});

test('money already in Pibank or cash is never new income or an extra contribution', () => {
  const base = buildPlan(profile());
  const split = buildPlan(profile({ savingsBalance: 800, cashBalance: 200 }));
  assert.equal(split.initialSavingsTransfer, 0);
  assert.equal(split.initialCashToDeposit, 200);
  assert.equal(split.initialBbvaBalance, 1800);
  assert.equal(split.goalSavedByDeadline, base.goalSavedByDeadline);
  assert.equal(split.endingBalance, base.endingBalance);
  assert.equal(split.extraMonthlyNeeded, base.extraMonthlyNeeded);
  assert.equal(split.totalIncome, base.totalIncome);
  close(split.initialBbvaBalance + split.initialCashToDeposit - split.initialFatherPayment - split.initialMotherPayment - split.initialSavingsTransfer, split.initialOperatingTarget);
  assert.ok(split.accountWarnings.some(text => text.includes('efectivo')));
});

test('monthly savings transfers reconcile with account targets and do not change aggregate cash flow', () => {
  const p = buildPlan(profile());
  let previous = p.initialSavingsTarget;
  for (const row of p.rows) {
    close(row.savingsTransfer, row.savingsTarget - previous);
    close(row.savingsTarget + row.operatingTarget, row.totalBalance);
    close(row.cashToDeposit, 250);
    assert.ok(row.savingsTarget >= 0);
    assert.ok(row.savingsTarget <= Math.max(0, row.totalBalance - row.expenses - row.reservedForMother));
    previous = row.savingsTarget;
  }
  assert.equal(p.rows[0].savingsTransfer, 0);
  assert.equal(p.rows[1].savingsTransfer, 900);
  assert.equal(p.rows[0].operatingTarget, 700);
});

test('insufficient funds are not moved into savings at the expense of upcoming bills', () => {
  const p = buildPlan(profile({ balance: 100, salary: 0, cashIncome: 0, goalAmount: 1000 }));
  assert.equal(p.initialAvailableForSavings, 0);
  assert.equal(p.initialSavingsTarget, 0);
  assert.equal(p.initialSavingsTransfer, 0);
  assert.equal(p.initialOperatingTarget, 100);
  assert.ok(p.rows.every(row => row.savingsTarget === 0));
  assert.ok(p.accountWarnings.some(text => text.includes('no hay suficiente saldo')));
});

test('an overfunded savings account is rebalanced back to BBVA without changing total assets', () => {
  const p = buildPlan(profile({ savingsBalance: 1500 }));
  assert.equal(p.initialSavingsTarget, 800);
  assert.equal(p.initialSavingsTransfer, -700);
  assert.equal(p.initialBbvaBalance, 1300);
  close(p.initialBbvaBalance - p.initialFatherPayment - p.initialSavingsTransfer, p.initialOperatingTarget);
  assert.ok(p.accountWarnings.some(text => text.includes('retirar de Pibank')));
});

test('a drawdown month explicitly proposes a withdrawal instead of inventing a positive savings deposit', () => {
  const p = buildPlan(profile({ balance: 5000, fatherDebt: 0, motherDebt: 0,
    salary: 100, cashIncome: 0, goalDeadline: '2030-11-30' }));
  assert.equal(p.initialSavingsTarget, 4300);
  assert.equal(p.rows[0].savingsTransfer, -600);
  assert.equal(p.rows[1].savingsTransfer, -600);
  assert.equal(p.rows[0].savingsTarget, 3700);
  assert.equal(p.rows[1].savingsTarget, 3100);
  assert.ok(p.rows.every(row => row.operatingTarget === 700));
});
