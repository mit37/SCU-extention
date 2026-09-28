importScripts('lib/storage.js', 'lib/rmp.js', 'lib/scoring.js');

async function getProfessorScore(rawName) {
  const queryKey = normalizeName(rawName);

  let professor = await Storage.getProfessorCache(queryKey);
  if (!professor) {
    try {
      professor = await findProfessor(rawName);
    } catch (err) {
      professor = null;
    }
    if (professor) await Storage.setProfessorCache(queryKey, professor);
  }

  // RMP's spelling can differ from the one on the course page or syllabus
  // ("Ming Wang" vs "Ming-Hwa Wang"), so read data filed under either.
  const keys = [...new Set([queryKey, professor && normalizeName(professor.name)].filter(Boolean))];
  const [syllabiLists, evalLists] = await Promise.all([
    Promise.all(keys.map((k) => Storage.getSyllabi(k))),
    Promise.all(keys.map((k) => Storage.getCourseEvals(k))),
  ]);
  const syllabi = syllabiLists.flat();
  const courseEvals = evalLists.flat();

  const { score, confidence } = Scoring.computeLikenessScore(professor || {}, syllabi, courseEvals);

  return {
    query: rawName,
    professor,
    syllabusCount: syllabi.length,
    evalCount: courseEvals.length,
    syllabusDifficulty: Scoring.summarizeSyllabusDifficulty(syllabi),
    score,
    confidence,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LOOKUP_PROFESSOR') {
    getProfessorScore(message.name)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }

  if (message?.type === 'ADD_TO_SCHEDULE') {
    (async () => {
      const schedule = await Storage.getSchedule();
      schedule.push(message.entry);
      await Storage.setSchedule(schedule);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'ADD_COURSE_EVAL') {
    (async () => {
      const professorKey = normalizeName(message.professorName);
      await Storage.addCourseEval(professorKey, {
        courseCode: message.courseCode || null,
        fileName: message.fileName || null,
        analyzedScore: message.analyzedScore,
        textSnippet: message.textSnippet?.slice(0, 2000) || '',
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'ADD_SYLLABUS') {
    (async () => {
      const professorKey = normalizeName(message.professorName);
      const analysis = Scoring.analyzeSyllabus(message.text);
      await Storage.addSyllabus(professorKey, {
        courseCode: message.courseCode || null,
        term: message.term || null,
        fileName: message.fileName || null,
        text: message.text?.slice(0, 20000) || '',
        fairnessScore: analysis ? analysis.fairness : null,
        difficultyScore: analysis ? analysis.difficulty : null,
        signals: analysis ? analysis.signals : [],
        submittedBy: message.submittedBy || 'anonymous',
      });
      sendResponse({ ok: true, analysis });
    })();
    return true;
  }

  return false;
});
