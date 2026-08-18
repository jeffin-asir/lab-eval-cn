/**
 * Shared helpers for the teacher "Student Performances" feature.
 *
 * Turns a raw EvaluationRun (produced by runAndEvaluate in sshController.js)
 * into the flattened, spreadsheet-friendly shape:
 *   Question | TC1..TCn | Persistence | Listen | Established | Closed
 *
 * Conventions (inferred from the evaluation_framework CSV formats — see
 * evaluationHelper.js parseEvaluatedCsv / parseConnCsv / parseStatusCsv):
 *  - A testcase may contain multiple communication-pair verdicts. They keep
 *    their testcase label (TC1, TC1, TC1, then TC2...) in the CSV/UI rather
 *    than being renumbered as separate testcases.
 *  - Persistence shows the raw descriptor from status.csv column 3
 *    (e.g. "non-persistent"), not a Correct/Wrong verdict.
 *  - Connection-state columns are emitted only when the selected class has
 *    that check in at least one result.
 */

const CONN_LABELS = ['Listen', 'Established', 'Closed'];

/** Pick the best available run for a (userId, questionId) pair: prefer the
 * latest "submit", fall back to the latest run of any type. */
export function pickBestRun(runsForPair = []) {
  if (!runsForPair.length) return null;
  const submit = runsForPair.find((r) => r.runType === 'submit');
  return submit || runsForPair[0]; // runsForPair assumed sorted by createdAt desc
}

/** Flatten a run's communicationResults into a simple ['Correct'|'Wrong', ...] list. */
/** Group a run's communicationResults per testcase: [{ verdicts: [...] }, ...] */
export function getTcGroups(run) {
  return (run?.communicationResults || []).map((tc) => ({
    verdicts: (tc.pairs || []).map((p) => (p.verdict === 'correct' ? 'Correct' : 'Wrong')),
  }));
}

/** Back-compat flat list (all pairs across all testcases, in order). */
export function flattenTcVerdicts(run) {
  return getTcGroups(run).flatMap((g) => g.verdicts);
}

/**
 * Persistence: the raw 'persistent'/'non-persistent' descriptor when the
 * check passed; 'Wrong' if it failed (descriptor doesn't matter once wrong);
 * '' if nothing to report.
 */
export function getPersistence(run) {
  const rows = run?.statusResults || [];
  if (!rows.length) return '';
  if (rows.some((r) => !r.passed)) return 'Wrong';
  const descriptors = [...new Set(rows.map((r) => r.descriptor).filter(Boolean))];
  return descriptors.join('/');
}

/**
 * { Listen, Established, Closed } -> 'Correct' | 'Wrong' | ''
 * 'listen'/'established' rows determine Listen/Established; 'no' rows
 * (from a server or client entity) determine Closed. Any wrong row makes
 * the field Wrong; else Correct if at least one row was seen; else blank.
 */
export function getConnVerdicts(run) {
  const rows = run?.connResults || [];
  const buckets = { Listen: [], Established: [], Closed: [] };

  for (const row of rows) {
    const check = (row.check ?? row.peer ?? '').toLowerCase();
    const isPass = row.passed ?? row.verdict === 'correct';
    if (check === 'listen') buckets.Listen.push(isPass);
    else if (check === 'established') buckets.Established.push(isPass);
    else if (check === 'no') buckets.Closed.push(isPass);
  }

  const out = {};
  for (const label of CONN_LABELS) {
    const seen = buckets[label];
    out[label] = seen.length === 0 ? '' : seen.every(Boolean) ? 'Correct' : 'Wrong';
  }
  return out;
}

/**
 * Build the full per-question report block for one student.
 * `question` may be a lean Question/CNQuestion doc; `run` is the chosen
 * EvaluationRun (or null/undefined if the student never attempted it).
 */
export function buildQuestionReport(question, run) {
  const conn = getConnVerdicts(run);
  return {
    questionId: question._id?.toString?.() ?? String(question._id ?? question.questionId ?? ''),
    questionKey: question.questionKey || run?.questionKey || '',
    title: question.title || '',
    attempted: !!run,
    runType: run?.runType || null,
    submittedAt: run?.createdAt || null,
    tcGroups: getTcGroups(run),
    tcVerdicts: flattenTcVerdicts(run),
    persistence: getPersistence(run),
    ...conn, // Listen / Established / Closed
  };
}

/**
 * A question counts as "fully correct" only if the student attempted it and
 * every check that ran (testcases, persistence, connection state) passed.
 * Used to summarize class-wide progress (how many questions each student has
 * fully solved) for the teacher-facing class report status boxes, without
 * re-deriving pass/fail logic on the client.
 */
export function isFullyCorrect(report) {
  if (!report?.attempted) return false;
  if (report.tcVerdicts.length && report.tcVerdicts.some((v) => v !== 'Correct')) return false;
  if (report.persistence === 'Wrong') return false;
  if (CONN_LABELS.some((label) => report[label] === 'Wrong')) return false;
  return true;
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export { CONN_LABELS };
