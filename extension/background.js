importScripts('lib/storage.js', 'lib/rmp.js', 'lib/scoring.js');

async function getProfessorScore(rawName) {
  const cacheKey = Rmp_normalizeKey(rawName);

  let professor = await Storage.getProfessorCache(cacheKey);
  if (!professor) {
    try {
      professor = await findProfessor(rawName);
    } catch (err) {
      professor = null;
    }
    if (professor) await Storage.setProfessorCache(cacheKey, professor);
  }

  const professorKey = professor ? Rmp_normalizeKey(professor.name) : cacheKey;
  const syllabi = await Storage.getSyllabi(professorKey);
  const { score, confidence } = Scoring.computeLikenessScore(
    professor || {},
    syllabi.map((s) => ({ analyzedScore: s.analyzedScore }))
  );

  return {
    query: rawName,
    professor,
    syllabusCount: syllabi.length,
    score,
    confidence,
  };
}

function Rmp_normalizeKey(name) {
  return normalizeName(name);
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

  if (message?.type === 'ADD_SYLLABUS') {
    (async () => {
      const professorKey = normalizeName(message.professorName);
      const analyzedScore = Scoring.analyzeSyllabusText(message.text);
      await Storage.addSyllabus(professorKey, {
        courseCode: message.courseCode || null,
        fileName: message.fileName || null,
        text: message.text?.slice(0, 20000) || '',
        analyzedScore,
        submittedBy: message.submittedBy || 'anonymous',
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});
