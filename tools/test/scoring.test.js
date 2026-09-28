const test = require('node:test');
const assert = require('node:assert/strict');
const Scoring = require('../../extension/lib/scoring.js');
const { HARD_SYLLABUS, EASY_SYLLABUS } = require('./helpers.js');

const labels = (r) => r.signals.map((s) => s.label);

test('hard syllabus scores hard and unfair, with reasons', () => {
  const r = Scoring.analyzeSyllabus(HARD_SYLLABUS.join('\n'));
  assert.ok(r.difficulty >= 80, `difficulty ${r.difficulty}`);
  assert.ok(r.fairness <= 35, `fairness ${r.fairness}`);
  for (const l of ['cumulative final', 'weekly homework', 'no late work', 'no make-up exams', 'no curve', 'closed book', '2 midterms/exams', 'exams ~80% of grade']) {
    assert.ok(labels(r).includes(l), `missing "${l}" in ${labels(r)}`);
  }
});

test('easy syllabus scores easy and fair', () => {
  const r = Scoring.analyzeSyllabus(EASY_SYLLABUS.join('\n'));
  assert.ok(r.difficulty <= 35, `difficulty ${r.difficulty}`);
  assert.ok(r.fairness >= 75, `fairness ${r.fairness}`);
  for (const l of ['no final exam', 'lowest score dropped', 'extra credit available', 'late grace period', 'open book/notes', 'resubmissions allowed']) {
    assert.ok(labels(r).includes(l), `missing "${l}" in ${labels(r)}`);
  }
});

test('negations do not count as the positive phrase', () => {
  const noCurve = Scoring.analyzeSyllabus('Grades are not curved.');
  assert.deepEqual(labels(noCurve), ['no curve']);
  const noEc = Scoring.analyzeSyllabus('There is no extra credit in this course.');
  assert.deepEqual(labels(noEc), ['no extra credit']);
  const noFinal = Scoring.analyzeSyllabus('There is no final exam.');
  assert.deepEqual(labels(noFinal), ['no final exam']);
});

test('false positives that used to score', () => {
  assert.deepEqual(labels(Scoring.analyzeSyllabus('Expect a steep learning curve.')), []);
  assert.deepEqual(labels(Scoring.analyzeSyllabus('There is no midterm.')), []);
  const lateHeading = Scoring.analyzeSyllabus('Late Policy\nSee Camino for details.');
  assert.equal(lateHeading.fairness, 50);
  assert.equal(lateHeading.difficulty, 50);
});

test('exam count: stated, numbered, and roman numerals', () => {
  assert.ok(labels(Scoring.analyzeSyllabus('There will be three midterms.')).includes('3 midterms/exams'));
  assert.ok(labels(Scoring.analyzeSyllabus('Exam 1\nExam 2\nExam 3\n')).includes('3 midterms/exams'));
  assert.ok(labels(Scoring.analyzeSyllabus('Midterm I and Midterm II')).includes('2 midterms/exams'));
  assert.ok(labels(Scoring.analyzeSyllabus('One midterm in week 5.')).includes('1 midterm'));
});

test('exam weight ignores the letter-grade scale and implausible totals', () => {
  const scaleOnly = Scoring.analyzeSyllabus('Final grade: A 93%, B 83%, C 73%\n');
  assert.ok(!labels(scaleOnly).some((l) => l.startsWith('exams')));
  const light = Scoring.analyzeSyllabus('Quizzes: 10%\nFinal exam: 15%\nProject work 75%\n');
  assert.ok(labels(light).includes('exams only ~25% of grade'), labels(light).join());
  const noisy = Scoring.analyzeSyllabus('Exam 60%\nExam 60%\n');
  assert.ok(!labels(noisy).some((l) => l.startsWith('exams')));
});

test('long paper requirement', () => {
  assert.ok(labels(Scoring.analyzeSyllabus('Final research paper, 12-15 pages.')).includes('15-page paper'));
  assert.ok(!labels(Scoring.analyzeSyllabus('Read pages 12-15 of chapter 2.')).some((l) => l.endsWith('page paper')));
});

test('empty text returns null', () => {
  assert.equal(Scoring.analyzeSyllabus(''), null);
  assert.equal(Scoring.analyzeSyllabus('   \n'), null);
});

test('summarizeSyllabusDifficulty averages and ranks reasons', () => {
  const a = Scoring.analyzeSyllabus(HARD_SYLLABUS.join('\n'));
  const b = Scoring.analyzeSyllabus(EASY_SYLLABUS.join('\n'));
  const entries = [
    { difficultyScore: a.difficulty, signals: a.signals },
    { difficultyScore: b.difficulty, signals: b.signals },
    { fairnessScore: 50 },
  ];
  const s = Scoring.summarizeSyllabusDifficulty(entries);
  assert.equal(s.count, 2);
  assert.equal(s.score, Math.round((a.difficulty + b.difficulty) / 2));
  assert.equal(s.harder.length, 3);
  assert.equal(s.easier.length, 3);
  assert.equal(Scoring.summarizeSyllabusDifficulty([]), null);
});

test('eval: Likert scores, ignoring dates', () => {
  assert.equal(Scoring.analyzeEvalText('Overall rating: 4.5 out of 5\nClarity 4.0/5\n'), 85);
  assert.equal(Scoring.analyzeEvalText('Survey closed 3/5/2024. Instructor effectiveness: 4.0 / 5.0'), 80);
});

test('eval: distribution rows are not averaged, summary rows are', () => {
  const dist = 'Strongly agree 45%\nAgree 30%\nNeutral 15%\nDisagree 10%\n';
  assert.equal(Scoring.analyzeEvalText(dist), 50);
  assert.equal(Scoring.analyzeEvalText(`${dist}Overall, 88% would recommend this instructor.\n`), 88);
});

test('likeness: renormalizes over present signals', () => {
  assert.deepEqual(Scoring.computeLikenessScore({}, [], []), { score: null, confidence: 'none' });
  const evalOnly = Scoring.computeLikenessScore({}, [], [{ analyzedScore: 90 }]);
  assert.equal(evalOnly.score, 90);
  assert.equal(evalOnly.confidence, 'medium');
  const rmp = { avgRating: 4, avgDifficulty: 2.5, wouldTakeAgainPercent: 80, numRatings: 12 };
  const both = Scoring.computeLikenessScore(rmp, [], [{ analyzedScore: 90 }]);
  assert.equal(both.confidence, 'high');
});

test('likeness: syllabus difficulty feeds the ease component', () => {
  const rmp = { avgRating: 4, avgDifficulty: 2.5, wouldTakeAgainPercent: 80, numRatings: 12 };
  const easy = Scoring.computeLikenessScore(rmp, [{ fairnessScore: 50, difficultyScore: 10 }], []);
  const hard = Scoring.computeLikenessScore(rmp, [{ fairnessScore: 50, difficultyScore: 90 }], []);
  assert.ok(easy.score > hard.score, `${easy.score} vs ${hard.score}`);
});
