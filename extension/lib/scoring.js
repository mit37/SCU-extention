// Turns RMP data + crowdsourced syllabi into one 0-100 "Likeness Score" and
// a confidence label, so it can be skimmed at a glance on a course page.
const Scoring = {
  WEIGHTS: {
    officialEval: 0.4, // extracted from SCU's own course evaluation reports, when available
    rating: 0.33, // avgRating (0-5) from RateMyProfessors
    wouldTakeAgain: 0.15, // wouldTakeAgainPercent (0-100)
    difficulty: 0.06, // avgDifficulty (0-5), inverted, lightly weighted
    syllabusFairness: 0.06, // derived from uploaded syllabi, see analyzeSyllabusText
  },

  // Cheap heuristic over syllabus text: looks for phrases that students
  // tend to associate with a fairer/lower-stress course. Returns 0-100.
  analyzeSyllabusText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const positives = [
      'drop the lowest', 'lowest grade dropped', 'curve', 'extra credit',
      'flexible deadline', 'no final exam', 'open book', 'open note',
      'resubmit', 'rewrite', 'late policy', 'grace period',
    ];
    const negatives = [
      'no late work', 'no makeup', 'mandatory attendance', 'pop quiz',
      'strict deadline', 'no extensions', 'cumulative final', 'participation grade',
    ];
    let score = 50;
    for (const phrase of positives) if (lower.includes(phrase)) score += 6;
    for (const phrase of negatives) if (lower.includes(phrase)) score -= 6;
    return Math.max(0, Math.min(100, score));
  },

  // Official SCU course-eval PDFs vary a lot in template, but nearly all
  // report either Likert-style "X out of 5" item scores or "X% agreed"
  // rows. We average whichever of those we can find; only if neither shows
  // up do we fall back to the same kind of phrase heuristic used for
  // syllabi, tuned to eval-report language instead of syllabus language.
  analyzeEvalText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    const fiveScaleMatches = [...lower.matchAll(/(\d(?:\.\d{1,2})?)\s*(?:\/|out of)\s*5\b/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => n >= 0 && n <= 5);
    if (fiveScaleMatches.length) {
      const avg = fiveScaleMatches.reduce((a, b) => a + b, 0) / fiveScaleMatches.length;
      return Math.round((avg / 5) * 100);
    }

    const percentMatches = [...lower.matchAll(/(\d{1,3})\s?%/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 0 && n <= 100);
    if (percentMatches.length) {
      return Math.round(percentMatches.reduce((a, b) => a + b, 0) / percentMatches.length);
    }

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
    return Math.max(0, Math.min(100, score));
  },

  // syllabusEntries: array of { analyzedScore } from analyzeSyllabusText
  // evalEntries: array of { analyzedScore } from analyzeEvalText
  computeLikenessScore({ avgRating, avgDifficulty, wouldTakeAgainPercent, numRatings }, syllabusEntries = [], evalEntries = []) {
    const hasRmp = typeof avgRating === 'number' && avgRating > 0;
    const ratingPct = hasRmp ? (avgRating / 5) * 100 : null;
    const difficultyPct = typeof avgDifficulty === 'number' && avgDifficulty > 0
      ? 100 - (avgDifficulty / 5) * 100
      : null;
    const wtaPct = typeof wouldTakeAgainPercent === 'number' && wouldTakeAgainPercent >= 0
      ? wouldTakeAgainPercent
      : null;

    const syllabusScores = syllabusEntries
      .map((s) => s.analyzedScore)
      .filter((s) => typeof s === 'number');
    const syllabusPct = syllabusScores.length
      ? syllabusScores.reduce((a, b) => a + b, 0) / syllabusScores.length
      : null;

    const evalScores = evalEntries
      .map((s) => s.analyzedScore)
      .filter((s) => typeof s === 'number');
    const evalPct = evalScores.length
      ? evalScores.reduce((a, b) => a + b, 0) / evalScores.length
      : null;

    const parts = [
      [evalPct, this.WEIGHTS.officialEval],
      [ratingPct, this.WEIGHTS.rating],
      [wtaPct, this.WEIGHTS.wouldTakeAgain],
      [difficultyPct, this.WEIGHTS.difficulty],
      [syllabusPct, this.WEIGHTS.syllabusFairness],
    ].filter(([value]) => value !== null);

    if (parts.length === 0) return { score: null, confidence: 'none' };

    const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
    const weighted = parts.reduce((sum, [value, w]) => sum + value * w, 0) / totalWeight;

    let confidence = 'low';
    if (evalScores.length > 0 && hasRmp) confidence = 'high';
    else if (evalScores.length > 0 || (hasRmp && numRatings >= 10)) confidence = 'medium';
    else if (hasRmp && numRatings >= 3) confidence = 'medium';
    else if (!hasRmp && syllabusScores.length > 0) confidence = 'low';

    return { score: Math.round(weighted), confidence };
  },
};

if (typeof module !== 'undefined') module.exports = Scoring;
