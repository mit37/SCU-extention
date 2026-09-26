const Storage = {
  async get(key, fallback) {
    const result = await chrome.storage.local.get(key);
    return key in result ? result[key] : fallback;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async getSync(key, fallback) {
    const result = await chrome.storage.sync.get(key);
    return key in result ? result[key] : fallback;
  },
  async setSync(key, value) {
    await chrome.storage.sync.set({ [key]: value });
  },

  async getProfessorCache(cacheKey) {
    const cache = await this.get('rmpCache', {});
    const entry = cache[cacheKey];
    if (!entry) return null;
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - entry.fetchedAt > ONE_WEEK) return null;
    return entry.data;
  },
  async setProfessorCache(cacheKey, data) {
    const cache = await this.get('rmpCache', {});
    cache[cacheKey] = { data, fetchedAt: Date.now() };
    await this.set('rmpCache', cache);
  },

  async getSyllabi(professorKey) {
    const all = await this.get('syllabi', {});
    return all[professorKey] || [];
  },
  async addSyllabus(professorKey, syllabus) {
    const all = await this.get('syllabi', {});
    all[professorKey] = all[professorKey] || [];
    all[professorKey].push({ ...syllabus, addedAt: Date.now() });
    await this.set('syllabi', all);
  },

  async getCourseEvals(professorKey) {
    const all = await this.get('courseEvals', {});
    return all[professorKey] || [];
  },
  async addCourseEval(professorKey, evalRecord) {
    const all = await this.get('courseEvals', {});
    all[professorKey] = all[professorKey] || [];
    all[professorKey].push({ ...evalRecord, addedAt: Date.now() });
    await this.set('courseEvals', all);
  },

  async getSchedule() {
    return this.getSync('mySchedule', []);
  },
  async setSchedule(schedule) {
    await this.setSync('mySchedule', schedule);
  },

  async getFriends() {
    return this.getSync('friends', []);
  },
  async setFriends(friends) {
    await this.setSync('friends', friends);
  },
};

if (typeof module !== 'undefined') module.exports = Storage;
