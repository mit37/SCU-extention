// Shared with tools/ingest-syllabi.js so the Options page's bulk importer
// and the maintainer CLI guess professor/course/term the same way.
const COURSE_CODE_RE = /\b([A-Z]{2,5})\s?-?\s?(\d{1,3}[A-Z]?)\b/;
const TERM_RE = /(Fall|Winter|Spring|Summer)\s+(20\d{2})/i;
// Deliberately not /i overall: the keyword is matched case-insensitively via
// explicit letter classes, but the captured name must be genuinely
// capitalized — an overall /i would make [A-Z] match lowercase too, and
// happily "detect" a professor out of any line that merely mentions the
// word "instructor" in lowercase prose.
const INSTRUCTOR_LINE_RE = /(?:[Ii]nstructor|[Pp]rofessor|[Tt]aught [Bb]y)s?\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s*$/m;

const Detect = {
  professor(text, fileName) {
    const match = text.match(INSTRUCTOR_LINE_RE);
    if (match) return match[1].trim();
    if (!fileName) return null;
    const stem = fileName.replace(/\.[^.]+$/, '');
    const words = stem.replace(/[_-]/g, ' ').split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w));
    return words.length ? words.join(' ') : null;
  },

  courseCode(text) {
    const match = text.match(COURSE_CODE_RE);
    return match ? `${match[1]} ${match[2]}` : null;
  },

  term(text) {
    const match = text.match(TERM_RE);
    return match ? `${match[1]} ${match[2]}` : null;
  },

  // Reconstructs line breaks from a pdf.js getTextContent() result — items
  // don't carry newlines, only a per-item hasEOL flag.
  textFromPdfContent(items) {
    let text = '';
    for (const item of items) {
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    return text + '\n';
  },
};

if (typeof module !== 'undefined') module.exports = Detect;
