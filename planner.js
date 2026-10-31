/* Pure monthly cash-flow planner. All calculations use integer euro cents. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FinancialPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_AMOUNT = 1000000000;
  const MONEY_FIELDS = ['balance', 'salary', 'cashIncome', 'monthlyExpenses', 'carPayment', 'motherDebt', 'fatherDebt', 'emergencyReserve', 'goalAmount', 'extraIncome', 'savingsBalance', 'cashBalance'];
  const euro = cents => cents / 100;
  const cents = amount => Math.round((amount + Number.EPSILON) * 100);
  function money(amount) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  }
  function monthIndex(value) {
    const [year, month] = value.slice(0, 7).split('-').map(Number);
    return year * 12 + month - 1;
  }
  function monthName(index) {
    return String(Math.floor(index / 12)).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
  }
  function validateProfile(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('El perfil financiero no es válido.');
    if (!validDate(input.asOf)) throw new Error('La fecha inicial no es válida.');
    if (!validDate(input.goalDeadline)) throw new Error('La fecha límite no es válida.');
    const count = monthIndex(input.goalDeadline) - monthIndex(input.asOf);
    if (count < 1 || count > 600) throw new Error('El plazo debe abarcar entre 1 y 600 meses futuros.');
    const profile = { asOf: input.asOf, goalDeadline: input.goalDeadline };
    for (const field of MONEY_FIELDS) {
      const value = input[field] === undefined && ['cashIncome', 'carPayment', 'motherDebt', 'fatherDebt', 'emergencyReserve', 'extraIncome', 'savingsBalance', 'cashBalance'].includes(field) ? 0 : input[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw new Error('Importe no válido: ' + field + '.');
      profile[field] = euro(cents(value));
    }
    if (cents(profile.savingsBalance) + cents(profile.cashBalance) > cents(profile.balance)) throw new Error('Los saldos de Pibank y efectivo ya forman parte del saldo total; su suma no puede superarlo.');
    if (profile.carPayment > profile.monthlyExpenses) throw new Error('El presupuesto de gastos debe incluir la cuota del coche.');
    if (profile.motherDebt > 0 && !validMonth(input.motherDue)) throw new Error('Indica el mes del pago familiar pendiente.');
    profile.motherDue = validMonth(input.motherDue) ? input.motherDue : monthName(monthIndex(input.asOf) + 1);
    if (input.newCarDate !== undefined && input.newCarDate !== null && input.newCarDate !== '' && !validDate(input.newCarDate)) throw new Error('La fecha del próximo coche no es válida.');
    profile.newCarDate = input.newCarDate || null;
    return profile;
  }
  function run(profile, additionalMonthlyCents, includeRows) {
    const p = Object.fromEntries(MONEY_FIELDS.map(field => [field, cents(profile[field])]));
    const start = monthIndex(profile.asOf), end = monthIndex(profile.goalDeadline);
    const motherDue = monthIndex(profile.motherDue);
    const income = p.salary + p.cashIncome + p.extraIncome + additionalMonthlyCents;
    const reserve = p.emergencyReserve + p.monthlyExpenses;
    let balance = p.balance, fatherRemaining = p.fatherDebt, motherRemaining = p.motherDebt;
    const initialMotherPayment = motherDue <= start ? motherRemaining : 0;
    balance -= initialMotherPayment;
    motherRemaining -= initialMotherPayment;
    const upcomingMother = month => motherRemaining > 0 && motherDue === month + 1 ? motherRemaining : 0;
    const initialReservedForMother = upcomingMother(start);
    const initialFatherPayment = Math.min(fatherRemaining, Math.max(0, balance - reserve - initialReservedForMother));
    balance -= initialFatherPayment;
    fatherRemaining -= initialFatherPayment;
    const startingAfterPayments = balance;
    let goalSaved = fatherRemaining === 0 ? Math.max(0, balance - reserve - initialReservedForMother) : 0;
    const initialGoalSaved = goalSaved;
    // Account transfers only move money already included in balance. Reserve the
    // next month's operating expenses before assigning the available cash to savings.
    const availableForSavings = (total, reservedMother) => Math.max(0, total - p.monthlyExpenses - reservedMother);
    const savingsTargetFor = (total, savedGoal, reservedMother) => Math.min(
      p.emergencyReserve + savedGoal, availableForSavings(total, reservedMother));
    const initialAvailableForSavings = availableForSavings(balance, initialReservedForMother);
    const initialSavingsTarget = savingsTargetFor(balance, goalSaved, initialReservedForMother);
    const initialSavingsTransfer = initialSavingsTarget - p.savingsBalance;
    const initialOperatingTarget = balance - initialSavingsTarget;
    let previousSavingsTarget = initialSavingsTarget;

    let fatherPaidMonth = fatherRemaining === 0 ? profile.asOf.slice(0, 7) : null;
    let goalCompletionMonth = goalSaved >= p.goalAmount ? profile.asOf.slice(0, 7) : null;
    let totalMotherPaid = initialMotherPayment, totalFatherPaid = initialFatherPayment;
    let minimumCashBeforeIncome = balance, minimumBalance = balance;
    const rows = [];
    for (let month = start + 1; month <= end; month += 1) {
      const openingBalance = balance;
      const motherPayment = motherDue === month ? motherRemaining : 0;
      motherRemaining -= motherPayment;
      const cashBeforeIncome = balance - p.monthlyExpenses - motherPayment;
      minimumCashBeforeIncome = Math.min(minimumCashBeforeIncome, cashBeforeIncome);
      balance = cashBeforeIncome + income;
      const reservedForMother = upcomingMother(month);
      const fatherPayment = Math.min(fatherRemaining, Math.max(0, balance - reserve - reservedForMother));
      fatherRemaining -= fatherPayment;
      balance -= fatherPayment;
      if (fatherRemaining === 0 && fatherPaidMonth === null) fatherPaidMonth = monthName(month);
      const nextGoalSaved = fatherRemaining === 0 ? Math.max(0, balance - reserve - reservedForMother) : 0;
      const goalContribution = nextGoalSaved - goalSaved;
      goalSaved = nextGoalSaved;
      if (goalSaved >= p.goalAmount && goalCompletionMonth === null) goalCompletionMonth = monthName(month);
      const savingsTarget = savingsTargetFor(balance, goalSaved, reservedForMother);
      const savingsTransfer = savingsTarget - previousSavingsTarget;
      previousSavingsTarget = savingsTarget;
      const operatingTarget = balance - savingsTarget;
      minimumBalance = Math.min(minimumBalance, balance);
      totalMotherPaid += motherPayment;
      totalFatherPaid += fatherPayment;
      if (includeRows) rows.push({
        month: monthName(month), openingBalance: euro(openingBalance), income: euro(income),
        expenses: euro(p.monthlyExpenses), motherPayment: euro(motherPayment), fatherPayment: euro(fatherPayment),
        fatherRemaining: euro(fatherRemaining), motherRemaining: euro(motherRemaining),
        goalContribution: euro(goalContribution), goalSaved: euro(goalSaved), totalBalance: euro(balance),
        operatingReserve: euro(reserve), reservedForMother: euro(reservedForMother),
        savingsTarget: euro(savingsTarget), savingsTransfer: euro(savingsTransfer),
        operatingTarget: euro(operatingTarget), cashToDeposit: euro(p.cashIncome),
        cashBeforeIncome: euro(cashBeforeIncome),
        reserveGap: euro(Math.max(0, reserve + reservedForMother - balance)),
        goalShortfall: euro(Math.max(0, p.goalAmount - goalSaved))
      });
    }
    return {
      rows, initialFatherPayment: euro(initialFatherPayment), initialMotherPayment: euro(initialMotherPayment),
      initialReservedForMother: euro(initialReservedForMother), initialGoalSaved: euro(initialGoalSaved),
      initialSavingsTarget: euro(initialSavingsTarget), initialSavingsTransfer: euro(initialSavingsTransfer),
      initialAvailableForSavings: euro(initialAvailableForSavings), initialOperatingTarget: euro(initialOperatingTarget),
      initialBbvaBalance: euro(p.balance - p.savingsBalance - p.cashBalance),
      initialSavingsBalance: euro(p.savingsBalance), initialCashBalance: euro(p.cashBalance),
      initialCashToDeposit: euro(p.cashBalance),
      startingAfterFather: euro(startingAfterPayments), startingAfterPayments: euro(startingAfterPayments),
      firstMonth: monthName(start + 1), lastMonth: monthName(end), monthCount: end - start,
      incomeMonthly: euro(income), operatingReserve: euro(reserve), fatherPaidMonth, goalCompletionMonth,
      goalSavedByDeadline: euro(goalSaved), shortfall: euro(Math.max(0, p.goalAmount - goalSaved)),
      fatherRemaining: euro(fatherRemaining), motherRemaining: euro(motherRemaining), endingBalance: euro(balance),
      totalIncome: euro(income * (end - start)), totalExpenses: euro(p.monthlyExpenses * (end - start)),
      totalFatherPaid: euro(totalFatherPaid), totalMotherPaid: euro(totalMotherPaid),
      minimumCashBeforeIncome: euro(minimumCashBeforeIncome), minimumBalance: euro(minimumBalance),
      liquidityGap: euro(Math.max(0, -minimumCashBeforeIncome)),
      _complete: goalSaved >= p.goalAmount && fatherRemaining === 0 && balance >= reserve + upcomingMother(end)
    };
  }
  function buildPlan(input) {
    const profile = validateProfile(input);
    const result = run(profile, 0, true);
    let extraMonthlyNeeded = 0;
    if (!result._complete) {
      let low = 0;
      let high = Math.max(1, Math.ceil((cents(result.shortfall) + cents(result.fatherRemaining)) / result.monthCount));
      let trials = 0;
      while (!run(profile, high, false)._complete) {
        high *= 2;
        trials += 1;
        if (trials > 60 || !Number.isSafeInteger(high)) throw new Error('No se pudo calcular una aportación segura para este perfil.');
      }
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (run(profile, mid, false)._complete) high = mid;
        else low = mid + 1;
      }
      extraMonthlyNeeded = euro(low);
    }
    const warnings = ['La previsión incluye el ingreso del mes de la fecha límite: debe cobrarse antes de hacer el pago.',
      'No se presupone rentabilidad: las cifras no incluyen intereses, impuestos, comisiones ni variaciones de gastos.',
      'La caja operativa incluye el colchón de emergencia y un mes de gastos hasta el próximo cobro.'];
    if (result.minimumCashBeforeIncome < profile.emergencyReserve) warnings.push('En algún momento, antes de cobrar, el saldo podría quedar por debajo del colchón. Revisa las fechas reales de cobros y pagos.');
    if (result.liquidityGap > 0) warnings.push('Falta liquidez antes de algún cobro. Un ingreso mensual previsto no garantiza poder pagar antes de recibirlo.');
    if (profile.motherDebt > 0 && monthIndex(profile.motherDue) > monthIndex(profile.goalDeadline) + 1) warnings.push('Hay una deuda familiar con vencimiento posterior al horizonte; sigue pendiente fuera de esta previsión.');
    const accountWarnings = [];
    if (profile.cashBalance > 0) accountWarnings.push('El saldo inicial en efectivo ya está incluido en el total. Para ejecutar el reparto bancario previsto, ingrésalo en BBVA o adapta los pagos que harás en efectivo; no vuelvas a sumarlo como ingreso.');
    if (profile.cashIncome > 0) accountWarnings.push('El plan cuenta con ingresar en BBVA el efectivo mensual para realizar las transferencias previstas a Pibank y los pagos familiares. Comprueba antes que el dinero haya sido recibido y esté disponible.');
    if (result.initialSavingsTarget < profile.emergencyReserve + result.initialGoalSaved || result.rows.some(row => row.savingsTarget < profile.emergencyReserve + row.goalSaved)) accountWarnings.push('En algún momento no hay suficiente saldo para completar el objetivo de Pibank tras reservar los próximos gastos. No transfieras dinero necesario para recibos ni cubras el hueco contando el mismo saldo dos veces.');
    if (result.initialSavingsTransfer < 0 || result.rows.some(row => row.savingsTransfer < 0)) accountWarnings.push('Las transferencias negativas indican retirar de Pibank a BBVA para cubrir pagos: confirma el plazo real de retirada antes de necesitar el dinero.');
    delete result._complete;
    return { ...result, accountWarnings, months: result.rows, normalizedProfile: profile, extraMonthlyNeeded, warnings };
  }
  return Object.freeze({ validateProfile, buildPlan, money });
});
