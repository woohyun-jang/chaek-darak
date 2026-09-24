(function () {
  const books = window.BOOKS || [];
  const search = window.BookSearch;
  const index = search.buildIndex(books);
  const conversation = document.getElementById('conversation');
  const scrollArea = document.getElementById('scroll-area');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('message');
  const send = document.getElementById('send');
  const modelStatus = document.getElementById('model-status');
  const history = [];
  const sourceNames = [...new Set(books.flatMap((book) => book.recommendations.map((item) => item.source.name)))]
    .sort((a, b) => (a === '평산책방' ? -1 : b === '평산책방' ? 1 : 0));
  const modelId = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
  let enginePromise;
  let embedderPromise;
  let passageVectorsPromise;
  let busy = false;
  let lastTurnWasRecommendation = false;
  let lastRecommendedBooks = [];

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function inCollection(recommendation, collection) {
    if (recommendation.source.name !== collection.source) return false;
    if (collection.kind === 'month') {
      const month = recommendation.period.match(/^(20\d{2})년 (1[0-2]|0?[1-9])월(?: \d{1,2}일)?$/);
      return Boolean(month) && `${month[1]}년 ${Number(month[2])}월` === collection.period;
    }
    return recommendation.period === collection.period || recommendation.period.startsWith(`${collection.period} · `);
  }

  function renderNavigation() {
    const navigation = document.getElementById('source-navigation');
    const recommendations = books.flatMap((book) => book.recommendations);
    const heading = element('div', 'section-label');
    heading.append(element('span', '', '추천 목록'), element('span', '', `${books.length}권 · ${recommendations.length}건`));
    navigation.append(heading);

    sourceNames.forEach((source) => {
      const entries = recommendations.filter((item) => item.source.name === source);
      const group = element('details', 'source-group');
      group.open = true;
      const summary = element('summary', 'source-summary');
      summary.append(element('span', '', source), element('small', '', `${entries.length}건`));
      group.append(summary);

      const years = new Map();
      const categories = new Map();
      entries.forEach((item) => {
        const month = item.period.match(/^(20\d{2})년 (1[0-2]|0?[1-9])월(?: \d{1,2}일)?$/);
        if (month) {
          const year = Number(month[1]);
          const period = `${year}년 ${Number(month[2])}월`;
          if (!years.has(year)) years.set(year, new Map());
          years.get(year).set(period, (years.get(year).get(period) || 0) + 1);
        } else {
          const period = item.period.split(' · ')[0];
          categories.set(period, (categories.get(period) || 0) + 1);
        }
      });

      function addButton(parent, label, count, period, kind, prompt) {
        const button = element('button', 'archive');
        button.type = 'button';
        button.dataset.source = source;
        button.dataset.period = period;
        button.dataset.kind = kind;
        button.dataset.prompt = prompt;
        button.append(element('span', 'archive-dot'), element('span', 'archive-name', label), element('small', 'archive-count', `${count}건`));
        parent.append(button);
      }

      [...years].sort((a, b) => b[0] - a[0]).forEach(([year, months]) => {
        const yearGroup = element('details', 'year-group');
        const yearSummary = element('summary', 'year-summary');
        const count = [...months.values()].reduce((sum, value) => sum + value, 0);
        yearSummary.append(element('span', '', `${year}년`), element('small', '', `${count}건`));
        yearGroup.append(yearSummary);
        [...months].sort((a, b) => Number(b[0].match(/(\d+)월/)[1]) - Number(a[0].match(/(\d+)월/)[1])).forEach(([period, monthCount]) => {
          const month = period.match(/(\d+)월/)[1];
          addButton(yearGroup, `${month}월`, monthCount, period, 'month', `${source} ${period} 추천책 전체 목록 보여줘`);
        });
        group.append(yearGroup);
      });

      const categoryOrder = ['평산책방 추천', '재임 전', '재임 중', '퇴임 후'];
      [...categories].sort((a, b) => {
        const aOrder = categoryOrder.indexOf(a[0]);
        const bOrder = categoryOrder.indexOf(b[0]);
        return (aOrder < 0 ? categoryOrder.length : aOrder) - (bOrder < 0 ? categoryOrder.length : bOrder);
      }).forEach(([period, count]) => {
        const label = period === `${source} 추천` ? `${source} 추천책` : period;
        const prompt = period === `${source} 추천`
          ? `${label} 전체 목록 보여줘`
          : `${source} ${period} 추천책 전체 목록 보여줘`;
        addButton(group, label, count, period, 'category', prompt);
      });
      navigation.append(group);
    });
  }

  function scrollToEnd() {
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  function recommendationFor(query, book, collection) {
    return (collection && book.recommendations.find((item) => inCollection(item, collection))) ||
      search.matchingRecommendations(query, book, sourceNames)[0] || book.recommendations[0];
  }

  function renderShelf() {
    const shelf = document.getElementById('panel-books');
    const today = new Date();
    const day = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);
    const picks = [];
    for (let i = 0; i < 5 && sourceNames.length; i++) {
      const source = sourceNames[i % sourceNames.length];
      const candidates = books.filter((book) =>
        !picks.some((pick) => pick.book === book) &&
        book.recommendations.some((item) => item.source.name === source && item.attributionVerified !== false));
      if (!candidates.length) continue;
      const book = candidates[(day + i * 37) % candidates.length];
      const recommendation = book.recommendations.find((item) => item.source.name === source && item.attributionVerified !== false);
      picks.push({ book, recommendation });
    }
    picks.forEach(({ book, recommendation }) => {
      const row = element('div', 'shelf-book');
      const cover = element('img');
      cover.src = book.cover;
      cover.alt = `${book.title} 표지`;
      const text = element('div');
      text.append(element('h3', '', book.title), element('small', '', `${recommendation.source.name} · ${recommendation.recommender}`));
      row.append(cover, text);
      shelf.append(row);
    });
    document.getElementById('panel-date').textContent = today.toLocaleDateString('ko-KR');
    document.getElementById('panel-count').textContent = `${picks.length} BOOKS →`;
  }

  function addUserTurn(text) {
    const turn = element('div', 'turn user-turn');
    turn.append(element('div', 'user-bubble', text));
    conversation.append(turn);
    document.getElementById('hero').hidden = true;
    scrollToEnd();
  }

  function addAssistantTurn() {
    const turn = element('div', 'turn assistant-turn');
    const head = element('div', 'assistant-head');
    head.append(element('span', 'assistant-logo', '✳'), element('span', '', '책다락'));
    const answer = element('div', 'answer-text', '책장을 살펴보고 있어요…');
    turn.append(head, answer);
    conversation.append(turn);
    scrollToEnd();
    return { turn, answer };
  }

  function renderBooks(turn, results, method, query, collection, fullList) {
    if (!results.length) return;
    const label = method === 'hybrid' ? 'BM25 + 의미 검색' : 'BM25 검색';
    const sources = [...new Set(results.map((book) => recommendationFor(query, book, collection).source.name))].join(' · ');
    turn.append(element('div', 'method', `${label} · ${sources} 추천 목록 ${results.length}권`));
    const grid = element('div', 'cards');
    results.forEach((book) => {
      const card = element('article', 'book-card');
      const cover = element('img');
      cover.src = book.cover;
      cover.loading = 'lazy';
      cover.alt = `${book.title} 표지`;
      const info = element('div', 'book-info');
      const recommendation = recommendationFor(query, book, collection);
      const link = element('a', '', `${recommendation.source.name} · ${recommendation.recommender} ↗`);
      link.href = recommendation.source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const description = recommendation.attributionVerified === false
        ? '원문에서 추천사 본문을 확인할 수 없거나 책과의 연결이 불확실합니다.'
        : recommendation.text;
      info.append(element('h3', '', book.title), element('p', '', description), link);
      card.append(cover, info);
      grid.append(card);
    });
    turn.append(grid);
    if (!fullList) scrollToEnd();
  }

  async function getEmbedder() {
    if (!embedderPromise) {
      embedderPromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1').then(async ({ pipeline }) =>
        pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' }));
    }
    return embedderPromise;
  }

  async function semanticScores(query) {
    const embedder = await getEmbedder();
    if (!passageVectorsPromise) {
      const passages = books.map((book) => {
        const reviews = book.recommendations.filter((item) => item.attributionVerified !== false).map((item) => item.text.slice(0, 400)).join(' ');
        return `passage: ${book.title}. ${reviews} ${book.tags.join(' ')}`;
      });
      passageVectorsPromise = (async () => {
        const vectors = [];
        for (let i = 0; i < passages.length; i += 16) {
          const tensor = await embedder(passages.slice(i, i + 16), { pooling: 'mean', normalize: true });
          vectors.push(...tensor.tolist());
        }
        return vectors;
      })();
    }
    const [passages, queryTensor] = await Promise.all([
      passageVectorsPromise,
      embedder(`query: ${query}`, { pooling: 'mean', normalize: true })
    ]);
    const vector = queryTensor.tolist()[0];
    return passages.map((passage) => search.cosine(vector, passage));
  }

  async function searchBooks(query, collection) {
    const eligible = collection
      ? books.filter((book) => book.recommendations.some((item) => inCollection(item, collection)))
      : search.scope(query, books);
    if (!eligible.length) return { books: [], method: 'bm25' };
    const bm25 = search.lexicalScores(query, books, index);
    let method = search.route(query);
    let semantic;
    if (method === 'hybrid') {
      modelStatus.textContent = '의미 검색 모델 준비 중';
      try {
        semantic = await semanticScores(query);
      } catch (error) {
        console.warn('의미 검색을 사용할 수 없어 BM25로 검색합니다.', error);
        method = 'bm25';
      }
    }
    const maxBm25 = Math.max(...bm25, 1);
    const ranked = eligible.map((book) => {
      const i = books.indexOf(book);
      const lexical = bm25[i] / maxBm25;
      const meaning = semantic ? Math.max(0, semantic[i]) : 0;
      return { book, score: method === 'hybrid' ? lexical * 0.45 + meaning * 0.55 : lexical };
    }).sort((a, b) => b.score - a.score);
    const wantsMonthlyList = Boolean(collection) || /(?:20\d{2}년|(?:^|\s)(?:1[0-2]|0?[1-9])월|재임\s*[전중]|퇴임\s*후|평산책방\s*추천책|문재인(?:의)?\s*추천책)/.test(query) && /목록|전체|모두|보여/.test(query);
    const limit = wantsMonthlyList ? eligible.length : 4;
    const selected = wantsMonthlyList
      ? ranked.slice(0, limit)
      : ranked.filter((entry) => entry.score > 0).slice(0, limit);
    return { books: (selected.length ? selected : ranked.slice(0, limit)).map((entry) => entry.book), method, fullList: wantsMonthlyList };
  }

  async function getEngine() {
    if (!enginePromise) {
      modelStatus.textContent = '대화 모델 다운로드 중';
      enginePromise = import('https://esm.run/@mlc-ai/web-llm@0.2.81').then(({ CreateMLCEngine }) =>
        CreateMLCEngine(modelId, {
          initProgressCallback: (progress) => {
            const percent = Math.round((progress.progress || 0) * 100);
            modelStatus.textContent = `로컬 모델 준비 중 ${percent}%`;
          }
        }));
    }
    return enginePromise;
  }

  async function answerWithModel(query, results, collection) {
    const engine = await getEngine();
    modelStatus.textContent = '로컬 모델 사용 중';
    const evidence = results.map((book, i) => {
      const recommendation = recommendationFor(query, book, collection);
      const review = recommendation.attributionVerified === false
        ? '원문 추천사 본문을 확인할 수 없거나 도서와의 연결이 불확실함'
        : recommendation.text.slice(0, results.length > 4 ? 240 : undefined);
      return `${i + 1}. ${book.title} — ${recommendation.source.name} ${recommendation.period}, ${recommendation.recommender}: ${review}`;
    }).join('\n');
    const messages = [
      { role: 'system', content: '당신은 한국어 책 큐레이터입니다. 반드시 제공된 검색 결과 안의 책만 언급하세요. 결과에 없는 저자, 내용, 사실은 만들지 마세요. 질문에 맞는 이유를 자연스러운 존댓말로 2~3문장으로 설명하세요. 카드에 책 정보가 별도로 표시되므로 긴 목록은 쓰지 마세요.' },
      ...history.slice(-4),
      { role: 'user', content: `질문: ${query}\n\n검색 도구 결과:\n${evidence || '해당 기간의 책이 없습니다.'}` }
    ];
    const response = await engine.chat.completions.create({ messages, temperature: 0.5, max_tokens: 240 });
    return response.choices[0]?.message?.content?.trim() || '검색 결과에서 마음에 드는 책을 골라보세요.';
  }

  async function answerGeneral(query) {
    if (/^(안녕|안녕하세요|하이|hi|hello)[!?.~\s]*$/i.test(query)) return '안녕하세요! 무엇을 도와드릴까요?';
    if (/^(고마워|고마워요|감사해|감사합니다|thanks)[!?.~\s]*$/i.test(query)) return '천만에요. 또 궁금한 점이 있으면 말씀해 주세요.';
    if (/^(너는 누구|넌 누구|무슨 앱)/.test(query)) return '저는 책다락입니다. 책을 함께 찾거나 일반적인 질문에도 답할 수 있어요.';
    const engine = await getEngine();
    modelStatus.textContent = '로컬 모델 사용 중';
    const recentBooks = lastRecommendedBooks.map((book, i) => {
      const item = book.recommendations.find((recommendation) => recommendation.attributionVerified !== false);
      return `${i + 1}. ${book.title}: ${item?.text.slice(0, 300) || '확인된 소개 없음'}`;
    }).join('\n');
    const messages = [
      { role: 'system', content: '당신은 한국어로 자연스럽게 대화하는 책다락 도우미입니다. 사용자가 책 추천을 요청하지 않았다면 책 목록을 제안하지 마세요. 일반 질문에는 질문에 직접 답하세요. 실시간 정보나 제공되지 않은 책의 사실은 확인한 것처럼 말하지 마세요.' },
      ...history.slice(-6),
      { role: 'user', content: `${query}${recentBooks ? `\n\n이전 추천 책 참고 정보:\n${recentBooks}` : ''}` }
    ];
    const response = await engine.chat.completions.create({ messages, temperature: 0.5, max_tokens: 240 });
    return response.choices[0]?.message?.content?.trim() || '질문을 조금 더 자세히 말씀해 주시겠어요?';
  }

  async function submit(query, collection) {
    if (busy || !query.trim()) return;
    const wantsBooks = Boolean(collection) || search.wantsRecommendations(query, lastTurnWasRecommendation);
    if (!collection) document.querySelectorAll('.archive.selected').forEach((button) => button.classList.remove('selected'));
    busy = true;
    send.disabled = true;
    input.value = '';
    input.style.height = '';
    addUserTurn(query.trim());
    const { turn, answer } = addAssistantTurn();
    let fullList = false;
    try {
      if (!wantsBooks) {
        answer.textContent = '답변을 생각하고 있어요…';
        try {
          answer.textContent = await answerGeneral(query.trim());
        } catch (error) {
          console.error('로컬 대화 모델을 사용할 수 없습니다.', error);
          modelStatus.textContent = '로컬 모델 실행 불가';
          enginePromise = undefined;
          answer.textContent = '이 브라우저에서 로컬 대화 모델을 실행하지 못했습니다. 모델을 사용할 수 있는 환경에서 다시 질문해 주세요.';
        }
        lastTurnWasRecommendation = false;
      } else {
        const result = await searchBooks(query.trim(), collection);
        fullList = result.fullList;
        if (!result.books.length) {
          answer.textContent = '현재 카탈로그에는 해당 기간이나 출처의 추천 목록이 없어요.';
        } else {
          renderBooks(turn, result.books, result.method, query.trim(), collection, fullList);
          if (result.fullList) {
            answer.textContent = `요청하신 추천책 ${result.books.length}권을 찾았습니다. 아래에서 각 책의 소개와 원문을 확인해 보세요.`;
          } else {
            answer.textContent = '검색한 책을 바탕으로 추천 이유를 정리하고 있어요. 처음에는 로컬 모델 다운로드가 조금 걸릴 수 있습니다.';
            try {
              answer.textContent = await answerWithModel(query.trim(), result.books, collection);
            } catch (error) {
              console.error('로컬 대화 모델을 사용할 수 없습니다.', error);
              modelStatus.textContent = '로컬 모델 실행 불가';
              enginePromise = undefined;
              answer.textContent = `찾으시는 책과 가까운 ${result.books.length}권을 골랐어요. 아래에서 추천 기록을 확인해 보세요. 이 브라우저에서 로컬 대화 모델을 실행하지 못했습니다.`;
            }
          }
          lastRecommendedBooks = result.books.slice(0, 4);
        }
        lastTurnWasRecommendation = true;
      }
      history.push({ role: 'user', content: query.trim() }, { role: 'assistant', content: answer.textContent });
    } catch (error) {
      console.error(error);
      answer.textContent = '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
      if (fullList) turn.scrollIntoView({ block: 'start' });
      else scrollToEnd();
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); submit(input.value); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit(input.value);
    }
  });
  input.addEventListener('input', () => {
    input.style.height = '30px';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
  document.getElementById('prompts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) submit(button.dataset.prompt);
  });
  document.getElementById('new-chat').addEventListener('click', () => {
    history.length = 0;
    lastTurnWasRecommendation = false;
    lastRecommendedBooks = [];
    conversation.replaceChildren();
    document.getElementById('hero').hidden = false;
    scrollArea.scrollTop = 0;
    input.focus();
    document.querySelectorAll('.archive.selected').forEach((button) => button.classList.remove('selected'));
  });
  document.getElementById('source-navigation').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-prompt]');
    if (!button || busy) return;
    document.querySelectorAll('.archive.selected').forEach((selected) => selected.classList.remove('selected'));
    button.classList.add('selected');
    submit(button.dataset.prompt, { source: button.dataset.source, period: button.dataset.period, kind: button.dataset.kind });
  });
  renderNavigation();
  renderShelf();
})();
