// Shared by the Options page bulk importer, the content script, and
// tools/ingest-syllabi.js so all three guess professor/course/term the same way.

const SCU_PREFIXES = [
  'ACTG', 'AMTH', 'ANTH', 'ARAB', 'ARTH', 'ARTS', 'ASCI', 'BIOE', 'BIOL', 'BUSN',
  'CENG', 'CHEM', 'CHIN', 'CHST', 'CLAS', 'COEN', 'COMM', 'CPSY', 'CSCI', 'CSEN',
  'CTW', 'DANC', 'ECEN', 'ECON', 'EDUC', 'ELEN', 'ELSJ', 'EMGT', 'ENGL', 'ENGR',
  'ENVS', 'ETHN', 'FNCE', 'FREN', 'GERM', 'GREK', 'HIST', 'HNRS', 'ITAL', 'JAPN',
  'JST', 'LATN', 'LAW', 'LEAD', 'MATH', 'MECH', 'MGMT', 'MKTG', 'MSIS', 'MUSC',
  'NEUR', 'OMIS', 'PHIL', 'PHSC', 'PHYS', 'POLI', 'PSYC', 'RSOC', 'SCTR', 'SOCI',
  'SPAN', 'TESP', 'THTR', 'UNIV', 'WGST',
];
// Restricted to real SCU subject prefixes: a generic [A-Z]{2,5}\s\d+ pattern
// matches "AM 10", "HW 3", "ROOM 204" and similar noise long before the
// actual course code in most syllabi.
const COURSE_CODE_RE = new RegExp(`\\b(${SCU_PREFIXES.join('|')})\\s?-?\\s?(\\d{1,3}[A-Z]?)\\b`);
const TERM_RE = /\b(Fall|Winter|Spring|Summer)(?:\s+(?:Quarter|Semester|Term|Session))?[\s,]+((?:19|20)\d{2})\b/i;

const INSTRUCTOR_KEYWORD_RE = /(?:^|[^A-Za-z])(?:instructors?|professors?|lecturers?|taught by|faculty)(?:\s+name)?\s*[:\-–]?[ \t]*([^\n]*)/gi;
const NAME_CUTOFF_RE = /\s*(?:[(@,;|<–\t]|\s-\s|\s{2,}|\b(?:Office|Email|E-mail|Phone|Tel|Hours|Room|Class|Section|Time|Location|Website|Web)\b).*/;
const TITLES = new Set(['dr', 'dr.', 'prof', 'prof.', 'professor', 'mr.', 'ms.', 'mrs.', 'mx.', 'mr', 'ms', 'mrs']);
const CREDENTIALS = /^(?:ph\.?d\.?|m\.?s\.?|m\.?a\.?|mba|j\.?d\.?|esq\.?)$/i;
const NON_NAME_WORDS = new Set([
  'office', 'email', 'hours', 'syllabus', 'course', 'name', 'tba', 'tbd', 'staff',
  'information', 'contact', 'department', 'will', 'the', 'and', 'of', 'for',
]);
const NAME_TOKEN_RE = /^[A-Z][A-Za-z'’-]*\.?$/;

function cleanName(raw) {
  const cut = raw.replace(NAME_CUTOFF_RE, '').trim();
  const tokens = cut.split(/\s+/).filter(Boolean);
  while (tokens.length && TITLES.has(tokens[0].toLowerCase())) tokens.shift();

  const name = [];
  for (const tok of tokens) {
    if (CREDENTIALS.test(tok)) break;
    if (!NAME_TOKEN_RE.test(tok)) break;
    if (NON_NAME_WORDS.has(tok.toLowerCase().replace(/\.$/, ''))) break;
    name.push(tok);
    if (name.length === 4) break;
  }
  const substantial = name.filter((t) => t.replace(/\.$/, '').length >= 2);
  return substantial.length >= 2 ? name.join(' ') : null;
}

const Detect = {
  professor(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const match of text.matchAll(INSTRUCTOR_KEYWORD_RE)) {
      let rest = match[1].trim();
      if (!rest) {
        // "Instructor:" alone on its line, name on the next non-empty line.
        const lineIdx = text.slice(0, match.index + match[0].length).split('\n').length - 1;
        rest = (lines.slice(lineIdx + 1).find((l) => l.trim()) || '').trim();
      }
      const name = cleanName(rest);
      if (name) return name;
    }
    return null;
  },

  courseCode(text) {
    const match = text && text.match(COURSE_CODE_RE);
    return match ? `${match[1]} ${match[2]}` : null;
  },

  term(text) {
    const match = text && text.match(TERM_RE);
    if (!match) return null;
    const season = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    return `${season} ${match[2]}`;
  },

  // pdf.js getTextContent() items carry no newlines, only a per-item hasEOL flag.
  textFromPdfContent(items) {
    let text = '';
    for (const item of items) {
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    return text + '\n';
  },
};

if (typeof module !== 'undefined') module.exports = Detect;
