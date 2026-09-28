// Unofficial RateMyProfessors GraphQL client, scoped to Santa Clara University.
// RMP's public web client authenticates with this fixed basic-auth token
// (it's baked into their own frontend bundle, not a secret).
const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
const RMP_AUTH_HEADER = 'Basic dGVzdDp0ZXN0';
const SCU_SCHOOL_ID = btoa('School-882'); // ratemyprofessors.com/school/882

const SEARCH_QUERY = `
  query TeacherSearch($text: String!, $schoolID: ID!) {
    newSearch {
      teachers(query: { text: $text, schoolID: $schoolID }) {
        edges {
          node {
            id
            firstName
            lastName
            department
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
            legacyId
          }
        }
      }
    }
  }
`;

async function rmpGraphQL(query, variables) {
  const res = await fetch(RMP_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: RMP_AUTH_HEADER,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`RMP request failed: ${res.status}`);
  return res.json();
}

const NAME_NOISE = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx', 'phd']);

// Used both as a fuzzy-match key against RMP search results and as the
// storage key syllabi/evals/cache are filed under. "Smith,Jane" (Workday),
// "Jane Smith" (typed), "Dr. Jane Q. Smith" (syllabus header) and
// "Smith, Jane Q" must all collide: punctuation becomes a separator (else
// "Smith,Jane" collapses to "smithjane"), titles and single-letter initials
// are dropped, and tokens are sorted so last-first and first-last agree.
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_NOISE.has(t))
    .sort()
    .join(' ');
}

// Finds the best-matching professor at SCU for a given display name
// (e.g. "Smith, John" or "John Smith" or just "Smith").
async function findProfessor(rawName) {
  const searchText = rawName.replace(/,/g, ' ').trim();
  const json = await rmpGraphQL(SEARCH_QUERY, {
    text: searchText,
    schoolID: SCU_SCHOOL_ID,
  });
  const edges = json?.data?.newSearch?.teachers?.edges || [];
  if (edges.length === 0) return null;

  const target = normalizeName(searchText);
  const targetParts = target.split(/\s+/).filter(Boolean);

  let best = null;
  let bestScore = -1;
  for (const { node } of edges) {
    const full = normalizeName(`${node.firstName} ${node.lastName}`);
    const fullParts = full.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const part of targetParts) {
      if (fullParts.includes(part)) score += 1;
    }
    if (full === target) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (bestScore <= 0) return null;

  return {
    id: best.id,
    legacyId: best.legacyId,
    name: `${best.firstName} ${best.lastName}`,
    department: best.department,
    avgRating: best.avgRating,
    avgDifficulty: best.avgDifficulty,
    numRatings: best.numRatings,
    wouldTakeAgainPercent: best.wouldTakeAgainPercent,
    profileUrl: `https://www.ratemyprofessors.com/professor/${best.legacyId}`,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { findProfessor, normalizeName };
}
