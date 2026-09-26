// Turns RMP data + crowdsourced syllabi into one 0-100 "Likeness Score" and
// a confidence label, so it can be skimmed at a glance on a course page.
const Scoring = {
  WEIGHTS: {
    rating: 0.55, // avgRating (0-5), the strongest signal of "students liked them"
    wouldTakeAgain: 0.25, // wouldTakeAgainPercent (0-100)
    difficulty: 0.1, // avgDifficulty (0-5), inverted, lightly weighted
    syllabusFairness: 0.1, // derived from uploaded syllabi, see analyzeSyllabusText
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

  // syllabusEntries: array of { analyzedScore } from analyzeSyllabusText
  computeLikenessScore({ avgRating, avgDifficulty, wouldTakeAgainPercent, numRatings }, syllabusEntries = []) {
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

    const parts = [
      [ratingPct, this.WEIGHTS.rating],
      [wtaPct, this.WEIGHTS.wouldTakeAgain],
      [difficultyPct, this.WEIGHTS.difficulty],
      [syllabusPct, this.WEIGHTS.syllabusFairness],
    ].filter(([value]) => value !== null);

    if (parts.length === 0) return { score: null, confidence: 'none' };

    const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
    const weighted = parts.reduce((sum, [value, w]) => sum + value * w, 0) / totalWeight;

    let confidence = 'low';
    if (hasRmp && numRatings >= 10) confidence = 'high';
    else if (hasRmp && numRatings >= 3) confidence = 'medium';
    else if (!hasRmp && syllabusScores.length > 0) confidence = 'low';

    return { score: Math.round(weighted), confidence };
  },
};

if (typeof module !== 'undefined') module.exports = Scoring;
