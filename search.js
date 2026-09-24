(function () {
  const stopwords = new Set(['책', '도서', '추천', '해줘', '해주세요', '읽고', '싶어', '싶은', '있을까', '어떤', '하는', '위한', '요즘', '나에게', '좀']);

  function terms(value) {
    const words = String(value).toLowerCase().match(/[가-힣a-z0-9]+/g) || [];
    return words.flatMap((word) => {
      if (stopwords.has(word)) return [];
      const grams = word.length > 2 && /[가-힣]/.test(word)
        ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
        : [];
      return [word, ...grams];
    });
  }

  function fields(book) {
    const recommendations = book.recommendations.flatMap((item) => [
      item.attributionVerified === false ? '' : item.text,
      item.source.name,
      item.period,
      item.recommender
    ]);
    return [book.title, book.title, book.title, book.tags.join(' '), ...recommendations];
  }

  function buildIndex(books) {
    const docs = books.map((book) => terms(fields(book).join(' ')));
    const lengths = docs.map((doc) => doc.length);
    const averageLength = lengths.reduce((sum, length) => sum + length, 0) / (books.length || 1);
    const frequencies = new Map();
    docs.forEach((doc) => new Set(doc).forEach((term) => frequencies.set(term, (frequencies.get(term) || 0) + 1)));
    return { docs, lengths, averageLength, frequencies };
  }

  function lexicalScores(query, books, index) {
    const queryTerms = [...new Set(terms(query))];
    return books.map((book, i) => {
      const counts = new Map();
      index.docs[i].forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
      const score = queryTerms.reduce((sum, term) => {
        const frequency = counts.get(term) || 0;
        if (!frequency) return sum;
        const documentFrequency = index.frequencies.get(term) || 0;
        const idf = Math.log(1 + (books.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const denominator = frequency + 1.2 * (0.25 + 0.75 * index.lengths[i] / index.averageLength);
        return sum + idf * frequency * 2.2 / denominator;
      }, 0);
      return score + (book.title.toLowerCase().includes(query.toLowerCase().trim()) ? 8 : 0);
    });
  }

  function route(query) {
    const exact = /[《『「"']|제목|작가|서점원|재임|퇴임|평산책방 추천책|문재인의? 추천책|\d{4}년|\d{1,2}월/.test(query);
    const abstract = /기분|마음|분위기|느낌|상황|비슷|지쳤|힘들|위로|몰입|생각|고민|잔잔|따뜻|긴장/.test(query);
    return !exact && (abstract || terms(query).length > 9) ? 'hybrid' : 'bm25';
  }

  function wantsRecommendations(query, previousRecommendation = false) {
    const value = String(query).trim().toLowerCase();
    const bookNoun = /(?:^|[\s"'“‘(])책(?:$|[\s?!.,을이가은도으로들에과]|추천|목록|찾아|읽)|추천책|도서(?!관)|소설|시집|에세이|그림책|만화책|문학|독서|서점|문고|책방|재임|퇴임/.test(value);
    const book = bookNoun || /읽을|읽고 싶|읽어볼/.test(value);
    const request = /추천|골라|찾아|목록|리스트|보여|권해|읽고 싶|읽어볼|읽을 만|읽을만|읽을 책|읽을 소설|읽기 좋은|읽을 만큼|있을까|있나요|있어\?/.test(value);
    const explanation = /뭐야|무엇|무슨 뜻|설명|왜|누구|언제|어떻게|의미가/.test(value);
    if (/영화|드라마|음악|노래|맛집|식당|여행지|게임/.test(value) && !bookNoun) return false;
    if (book && request && !(explanation && !/추천해|골라|찾아|보여|목록|리스트/.test(value))) return true;
    if (!explanation && /^(?:[가-힣a-z0-9\s]{0,40})(?:소설|시집|에세이|그림책)$/.test(value)) return true;
    if (!book && /^(?:뭔가\s*)?추천(?:해줘|해주세요|해 주세요|좀| 부탁)/.test(value)) return true;
    return previousRecommendation && !explanation && /^(?:다른|비슷한|좀 더|더 |이번엔|이번에는|그중|그 가운데)/.test(value);
  }

  function matchingRecommendations(query, book, sourceNames = []) {
    const year = query.match(/(20\d{2})년/);
    const month = query.match(/(?:^|\s)(1[0-2]|0?[1-9])월/);
    const source = sourceNames.find((name) => query.includes(name));
    const bookstoreList = /평산책방\s*추천책|평산책방\s*추천\s*목록/.test(query);
    const moonList = /문재인(?:의)?\s*추천책/.test(query);
    const era = [
      { pattern: /재임\s*전/, label: '재임 전' },
      { pattern: /재임\s*중/, label: '재임 중' },
      { pattern: /퇴임\s*후/, label: '퇴임 후' }
    ].find((item) => item.pattern.test(query));
    return book.recommendations.filter((item) =>
      (!year || item.period.includes(`${year[1]}년`)) &&
      (!month || new RegExp(`(?:^|\\s)0?${Number(month[1])}월`).test(item.period)) &&
      (!source || item.source.name === source) &&
      (!bookstoreList || item.period.startsWith('평산책방 추천')) &&
      (!moonList || /^(재임 전|재임 중|퇴임 후)/.test(item.period)) &&
      (!era || item.period.includes(era.label)));
  }

  function scope(query, books) {
    const sourceNames = [...new Set(books.flatMap((book) => book.recommendations.map((item) => item.source.name)))];
    const namedSource = query.match(/[가-힣]{2,}(?:책방|문고)/)?.[0];
    if (namedSource && !sourceNames.includes(namedSource)) return [];
    return books.filter((book) => matchingRecommendations(query, book, sourceNames).length > 0);
  }

  function cosine(a, b) {
    return a.reduce((sum, value, i) => sum + value * b[i], 0);
  }

  window.BookSearch = { terms, buildIndex, lexicalScores, route, scope, matchingRecommendations, wantsRecommendations, cosine };
})();
