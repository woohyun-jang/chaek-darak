import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

let embedderPromise;

self.onmessage = async ({ data }) => {
  try {
    if (!embedderPromise) {
      embedderPromise = pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
    }
    const embedder = await embedderPromise;
    const passages = await embedder(data.passages, { pooling: 'mean', normalize: true });
    const query = await embedder(`query: ${data.query}`, { pooling: 'mean', normalize: true });
    const vector = query.tolist()[0];
    const scores = passages.tolist().map((passage) =>
      passage.reduce((sum, value, index) => sum + value * vector[index], 0));
    self.postMessage({ scores });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
