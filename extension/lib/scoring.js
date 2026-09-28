// Turns RMP data, official evals, and syllabi into one 0-100 "Likeness Score"
// plus a separate 0-100 syllabus-derived difficulty rating.

// Each signal nudges two independent 0-100 scores that both start at 50:
//   fairness   — higher = more lenient/forgiving policies (feeds Likeness)
//   difficulty — higher = heavier exam load, workload, and grading strictness
// Negated forms ("no curve", "no extra credit") are listed before their
// positive forms and the pair is mutually exclusive via `group`, so the
// plain phrase inside the negation can't also score.
const SYLLABUS_SIGNALS = [
  { group: 'final', label: 'no final exam', re: /\bno final exam\b|\bthere (?:is|will be) no final\b/, fairness: 6, difficulty: -6 },
  { group: 'final', label: 'cumulative final', re: /\b(?:cumulative|comprehensive) final\b|\bfinal(?: exam)? (?:is|will be) (?:cumulative|comprehensive)\b/, fairness: -4, difficulty: 6 },
  { group: 'final', label: 'final exam', re: /\bfinal exam/, fairness: 0, difficulty: 3 },
  { label: 'weekly quizzes', re: /\bweekly quiz|\bquiz(?:zes)? (?:every|each) (?:week|class)|\bdaily quiz/, fairness: -2, difficulty: 5 },
  { label: 'pop quizzes', re: /\bpop quiz|\bunannounced quiz/, fairness: -6, difficulty: 4 },
  { label: 'weekly homework', re: /\bweekly (?:homework|problem sets?|assignments?|labs?)\b|\b(?:homework|problem sets?|assignments?) (?:is |are |will be )?(?:due |assigned )?(?:every|each) week\b/, fairness: 0, difficulty: 5 },
  { label: 'major project', re: /\b(?:term|final|course|team|group|capstone) project\b/, fairness: 0, difficulty: 4 },
  { label: 'research/term paper', re: /\b(?:research|term) paper\b/, fairness: 0, difficulty: 4 },
  { label: 'reading responses', re: /\breading (?:responses?|reflections?|journals?|quizzes)\b/, fairness: 0, difficulty: 2 },
  { group: 'curve', label: 'no curve', re: /\bno curve\b|\bnot (?:be )?curved\b|\b(?:will|do|does) not curve\b/, fairness: -3, difficulty: 5 },
  { group: 'curve', label: 'curved grading', re: /(?<!learning )\bcurved?\b/, fairness: 6, difficulty: -5 },
  { label: 'lowest score dropped', re: /\bdrop(?:s|ped)? (?:the |your |one |two )?lowest\b|\blowest [a-z ]{0,25}(?:is|are|will be) dropped\b/, fairness: 6, difficulty: -4 },
  { group: 'extra', label: 'no extra credit', re: /\bno extra credit\b|\bextra credit (?:is not|will not be) (?:offered|available|given)\b/, fairness: -2, difficulty: 2 },
  { group: 'extra', label: 'extra credit available', re: /\bextra credit\b/, fairness: 4, difficulty: -3 },
  { label: 'no late work', re: /\bno late (?:work|homework|assignments?|submissions?)\b|\blate (?:work|homework|assignments?|submissions?) (?:will not|won't|is not|are not) (?:be )?accepted\b|\b(?:does|will) not accept late\b/, fairness: -6, difficulty: 4 },
  { label: 'late grace period', re: /\bgrace period\b|\blate days?\b|\bflexible deadlines?\b|\bno questions asked\b/, fairness: 6, difficulty: -2 },
  { label: 'no make-up exams', re: /\bno make-?ups?\b|\bmake-?up (?:exams?|quizzes|tests) (?:will not|won't) be (?:given|offered)\b/, fairness: -5, difficulty: 3 },
  { label: 'no extensions', re: /\bno extensions\b|\bextensions (?:will not|won't) be granted\b/, fairness: -5, difficulty: 2 },
  { label: 'strict deadlines', re: /\bstrict deadlines?\b/, fairness: -4, difficulty: 2 },
  { label: 'mandatory attendance', re: /\bmandatory attendance\b|\battendance (?:is )?(?:mandatory|required)\b/, fairness: -3, difficulty: 2 },
  { label: 'open book/notes', re: /\bopen[- ](?:book|notes?)\b/, fairness: 5, difficulty: -4 },
  { label: 'closed book', re: /\bclosed[- ](?:book|notes?)\b/, fairness: 0, difficulty: 2 },
  { label: 'resubmissions allowed', re: /\bresubmi(?:t|ssions?)\b|\brewrites? (?:are )?(?:allowed|permitted)\b/, fairness: 5, difficulty: -2 },
];

const COUNT_WORDS = { two: 2, three: 3, four: 4, 2: 2, 3: 3, 4: 4 };

function countExams(t) {
  if (/\bno midterms?\b|\bthere (?:is|will be) no midterm/.test(t)) return 0;
  let n = 0;
  const stated = t.match(/\b(two|three|four|2|3|4) (?:in-class |written )?(?:midterms?|midterm exams|exams|tests)\b/);
  if (stated) n = COUNT_WORDS[stated[1]];
  const numbered = new Set();
  for (const m of t.matchAll(/\b(?:midterm|exam|test)\s*(?:exam\s*)?#?\s*(1|2|3|4|i{1,3}|iv)\b/g)) numbered.add(m[1]);
  n = Math.max(n, numbered.size);
  if (n === 0 && /\bmidterm/.test(t)) n = 1;
  return n;
}

// Share of the grade from exams/quizzes, read from grading-breakdown lines.
// Returns null when the numbers don't add up to something plausible —
// better no signal than one built from a stray grading-scale line.
function examWeight(t) {
  let total = 0;
  for (const line of t.split('\n')) {
    if (!/\b(?:exams?|midterms?|tests?|quiz(?:zes)?)\b|\bfinal\b(?!\s+(?:letter\s+|course\s+)?grades?)/.test(line)) continue;
    if (/\b(?:homework|assignments?|projects?|participation|labs?)\b/.test(line)) continue;
    for (const m of line.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 100) total += v;
    }
  }
  if (total === 0 || total > 100) return null;
  return Math.round(total);
}

function longestPaper(t) {
  let max = 0;
  for (const line of t.split('\n')) {
    if (!/\b(?:paper|essay|report)\b/.test(line)) continue;
    for (const m of line.matchAll(/\b(\d{1,2})(?:\s*(?:-|to|–)\s*(\d{1,2}))?[- ]pages?\b/g)) {
      max = Math.max(max, parseInt(m[2] || m[1], 10));
    }
  }
  return max;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const Scoring = {
  WEIGHTS: {
    officialEval: 0.4, // extracted from SCU's own course evaluation reports, when available
    rating: 0.33, // avgRating (0-5) from RateMyProfessors
    wouldTakeAgain: 0.15, // wouldTakeAgainPercent (0-100)
    ease: 0.06, // inverted difficulty: RMP avgDifficulty and/or syllabus difficulty
    syllabusFairness: 0.06, // syllabus policy leniency, see analyzeSyllabus
  },

  // Returns { fairness, difficulty, signals } or null for empty text.
  // signals: [{ label, difficulty }] where difficulty is that signal's delta,
  // so the UI can say *why* ("2 midterms, cumulative final, no late work").
  analyzeSyllabus(text) {
    if (!text || !text.trim()) return null;
    const t = text.toLowerCase();
    let fairness = 50;
    let difficulty = 50;
    const signals = [];
    const hit = (label, f, d) => {
      fairness += f;
      difficulty += d;
      signals.push({ label, difficulty: d });
    };

    const groupsHit = new Set();
    for (const s of SYLLABUS_SIGNALS) {
      if (s.group && groupsHit.has(s.group)) continue;
      if (s.re.test(t)) {
        if (s.group) groupsHit.add(s.group);
        hit(s.label, s.fairness, s.difficulty);
      }
    }

    const exams = countExams(t);
    if (exams >= 3) hit(`${exams} midterms/exams`, -2, 10);
    else if (exams === 2) hit('2 midterms/exams', 0, 7);
    else if (exams === 1) hit('1 midterm', 0, 3);

    const weight = examWeight(t);
    if (weight !== null && weight >= 70) hit(`exams ~${weight}% of grade`, -3, 8);
    else if (weight !== null && weight >= 50) hit(`exams ~${weight}% of grade`, -1, 4);
    else if (weight !== null && weight <= 30) hit(`exams only ~${weight}% of grade`, 2, -4);

    const pages = longestPaper(t);
    if (pages >= 10) hit(`${pages}-page paper`, 0, 4);

    return { fairness: clamp(fairness), difficulty: clamp(difficulty), signals };
  },

  // Aggregates per-syllabus results for one professor into what the UI shows.
  summarizeSyllabusDifficulty(entries) {
    const scored = entries.filter((e) => typeof e.difficultyScore === 'number');
    if (!scored.length) return null;
    const counts = new Map();
    for (const e of scored) {
      for (const s of e.signals || []) {
        const key = `${s.difficulty > 0 ? '+' : '-'}${s.label}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const top = (sign) => [...counts.entries()]
      .filter(([k]) => k[0] === sign)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k.slice(1));
    return {
      score: clamp(avg(scored.map((e) => e.difficultyScore))),
      count: scored.length,
      harder: top('+'),
      easier: top('-'),
    };
  },

  // Official SCU course-eval PDFs vary in template. We prefer Likert-style
  // "X out of 5" / "X/5" item scores; failing that, percentages on summary
  // rows ("overall", "recommend", "effective"). Per-response-option
  // distribution rows ("Strongly agree 45% Agree 30% ...") are deliberately
  // not averaged — their mean is ~100/k regardless of how good the class was.
  analyzeEvalText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    const fiveScale = [...lower.matchAll(/(?<![\d/.])(\d(?:\.\d{1,2})?)\s*(?:\/\s*5(?:\.0)?|out of\s*5(?:\.0)?)(?![\d/])/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => n >= 0 && n <= 5);
    if (fiveScale.length) return clamp((avg(fiveScale) / 5) * 100);

    const summaryPercents = [];
    for (const line of lower.split('\n')) {
      if (!/\b(?:overall|recommend|effective)/.test(line)) continue;
      for (const m of line.matchAll(/(\d{1,3})\s?%/g)) {
        const v = parseInt(m[1], 10);
        if (v >= 0 && v <= 100) summaryPercents.push(v);
      }
    }
    if (summaryPercents.length) return clamp(avg(summaryPercents));

    const positives = [
      'would recommend', 'clear expectations', 'well organized', 'approachable',
      'responsive to questions', 'available during office hours', 'fair grading',
      'engaging lectures', 'cares about students',
    ];
    const negatives = [
      'disorganized', 'hard to reach', 'unclear expectations', 'unfair grading',
      'dismissive', 'rarely available', 'not responsive', 'confusing lectures',
    ];
    let score = 50;
    for (const phrase of positives) if (lower.includes(phrase)) score += 6;
    for (const phrase of negatives) if (lower.includes(phrase)) score -= 6;
    return clamp(score);
  },

  // syllabusEntries: [{ fairnessScore, difficultyScore }] from analyzeSyllabus
  // evalEntries: [{ analyzedScore }] from analyzeEvalText
  computeLikenessScore({ avgRating, avgDifficulty, wouldTakeAgainPercent, numRatings }, syllabusEntries = [], evalEntries = []) {
    const hasRmp = typeof avgRating === 'number' && avgRating > 0;
    const ratingPct = hasRmp ? (avgRating / 5) * 100 : null;
    const wtaPct = typeof wouldTakeAgainPercent === 'number' && wouldTakeAgainPercent >= 0
      ? wouldTakeAgainPercent
      : null;

    const fairnessPct = avg(syllabusEntries.map((s) => s.fairnessScore).filter((s) => typeof s === 'number'));
    const syllabusDifficulty = avg(syllabusEntries.map((s) => s.difficultyScore).filter((s) => typeof s === 'number'));
    const evalPct = avg(evalEntries.map((s) => s.analyzedScore).filter((s) => typeof s === 'number'));

    const easeParts = [];
    if (typeof avgDifficulty === 'number' && avgDifficulty > 0) easeParts.push(100 - (avgDifficulty / 5) * 100);
    if (syllabusDifficulty !== null) easeParts.push(100 - syllabusDifficulty);
    const easePct = avg(easeParts);

    const parts = [
      [evalPct, this.WEIGHTS.officialEval],
      [ratingPct, this.WEIGHTS.rating],
      [wtaPct, this.WEIGHTS.wouldTakeAgain],
      [easePct, this.WEIGHTS.ease],
      [fairnessPct, this.WEIGHTS.syllabusFairness],
    ].filter(([value]) => value !== null);

    if (parts.length === 0) return { score: null, confidence: 'none' };

    const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
    const weighted = parts.reduce((sum, [value, w]) => sum + value * w, 0) / totalWeight;

    const hasEval = evalPct !== null;
    let confidence = 'low';
    if (hasEval && hasRmp) confidence = 'high';
    else if (hasEval || (hasRmp && numRatings >= 3)) confidence = 'medium';

    return { score: Math.round(weighted), confidence };
  },
};

if (typeof module !== 'undefined') module.exports = Scoring;
